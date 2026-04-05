import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import { trpcMutate, trpcQuery } from "../utils/api";
import { extractHost, getHostToken, storeHostToken } from "../utils/auth";

interface RegistryWidget {
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
  // Derive slug from bundleUrl (e.g. "./area.js" → "area")
  const slug = widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, "");

  const bundlePath = resolve(distDir, `${slug}.js`);
  if (!existsSync(bundlePath)) {
    log.warn(`Bundle not found: ${bundlePath} — skipping ${slug}`);
    return;
  }

  const bundleContent = readFileSync(bundlePath, "utf-8");

  const uploadRes = await fetch(`${api}/bundles/local/local/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/javascript",
      Authorization: `Bearer ${token}`,
    },
    body: bundleContent,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload bundle for ${slug}: HTTP ${uploadRes.status}`);
  }

  const manifest = { ...widget };
  delete (manifest as Record<string, unknown>).bundleUrl;

  await trpcMutate({
    apiUrl: api,
    path: "widget.register",
    token,
    input: {
      scope: "local",
      name: slug,
      version: widget.version,
      bundleUrl: `/bundles/local/local/${slug}/bundle.js`,
      manifestJson: JSON.stringify(manifest),
    },
  });
}

/**
 * Read registry.json and upload all widget bundles.
 * @returns Array of widget slugs that were registered
 */
async function uploadAllWidgets(apiUrl: string, distDir: string, token: string): Promise<string[]> {
  const registryPath = resolve(distDir, "registry.json");
  const registry: RegistryJson = JSON.parse(readFileSync(registryPath, "utf-8"));
  const slugs: string[] = [];

  for (const widget of registry.widgets) {
    const slug = widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, "");
    await uploadAndRegister(apiUrl, distDir, widget, token);
    slugs.push(slug);
  }

  return slugs;
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

  // Validate stored token before using it
  const existingToken = getHostToken(host);
  if (existingToken) {
    try {
      const check = await fetch(`${api}/api/auth/get-session`, {
        headers: { Authorization: `Bearer ${existingToken}` },
      });
      if (check.ok) {
        token = existingToken;
        log.info("Using stored credentials for dashboard.");
      } else {
        log.warn("Stored credentials expired — re-authenticating.");
      }
    } catch {
      log.warn("Could not validate stored credentials — re-authenticating.");
    }
  }

  if (!token) {
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
      log.warn(
        `Could not reach dashboard at ${api}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // token stays empty — caught by guard below
    }

    if (deviceCode!) {
      s.stop("Authorization code ready");

      // Prompt user to visit the verification URL
      log.info(`Open in browser: ${verificationUriComplete!}`);
      log.info(`Device code: ${userCode!}`);

      // Try to open browser automatically
      await import("open")
        .then((m) => m.default(verificationUriComplete!))
        .catch(() => {});

      // Poll for approval
      s.start("Waiting for authorization (approve in your browser)...");
      const deadline = Date.now() + expiresIn! * 1000;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval! * 1000));

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
            break;
          }

          const errData = (await res.json()) as { error?: string };
          if (errData.error === "authorization_pending" || errData.error === "slow_down") {
            if (errData.error === "slow_down") {
              interval = Math.min(interval! + 5, 30);
            }
            continue;
          }
          if (errData.error === "access_denied") {
            s.stop("Authorization denied");
            break;
          }
          if (errData.error === "expired_token") {
            s.stop("Device code expired");
            break;
          }
          // Unexpected error — stop polling
          s.stop(`Auth error: ${errData.error ?? res.status}`);
          break;
        } catch (err) {
          s.stop("Authorization failed");
          log.warn(`Error polling for token: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }

      if (token) {
        s.stop("Authorized");
      } else {
        s.stop("Not authorized");
      }
    }
  }

  if (!token) {
    log.warn("Authentication failed — widgets won't be connected. Log in at the dashboard first, then restart.");
    return;
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
        log.info(`Rebuilt & uploaded ${widgetName}`);
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

    for (const slug of registeredTags) {
      try {
        await trpcMutate({
          apiUrl: api,
          path: "widget.unregister",
          token,
          input: { scope: "local", name: slug },
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
