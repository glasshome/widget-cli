import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { log } from "@clack/prompts";
import { deprecations, formatDeprecation } from "@glasshome/widget-sdk/deprecations";
import { discoverWidgets } from "./manifest";

/**
 * Source-level deprecation lint. Scans widget `.ts`/`.tsx`/`.css` for deprecated API usage
 * (driven by the SDK deprecation registry), direct `zod` imports and browser storage, printing the
 * removal timeline. Warnings only: never blocks a build until the deprecated path is
 * actually removed (v2). Runs on `bun widget build`, `connect`, `preview` and `publish`.
 */

export interface SourceLintFinding {
  widget: string;
  file: string;
  line: number;
  message: string;
}

const SOURCE_EXTS = [".ts", ".tsx", ".css"];
const ZOD_IMPORT = /\bfrom\s+["']zod["']/;
const ZOD_IMPORT_MESSAGE =
  'importing from "zod" directly couples your widget to the SDK\'s zod version. Prefer field.*/defineConfig; for advanced schemas import { z } from "@glasshome/widget-sdk".';
const RAW_STORAGE = /\b(?:localStorage|sessionStorage)\b/;
const RAW_STORAGE_MESSAGE =
  "localStorage and sessionStorage are in memory and empty after every reload; keep what must last with useWidgetState (widget-sdk 1.28.0 and later).";

const LOCALE_RULES: { pattern: RegExp; message: string }[] = [
  {
    pattern:
      /\.toLocale(?:(?:Date|Time)?String|(?:Upper|Lower)Case)\(\s*(?:(?:undefined|\[\s*\])\s*)?[,)]/,
    message:
      "toLocaleString() and toLocaleUpperCase() with no locale use the browser's language; use formatNumber, formatDate or formatTemperature from the SDK, or pass a locale.",
  },
  {
    pattern: /\bIntl\.\w+\(\s*(?:(?:undefined|\[\s*\])\s*)?[,)](?!\.resolvedOptions)/,
    message:
      "an Intl formatter with no locale uses the browser's language; use formatNumber or formatDate from the SDK, or pass a locale.",
  },
  {
    pattern: /\.localeCompare\((?:[^,]*\)|[^,]*,\s*undefined\b)/,
    message:
      "localeCompare() with no locale sorts in the browser's language; pass the member's locale from useTranslation().",
  },
  {
    pattern:
      /\b(?:parseFloat|Number)\(\s*(?:\w+\.)?format(?:Number|Date|Relative|Temperature|Value)\(/,
    message:
      "a formatted number is text for people, not data; keep the raw value and send that to a service call.",
  },
];

export function widgetSourceFiles(cwd: string, widget: string): string[] {
  const dir = resolve(cwd, "src", widget);
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (SOURCE_EXTS.some((e) => entry.endsWith(e))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const registryMatchers = deprecations
  .filter((d) => d.sourcePattern)
  .map((d) => ({ entry: d, re: new RegExp(d.sourcePattern as string) }));

/** Scan one widget's source and return deprecation findings. */
function lintWidgetSource(cwd: string, widget: string): SourceLintFinding[] {
  const findings: SourceLintFinding[] = [];
  for (const file of widgetSourceFiles(cwd, widget)) {
    const rel = relative(cwd, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      const line = i + 1;
      for (const { entry, re } of registryMatchers) {
        if (re.test(text)) {
          findings.push({ widget, file: rel, line, message: formatDeprecation(entry) });
        }
      }
      if (ZOD_IMPORT.test(text)) {
        findings.push({
          widget,
          file: rel,
          line,
          message: `[@glasshome/widget-sdk] ${ZOD_IMPORT_MESSAGE}`,
        });
      }
      for (const rule of LOCALE_RULES) {
        if (rule.pattern.test(text)) {
          findings.push({
            widget,
            file: rel,
            line,
            message: `[@glasshome/widget-sdk] ${rule.message}`,
          });
        }
      }
      if (RAW_STORAGE.test(text)) {
        findings.push({
          widget,
          file: rel,
          line,
          message: `[@glasshome/widget-sdk] ${RAW_STORAGE_MESSAGE}`,
        });
      }
    });
  }
  return findings;
}

/**
 * Lint the given widgets (or all discovered widgets) and print findings as warnings.
 * Returns the findings so callers can act on them; never throws or blocks the build.
 */
export function lintAndReport(cwd: string, widgets?: string[]): SourceLintFinding[] {
  const targets = widgets ?? discoverWidgets(cwd);
  const findings = targets.flatMap((w) => lintWidgetSource(cwd, w));
  if (findings.length === 0) return findings;

  log.warn(
    `${findings.length} deprecated API or browser storage use(s) found (warnings, never block a build):`,
  );
  for (const f of findings) {
    log.message(`  ${f.file}:${f.line}  ${f.message}`);
  }
  return findings;
}
