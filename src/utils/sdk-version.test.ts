import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBunGlobalCache } from "./resolution";
import { bareVersion, defaultSdkRange, getInstalledSdkVersion } from "./sdk-version";

const tmpDir = mkdtempSync(join(tmpdir(), "glasshome-sdk-version-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

let fixtureCount = 0;

/** A fake installed SDK, either under node_modules or as a workspace symlink
    to a source tree, which is how a monorepo actually resolves it. */
function project(opts: { version?: string; asWorkspaceLink?: boolean }): string {
  const dir = join(tmpDir, `project-${fixtureCount++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));

  if (opts.version) {
    const target = opts.asWorkspaceLink
      ? join(dir, "packages", "widget-sdk")
      : join(dir, "node_modules", "@glasshome", "widget-sdk");
    mkdirSync(target, { recursive: true });
    writeFileSync(
      join(target, "package.json"),
      JSON.stringify({ name: "@glasshome/widget-sdk", version: opts.version }),
    );
    if (opts.asWorkspaceLink) {
      mkdirSync(join(dir, "node_modules", "@glasshome"), { recursive: true });
      symlinkSync(target, join(dir, "node_modules", "@glasshome", "widget-sdk"), "dir");
    }
  }
  return dir;
}

describe("getInstalledSdkVersion", () => {
  test("reads the version from a normal install", () => {
    expect(getInstalledSdkVersion(project({ version: "1.8.1" }))).toBe("1.8.1");
  });

  test("reads it through a workspace symlink to a source tree", () => {
    // Regression: an earlier version required a `node_modules` segment in the
    // resolved path. A workspace symlink resolves to the SDK's real source
    // directory, which has none, so the check returned null and every guard
    // built on it silently did nothing in the monorepo.
    expect(getInstalledSdkVersion(project({ version: "1.7.0", asWorkspaceLink: true }))).toBe(
      "1.7.0",
    );
  });

  test("returns null when no SDK is installed", () => {
    // Must not fall back to bun's global cache copy.
    expect(getInstalledSdkVersion(project({}))).toBeNull();
  });
});

describe("defaultSdkRange", () => {
  test("carets the installed version", () => {
    expect(defaultSdkRange(project({ version: "1.8.1" }))).toBe("^1.8.1");
  });

  test("falls back to the SDK this CLI ships against", () => {
    // No project SDK, so it must still produce a 1.x range rather than nothing:
    // a pre-1.0 range would excuse the widget from declaring capabilities.
    const range = defaultSdkRange(project({}));
    expect(range).toMatch(/^\^\d+\.\d+\.\d+/);
    expect(bareVersion(range as string).startsWith("0.")).toBe(false);
  });
});

describe("isBunGlobalCache", () => {
  test("recognises the cache directory", () => {
    const cache = join(tmpDir, "cache");
    process.env.BUN_INSTALL_CACHE_DIR = cache;
    expect(isBunGlobalCache(join(cache, "typescript@7.0.2@@@1", "package.json"))).toBe(true);
    expect(isBunGlobalCache(join(tmpDir, "node_modules", "typescript", "package.json"))).toBe(
      false,
    );
    delete process.env.BUN_INSTALL_CACHE_DIR;
  });
});
