import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { log } from "@clack/prompts";
import { migrateConfigSource } from "../migrate/config-codemod";
import { discoverWidgets } from "../utils/manifest";

/** All `.ts`/`.tsx` source files under a widget dir. */
function widgetSourceFiles(cwd: string, widget: string): string[] {
  const dir = resolve(cwd, "src", widget);
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.endsWith(".d.ts"))
        out.push(p);
    }
  };
  walk(dir);
  return out;
}

export interface MigrateOptions {
  dry?: boolean;
  name?: string;
}

/**
 * `bun widget migrate config`, rewrite widgets' raw-zod config to `defineConfig` +
 * `field.*`. Assistive: unmigratable fields stay raw zod and are reported as manual
 * TODOs; validation is never dropped. Use `--dry` to preview without writing.
 */
export async function runMigrate(
  cwd: string,
  target: string,
  opts: MigrateOptions,
): Promise<boolean> {
  if (target !== "config") {
    log.error(`Unknown migrate target "${target}". Supported: config`);
    return false;
  }

  const all = discoverWidgets(cwd);
  const widgets = opts.name ? all.filter((w) => w === opts.name) : all;
  if (widgets.length === 0) {
    log.error(
      opts.name
        ? `Widget "${opts.name}" not found. Available: ${all.join(", ")}`
        : "No widgets found in src/.",
    );
    return false;
  }

  let migrated = 0;
  let totalTodos = 0;
  const skipped: string[] = [];

  for (const widget of widgets) {
    let widgetChanged = false;
    for (const file of widgetSourceFiles(cwd, widget)) {
      const original = readFileSync(file, "utf8");
      const { code, changed, warnings } = migrateConfigSource(original, file);
      if (!changed) continue;

      widgetChanged = true;
      migrated++;
      if (!opts.dry) writeFileSync(file, code);

      const rel = relative(cwd, file);
      const verb = opts.dry ? "would migrate" : "migrated";
      if (warnings.length === 0) {
        log.success(`${widget}: ${verb} ${rel} (fully)`);
      } else {
        totalTodos += warnings.length;
        log.warn(
          `${widget}: ${verb} ${rel}, ${warnings.length} field(s) left as raw zod (manual TODO):`,
        );
        for (const w of warnings) {
          log.message(`  • ${w.field}: ${w.reason}`);
        }
      }
    }
    if (!widgetChanged) skipped.push(`${widget} (already migrated or no z.object config)`);
  }

  if (skipped.length > 0) log.info(`Skipped: ${skipped.join(", ")}`);
  const prefix = opts.dry ? "Dry run: " : "";
  log.info(`${prefix}${migrated} widget(s) migrated, ${totalTodos} field(s) need manual review.`);
  if (!opts.dry && migrated > 0) {
    log.info("Review the diffs, then rebuild (`bun widget build`) to verify the zod region drops.");
  }
  return true;
}
