import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Whether a resolved module path is bun's global install cache rather than a
 * real install.
 *
 * With a package absent, bun still resolves its bare name, from
 * `~/.bun/install/cache/typescript@7.0.2@@@1/`. Tools that shell out to what
 * they resolved would then run a version the project never installed.
 *
 * Testing for a `node_modules` segment instead looks equivalent and is not: in
 * a workspace, `@glasshome/widget-sdk` resolves through a symlink to its real
 * source directory, which has no such segment, so that test rejects the very
 * install it should accept and the guard silently does nothing.
 */
export function isBunGlobalCache(modulePath: string): boolean {
  const cacheDir =
    process.env.BUN_INSTALL_CACHE_DIR ??
    join(process.env.BUN_INSTALL ?? join(homedir(), ".bun"), "install", "cache");
  return resolve(modulePath).startsWith(resolve(cacheDir) + sep);
}
