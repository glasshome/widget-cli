import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { log } from "@clack/prompts";
import { isBunGlobalCache } from "./resolution";

/**
 * Typecheck a widget project before building it.
 *
 * Scaffolded projects build with a bare `vite build`, which strips types without
 * checking them, so a widget could bundle and publish with its config type and
 * its `configSchema` disagreeing — including `examples` whose config the widget
 * would never accept. tsc is the only thing that catches that at authoring time.
 *
 * Skips (loudly) rather than failing when the project has no tsconfig or no
 * local typescript: a guard that cannot run has to say so.
 */

export type TypecheckResult =
  | { status: "ok" }
  | { status: "failed"; output: string }
  | { status: "skipped"; reason: string };

/**
 * An installed typescript, never bun's global cache.
 *
 * Load-bearing: when a project has no typescript installed, bun still resolves
 * the bare name, from `~/.bun/install/cache/typescript@7.0.2@@@1/`, so the CLI
 * would silently check against whatever major happens to be cached there.
 * Resolving to an *ancestor's* `node_modules` is fine and deliberate: hoisted
 * and workspace installs put it there, so requiring a copy inside the project
 * would skip every monorepo.
 */
function resolveTsc(cwd: string): string | null {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const pkg = resolve(require.resolve("typescript/package.json"));
    if (isBunGlobalCache(pkg)) return null;
    const bin = join(dirname(pkg), "bin", "tsc");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

export function runTypecheck(cwd: string): TypecheckResult {
  const tsconfig = join(cwd, "tsconfig.json");
  if (!existsSync(tsconfig)) return { status: "skipped", reason: "no tsconfig.json" };

  const tsc = resolveTsc(cwd);
  if (!tsc) {
    return { status: "skipped", reason: "typescript is not installed in this project" };
  }

  const proc = Bun.spawnSync([process.execPath, tsc, "--noEmit", "-p", tsconfig], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode === 0) return { status: "ok" };

  const output = [proc.stdout.toString(), proc.stderr.toString()].join("").trim();
  return { status: "failed", output: output || `tsc exited ${proc.exitCode}` };
}

/**
 * Typecheck and report. Returns false when the build should stop.
 *
 * Blocking on purpose: a type error here means the bundle that reaches the Hub
 * is built from code the author never checked.
 */
export function typecheckAndReport(cwd: string): boolean {
  const result = runTypecheck(cwd);
  if (result.status === "ok") return true;

  if (result.status === "skipped") {
    log.warn(`Types were NOT checked: ${result.reason}.`);
    return true;
  }

  log.error("Typecheck failed:");
  log.message(result.output);
  return false;
}
