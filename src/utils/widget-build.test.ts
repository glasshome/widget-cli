import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { majorMismatches, widgetBuildOptions } from "./widget-build";

const tmpDir = mkdtempSync(join(tmpdir(), "glasshome-widget-build-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

let fixtureCount = 0;

function installPackage(dir: string, name: string, files: Record<string, string>): void {
  const root = join(dir, "node_modules", name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version: files.version ?? "1.0.0", type: "module", main: "index.js" }),
  );
  if (files.index) writeFileSync(join(root, "index.js"), files.index);
}

function project(sdkVersion: string, manifests: Record<string, string> = {}): string {
  const dir = join(tmpDir, `project-${fixtureCount++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  installPackage(dir, "@glasshome/widget-sdk", { version: sdkVersion });
  installPackage(dir, "vite-plugin-solid", {
    index: `export default (options) => ({ name: "solid-1", options });`,
  });
  installPackage(dir, "@solidjs/vite-plugin", {
    index: `export default (options) => [{ name: "solid-2", options }];`,
  });
  for (const [name, range] of Object.entries(manifests)) {
    mkdirSync(join(dir, "src", name), { recursive: true });
    writeFileSync(join(dir, "src", name, "manifest.json"), JSON.stringify({ sdkVersion: range }));
  }
  return dir;
}

describe("widgetBuildOptions", () => {
  test("an SDK 1 project builds with vite-plugin-solid and no event delegation", async () => {
    const { plugins }: { plugins?: unknown } = await widgetBuildOptions(
      project("1.34.1", { clock: "^1.20.0" }),
    );
    expect(plugins).toEqual([{ name: "solid-1", options: { solid: { delegateEvents: false } } }]);
  });

  test("an SDK 2 project builds with @solidjs/vite-plugin", async () => {
    const { plugins }: { plugins?: unknown } = await widgetBuildOptions(
      project("2.0.0", { clock: "^2.0.0" }),
    );
    expect(plugins).toEqual([{ name: "solid-2", options: { dev: false, refresh: false } }]);
  });

  test("a widget whose manifest floors at the other major fails before building", async () => {
    await expect(
      widgetBuildOptions(project("2.0.0", { clock: "^1.20.0", sensor: "^2.0.0" })),
    ).rejects.toThrow(
      "src/clock/manifest.json declares sdkVersion ^1.20.0, but SDK 2 is installed",
    );
  });

  test("an SDK major this CLI does not build is refused", async () => {
    await expect(widgetBuildOptions(project("3.0.0"))).rejects.toThrow("builds SDK 1 and 2");
  });
});

describe("majorMismatches", () => {
  test("skips a manifest without a usable sdkVersion", () => {
    expect(majorMismatches(project("1.34.1", { draft: "", odd: "not a range" }), 1)).toEqual([]);
  });
});
