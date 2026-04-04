import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import { trpcMutate, trpcQuery } from "../utils/api";
import { extractHost, getHostToken, storeHostToken } from "../utils/auth";

interface RegistryWidget {
  tag: string;
  name: string;
  version: string;
  bundleUrl: string;
  sdkVersion: string;
  [key: string]: unknown;
}

interface RegistryJson {
  version: number;
  widgets: RegistryWidget[];
}

/**
 * Upload a single widget bundle to the API and register it.
 */
async function uploadAndRegister(
  apiUrl: string,
  distDir: string,
  widget: RegistryWidget,
  token: string,
): Promise<void> {
  const api = apiUrl.replace(/\/$/, "");

  // Read the bundle file from dist/ (bundleUrl is relative like "./area.js")
  const bundleFilename = widget.bundleUrl.replace(/^\.\//, "");
  const bundlePath = resolve(distDir, bundleFilename);

  if (!existsSync(bundlePath)) {
    log.warn(`Bundle not found: ${bundlePath} — skipping ${widget.tag}`);
    return;
  }

  const bundleContent = readFileSync(bundlePath, "utf-8");

  // Upload bundle to API (local registry namespace)
  const uploadRes = await fetch(`${api}/bundles/local/${widget.tag}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/javascript",
      Authorization: `Bearer ${token}`,
    },
    body: bundleContent,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload bundle for ${widget.tag}: HTTP ${uploadRes.status}`);
  }

  // Register the widget with a local bundle path (skips redundant download)
  const manifest = { ...widget };
  delete (manifest as Record<string, unknown>).bundleUrl;

  await trpcMutate({
    apiUrl: api,
    path: "widget.register",
    token,
    input: {
      tag: widget.tag,
      name: widget.name,
      version: widget.version,
      bundleUrl: `/bundles/local/${widget.tag}/bundle.js`,
      manifestJson: JSON.stringify(manifest),
    },
  });
}

/**
 * Read registry.json and upload all widget bundles.
 * @returns Array of widget tags that were registered
 */
async function uploadAllWidgets(apiUrl: string, distDir: string, token: string): Promise<string[]> {
  const registryPath = resolve(distDir, "registry.json");
  const registry: RegistryJson = JSON.parse(readFileSync(registryPath, "utf-8"));
  const tags: string[] = [];

  for (const widget of registry.widgets) {
    await uploadAndRegister(apiUrl, distDir, widget, token);
    tags.push(widget.tag);
  }

  return tags;
}

