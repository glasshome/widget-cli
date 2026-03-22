import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import { trpcMutate, trpcQuery } from "../utils/api";

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

  // Upload bundle to API
  const uploadRes = await fetch(`${api}/bundles/${widget.tag}`, {
    method: "POST",
    headers: { "Content-Type": "application/javascript" },
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
    input: {
      tag: widget.tag,
      name: widget.name,
      version: widget.version,
      bundleUrl: `/bundles/${widget.tag}/bundle.js`,
      manifestJson: JSON.stringify(manifest),
    },
  });
}

/**
 * Read registry.json and upload all widget bundles.
 * @returns Array of widget tags that were registered
 */
async function uploadAllWidgets(apiUrl: string, distDir: string): Promise<string[]> {
  const registryPath = resolve(distDir, "registry.json");
  const registry: RegistryJson = JSON.parse(readFileSync(registryPath, "utf-8"));
  const tags: string[] = [];

  for (const widget of registry.widgets) {
    await uploadAndRegister(apiUrl, distDir, widget);
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

  // Step 3: Enable dev mode if needed
  s.start("Registering widgets with dashboard...");
  try {
    const configData = await trpcQuery<{ devMode: boolean }>({
      apiUrl: apiUrl.replace(/\/$/, ""),
      path: "appConfig.get",
    });

    if (!configData.devMode) {
      await trpcMutate({
        apiUrl: apiUrl.replace(/\/$/, ""),
        path: "appConfig.toggleDevMode",
        input: {},
      });
    }
  } catch {
    // Non-fatal — dev mode may already be enabled
  }

  // Step 4: Upload bundles and register widgets
  const registeredTags = await uploadAllWidgets(apiUrl, distDir);
  s.stop("Widgets registered");

  // Step 5: Watch src/ for changes and rebuild + re-upload only the changed widget
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
        await uploadAndRegister(apiUrl, distDir, widget);
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

  // Step 6: Handle SIGINT — unregister and clean up
  const cleanup = async () => {
    log.info("\nDisconnecting...");
    watcher.close();

    for (const tag of registeredTags) {
      try {
        await trpcMutate({
          apiUrl: apiUrl.replace(/\/$/, ""),
          path: "widget.unregister",
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
