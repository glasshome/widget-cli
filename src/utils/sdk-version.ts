import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isBunGlobalCache } from "./resolution";

/**
 * The SDK a widget actually builds against.
 *
 * `@glasshome/widget-sdk` is host-provided (`HOST_PROVIDED_MODULES`), so the
 * build externalizes it and the published bundle runs against whatever SDK the
 * host serves. That is why `manifest.sdkVersion` exists: it is the range the
 * host checks before mounting. It must be derived from, and checked against,
 * the SDK really resolved here — comparing it to the range declared in
 * package.json only ever compares a claim with itself.
 */

const SDK_PKG = "@glasshome/widget-sdk";

/**
 * Last resort when neither the project nor this CLI can be read. Deliberately a
 * 1.x range: anything below 1.0.0 excuses a widget from declaring capabilities,
 * so a wrong-but-modern default fails loudly instead of silently opting out of
 * the security contract.
 */
export const FALLBACK_SDK_RANGE = "^1.0.0";

/**
 * Version of the installed SDK, or null when none is installed.
 *
 * An ancestor's `node_modules` is fine and expected (hoisted installs put it
 * there), as is a workspace symlink resolving to the SDK's own source tree.
 * Bun's global install cache is not: with nothing installed it still resolves
 * the bare name, and that is not what the build would use.
 */
export function getInstalledSdkVersion(cwd: string): string | null {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const pkgPath = resolve(require.resolve(`${SDK_PKG}/package.json`));
    if (isBunGlobalCache(pkgPath)) return null;
    const version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * The SDK this CLI itself was built against, used when scaffolding a project
 * that has nothing installed yet.
 */
export function getCliSdkVersion(): string | null {
  try {
    const pkgPath = resolve(import.meta.dir, "../../package.json");
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const range = pkg.dependencies?.[SDK_PKG] ?? pkg.peerDependencies?.[SDK_PKG];
    return typeof range === "string" ? range.replace(/^[\^~]/, "") : null;
  } catch {
    return null;
  }
}

/**
 * The `^x.y.z` range to write when scaffolding: what the project has installed,
 * else what this CLI ships against. A caret, so patch and minor SDK releases do
 * not invalidate every published widget.
 */
export function defaultSdkRange(cwd?: string): string | null {
  const version = (cwd ? getInstalledSdkVersion(cwd) : null) ?? getCliSdkVersion();
  return version ? `^${version}` : null;
}

/** Strip a leading caret/tilde so a range can be compared as a version. */
export function bareVersion(range: string): string {
  return range.replace(/^[\^~]/, "");
}
