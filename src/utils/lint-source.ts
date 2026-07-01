import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { log } from "@clack/prompts";
import { deprecations, formatDeprecation } from "@glasshome/widget-sdk/deprecations";
import { discoverWidgets } from "./manifest";

/**
 * Source-level deprecation lint. Scans widget `.ts`/`.tsx` for deprecated API usage
 * (driven by the SDK deprecation registry) and direct `zod` imports, printing the
 * removal timeline. Warnings only: never blocks a build until the deprecated path is
 * actually removed (v2). Runs on `bun widget build` and `connect`.
 */

export interface SourceLintFinding {
  widget: string;
  file: string;
  line: number;
  message: string;
}

const SOURCE_EXTS = [".ts", ".tsx"];
const ZOD_IMPORT = /\bfrom\s+["']zod["']/;
const ZOD_IMPORT_MESSAGE =
  'importing from "zod" directly couples your widget to the SDK\'s zod version. Prefer field.*/defineConfig; for advanced schemas import { z } from "@glasshome/widget-sdk".';

function widgetSourceFiles(cwd: string, widget: string): string[] {
  const dir = resolve(cwd, "src", widget);
  const out: string[] = [];
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
export function lintWidgetSource(cwd: string, widget: string): SourceLintFinding[] {
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

  log.warn(`${findings.length} deprecated config usage(s) found (non-blocking until SDK 2.0):`);
  for (const f of findings) {
    log.message(`  ${f.file}:${f.line}  ${f.message}`);
  }
  return findings;
}
