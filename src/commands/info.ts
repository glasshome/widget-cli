import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@clack/prompts";
import {
  discoverWidgets,
  formatBytes,
  getWidgetBundleInfo,
  readManifest,
  readRegistry,
} from "../utils/manifest";

export async function runInfo(cwd: string, widgetName?: string): Promise<void> {
  // Read package.json
  const pkgPath = resolve(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    log.error("No package.json found in current directory.");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  log.info(`Project: ${pkg.name ?? "unknown"}`);
  log.info(`Version: ${pkg.version ?? "0.0.0"}`);

  const widgets = discoverWidgets(cwd);

  if (widgets.length === 0) {
    log.warn("No widgets found in src/. Run `bun widget add` to create one.");
    return;
  }

  const toShow = widgetName ? widgets.filter((w) => w === widgetName) : widgets;

  if (widgetName && toShow.length === 0) {
    log.error(`Widget "${widgetName}" not found. Available: ${widgets.join(", ")}`);
    process.exit(1);
  }

  log.info(`\nWidgets: ${widgets.length} total`);

  for (const name of toShow) {
    log.info(`\n--- ${name} ---`);

    try {
      const manifest = readManifest(cwd, name);
      log.info(`  Tag:         ${manifest.tag}`);
      log.info(`  Name:        ${manifest.name}`);
      log.info(`  Type:        ${manifest.type}`);
      log.info(`  Size:        ${manifest.size}`);
      log.info(`  SDK Version: ${manifest.sdkVersion}`);
      if (manifest.version) {
        log.info(`  Version:     ${manifest.version}`);
      }
      if (manifest.description) {
        log.info(`  Description: ${manifest.description}`);
      }

      // Bundle size (if built)
      try {
        const info = getWidgetBundleInfo(cwd, name);
        log.info(`  Bundle:      ${formatBytes(info.raw)} (${formatBytes(info.gzip)} gzipped)`);
      } catch {
        log.info("  Bundle:      not built yet");
      }
    } catch (err) {
      log.warn(`  Could not read manifest: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Registry summary
  const registry = readRegistry(cwd);
  if (registry) {
    log.info(
      `\nRegistry: ${registry.widgets.length} widget(s) (generated ${registry.generatedAt})`,
    );
  }
}
