import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

export interface WidgetManifest {
  tag: string;
  name: string;
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
  sdkVersion: string;
  version?: string;
  description?: string;
  schema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
}

export interface Registry {
  version: number;
  generatedAt: string;
  baseUrl: string;
  widgets: Array<WidgetManifest & { bundleUrl: string }>;
}

export interface BundleInfo {
  raw: number;
  gzip: number;
  text: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Multi-widget helpers
// ---------------------------------------------------------------------------

/** Discover all widget directories in src/ that contain a manifest.json. */
export function discoverWidgets(cwd: string): string[] {
  const srcDir = resolve(cwd, "src");
  if (!existsSync(srcDir)) return [];

  return readdirSync(srcDir).filter((entry) => {
    const dir = join(srcDir, entry);
    return statSync(dir).isDirectory() && existsSync(join(dir, "manifest.json"));
  });
}

/** Read a single widget's manifest.json from its source directory. */
export function readManifest(cwd: string, widgetName: string): WidgetManifest {
  const manifestPath = resolve(cwd, "src", widgetName, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at src/${widgetName}/manifest.json`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

/** Write a manifest.json to a widget's source directory. */
export function writeManifest(cwd: string, widgetName: string, manifest: WidgetManifest): void {
  const manifestPath = resolve(cwd, "src", widgetName, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Read dist/registry.json if it exists. */
export function readRegistry(cwd: string): Registry | null {
  const registryPath = resolve(cwd, "dist", "registry.json");
  if (!existsSync(registryPath)) return null;
  return JSON.parse(readFileSync(registryPath, "utf-8"));
}

/** Get bundle info for a specific widget from the dist/ directory. */
export function getWidgetBundleInfo(cwd: string, widgetName: string): BundleInfo {
  const distPath = resolve(cwd, "dist", `${widgetName}.js`);
  if (!existsSync(distPath)) {
    throw new Error(`dist/${widgetName}.js not found. Run \`bun run build\` first.`);
  }
  const text = readFileSync(distPath, "utf-8");
  const raw = Buffer.byteLength(text, "utf-8");
  const gzip = gzipSync(text).byteLength;
  return { raw, gzip, text };
}
