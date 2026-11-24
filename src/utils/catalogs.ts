import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { isSidecarLocale } from "@glasshome/widget-contract";
import { reservedKeys } from "@glasshome/widget-contract/catalog-reserved";
import { parseCatalog } from "@glasshome/widget-contract/i18n";
import { readRegistry } from "./manifest";

export interface LocaleFile {
  tag: string;
  path: string;
}

export function localeFiles(dir: string): LocaleFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ tag: file.slice(0, -".json".length), path: join(dir, file) }));
}

export function builtLocaleFiles(distDir: string, slug: string): LocaleFile[] {
  return localeFiles(join(distDir, slug, "locales")).filter((file) => isSidecarLocale(file.tag));
}

export function readAuthorEnglish(cwd: string, slug: string): Record<string, string> {
  const path = resolve(cwd, "src", slug, "locales", "en.json");
  if (!existsSync(path)) return {};
  assertCatalog(cwd, path);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

function assertCatalog(cwd: string, path: string): void {
  const parsed = parseCatalog(readFileSync(path, "utf8"));
  if (!parsed.ok) {
    throw new Error(`${relative(cwd, path)} does not parse: ${JSON.stringify(parsed.error)}`);
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
    const english = { ...readAuthorEnglish(cwd, slug), ...reservedKeys(widget) };
    writeFileSync(join(out, "en.json"), `${JSON.stringify(english, null, 2)}\n`);
    for (const file of localeFiles(resolve(cwd, "src", slug, "locales"))) {
      if (file.tag !== "en" && isSidecarLocale(file.tag)) {
        assertCatalog(cwd, file.path);
        copyFileSync(file.path, join(out, `${file.tag}.json`));
      }
    }
  }
}
