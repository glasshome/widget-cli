import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { log, note } from "@clack/prompts";
import color from "picocolors";
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

  log.step(
    `${color.bold(pkg.name ?? "unknown")} ${color.dim(`v${pkg.version ?? "0.0.0"}`)} ${color.dim("·")} ${widgets.length} widget(s)`,
  );

  // Right-pad labels so values line up inside the note box.
  const field = (label: string, value: string) => `${color.dim(label.padEnd(9))} ${value}`;

  for (const name of toShow) {
    try {
      const manifest = readManifest(cwd, name);
      const lines: string[] = [];

      const size = (s: { w: number; h: number }) => `${s.w}×${s.h}`;
      lines.push(field("Size", `${size(manifest.minSize)} → ${size(manifest.maxSize)}`));
      if (manifest.defaultSize) lines.push(field("Default", size(manifest.defaultSize)));
      lines.push(field("SDK", manifest.sdkVersion));
      if (manifest.version) lines.push(field("Version", manifest.version));
      if (manifest.description) lines.push(field("About", color.dim(manifest.description)));

      try {
        const info = getWidgetBundleInfo(cwd, name);
        lines.push(field("Bundle", `${formatBytes(info.raw)} (${formatBytes(info.gzip)} gzipped)`));
      } catch {
        lines.push(field("Bundle", color.dim("not built yet")));
      }

      note(lines.join("\n"), `${manifest.name} ${color.dim(`(${name})`)}`);
    } catch (err) {
      log.warn(`${name}: could not read manifest: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const registry = readRegistry(cwd);
  if (registry) {
    log.info(`Registry: ${registry.widgets.length} widget(s) (generated ${registry.generatedAt})`);
  }
}