export async function runConnect(apiUrl: string, cwd: string): Promise<void> {
  const distDir = resolve(cwd, "dist");
  const solid = (await import("vite-plugin-solid")).default;
  const buildOpts = { srcDir: "src", outDir: "dist", plugins: [solid()] };

  // Step 1: Initial build
  const s = spinner();
  s.start("Building widgets...");
  try {
    const origCwd = process.cwd();
    process.chdir(cwd);
    await buildWidgets(buildOpts);
    process.chdir(origCwd);
  } catch (err) {
    s.stop("Build failed");
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  s.stop("Build complete");

  // Step 2: Check registry was generated
  const registryPath = resolve(distDir, "registry.json");
  if (!existsSync(registryPath)) {
    log.error("dist/registry.json not found after build. Check your vite.config.ts.");
    process.exit(1);
  }

  // Step 3: Obtain bearer token via device authorization flow
  const api = apiUrl.replace(/\/$/, "");
  const host = extractHost(api);
  let token = "";

  const existingToken = getHostToken(host);
  if (existingToken) {
    token = existingToken;
    log.info("Using stored credentials for dashboard.");
  } else {
    // Request a device code
    s.start("Requesting authorization code...");
    let deviceCode: string;
    let userCode: string;
    let verificationUriComplete: string;
    let expiresIn: number;
    let interval: number;

    try {
      const res = await fetch(`${api}/api/auth/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: "glasshome-widget-cli" }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        device_code: string;
        user_code: string;
        verification_uri_complete: string;
        expires_in: number;
        interval: number;
      };
      deviceCode = data.device_code;
      userCode = data.user_code;
      // Build verification URL from the dashboard URL the user provided,
      // not the API response (which uses the API server's origin)
      verificationUriComplete = `${api}/device?user_code=${data.user_code}`;
      expiresIn = data.expires_in;
      interval = data.interval ?? 5;
    } catch (err) {
      s.stop("Failed to request device code");
      log.error(
        `Could not reach dashboard at ${api}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    s.stop("Authorization code ready");

    // Prompt user to visit the verification URL
    log.info(`Open in browser: ${verificationUriComplete}`);
    log.info(`Device code: ${userCode}`);

    // Try to open browser automatically
    await import("open")
      .then((m) => m.default(verificationUriComplete))
      .catch(() => {});

    // Poll for approval
    s.start("Waiting for authorization (approve in your browser)...");
    const deadline = Date.now() + expiresIn * 1000;
    let approved = false;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval * 1000));

      try {
        const res = await fetch(`${api}/api/auth/device/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: deviceCode,
            client_id: "glasshome-widget-cli",
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            access_token: string;
            expires_in: number;
          };
          token = data.access_token;
          const tokenExpiresAt = Date.now() + data.expires_in * 1000;
          storeHostToken(host, token, tokenExpiresAt);
          approved = true;
          break;
        }

        const errData = (await res.json()) as { error?: string };
        if (errData.error === "authorization_pending" || errData.error === "slow_down") {
          // Continue polling
          if (errData.error === "slow_down") {
            interval = Math.min(interval + 5, 30);
          }
          continue;
        }
        if (errData.error === "access_denied") {
          s.stop("Authorization denied");
          log.error("You denied access. Run `bun widget connect` again to retry.");
          process.exit(1);
        }
        if (errData.error === "expired_token") {
          s.stop("Device code expired");
          log.error("The device code expired before you approved. Run `bun widget connect` again.");
          process.exit(1);
        }
        // Unexpected error
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      } catch (err) {
        s.stop("Authorization failed");
        log.error(
          `Error polling for token: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    }

    if (!approved) {
      s.stop("Timed out");
      log.error("Authorization timed out. Run `bun widget connect` again.");
      process.exit(1);
    }
    s.stop("Authorized");
  }

  // Step 4: Enable dev mode if needed
  s.start("Registering widgets with dashboard...");
  try {
    const configData = await trpcQuery<{ devMode: boolean }>({
      apiUrl: api,
      path: "appConfig.get",
    });

    if (!configData.devMode) {
      await trpcMutate({
        apiUrl: api,
        path: "appConfig.toggleDevMode",
        token,
        input: {},
      });
    }
  } catch {
    // Non-fatal — dev mode may already be enabled
  }

  // Step 5: Upload bundles and register widgets
  const registeredTags = await uploadAllWidgets(apiUrl, distDir, token);
  s.stop("Widgets registered");

  // Step 6: Watch src/ for changes and rebuild + re-upload only the changed widget
  const srcDir = resolve(cwd, "src");
  let rebuilding = false;
  const watcher = watch(srcDir, { recursive: true }, async (_event, filename) => {
    if (rebuilding || !filename) return;
    rebuilding = true;
    try {
      // Determine which widget changed from the file path (first path segment under src/)
      const widgetName = filename.split(/[\\/]/)[0] ?? filename;
      const origCwd = process.cwd();
      process.chdir(cwd);
      await buildWidgets({ ...buildOpts, only: [widgetName] });
      process.chdir(origCwd);

      // Upload only the changed widget
      const registryPath = resolve(distDir, "registry.json");
      const registry: RegistryJson = JSON.parse(readFileSync(registryPath, "utf-8"));
      const widget = registry.widgets.find((w) => w.bundleUrl === `./${widgetName}.js`);
      if (widget) {
        await uploadAndRegister(apiUrl, distDir, widget, token);
        log.info(`Rebuilt & uploaded ${widget.tag}`);
      } else {
        log.warn(`No registry entry for ${widgetName} — skipping upload`);
      }
    } catch (err) {
      log.warn(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      rebuilding = false;
    }
  });

  // Count widgets
  const widgetCount = existsSync(resolve(cwd, "src"))
    ? readdirSync(resolve(cwd, "src")).filter(
        (d) =>
          statSync(resolve(cwd, "src", d)).isDirectory() &&
          existsSync(resolve(cwd, "src", d, "manifest.json")),
      ).length
    : 0;

  log.success(`Connected! ${widgetCount} widget(s) are live.`);
  log.info("Bundles uploaded to API. Widgets registered with local paths.");
  log.info("File changes auto-rebuild and re-upload. Add widgets with `bun widget add`.");
  log.info("Press Ctrl+C to disconnect.");

  // Step 7: Handle SIGINT — unregister and clean up
  const cleanup = async () => {
    log.info("\nDisconnecting...");
    watcher.close();

    for (const tag of registeredTags) {
      try {
        await trpcMutate({
          apiUrl: api,
          path: "widget.unregister",
          token,
          input: { tag },
        });
      } catch {
        // Non-fatal — API may be down
      }
    }
    log.info("Widgets unregistered");

    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}
