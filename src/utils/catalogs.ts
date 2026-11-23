import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isSidecarLocale, type WidgetManifest } from "@glasshome/widget-contract";
import { reservedKeys } from "@glasshome/widget-contract/catalog-reserved";
import { readRegistry } from "./manifest";

export const SIDECAR_LOCALES = ["en", "fr", "es", "de"] as const;

export interface LocaleFile {
  tag: string;
  path: string;
}

export function localeFiles(dir: string): LocaleFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ tag: file.slice(0, -".json".length), path: join(dir, file) }));
}

export function builtLocaleFiles(distDir: string, slug: string): LocaleFile[] {
  return localeFiles(join(distDir, slug, "locales")).filter((file) =>
    isSidecarLocale(file.tag, SIDECAR_LOCALES),
  );
}

export function readAuthorEnglish(cwd: string, slug: string): Record<string, string> {
  const path = resolve(cwd, "src", slug, "locales", "en.json");
  if (!existsSync(path)) return {};
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof data === "object" && data !== null && !Array.isArray(data)
      ? (data as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function emitCatalogs(cwd: string): void {
  const registry = readRegistry(cwd);
  if (!registry) return;
  for (const widget of registry.widgets) {
    const slug = widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, "");
    const out = resolve(cwd, "dist", slug, "locales");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const english = { ...readAuthorEnglish(cwd, slug), ...reservedKeys(widget as WidgetManifest) };
    writeFileSync(join(out, "en.json"), `${JSON.stringify(english, null, 2)}\n`);
    for (const file of localeFiles(resolve(cwd, "src", slug, "locales"))) {
      if (file.tag !== "en" && isSidecarLocale(file.tag, SIDECAR_LOCALES)) {
        copyFileSync(file.path, join(out, `${file.tag}.json`));
      }
    }
  }
}
