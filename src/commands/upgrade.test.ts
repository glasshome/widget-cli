import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUpgrade, sdkDependencySection } from "./upgrade";

const tmpDir = mkdtempSync(join(tmpdir(), "glasshome-upgrade-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runUpgrade", () => {
  test("leaves every manifest sdkVersion as publish wrote it", async () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ workspaces: ["widgets"] }));
    mkdirSync(join(tmpDir, "widget-sdk"), { recursive: true });
    writeFileSync(join(tmpDir, "widget-sdk", "package.json"), JSON.stringify({ version: "1.9.0" }));
    const project = join(tmpDir, "widgets");
    mkdirSync(join(project, "src", "demo"), { recursive: true });
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ peerDependencies: { "@glasshome/widget-sdk": "^1.9.0" } }),
    );
    const manifestPath = join(project, "src", "demo", "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ name: "Demo", sdkVersion: "^1.5.0" }));

    await runUpgrade(project);

    expect(JSON.parse(readFileSync(manifestPath, "utf-8")).sdkVersion).toBe("^1.5.0");
  });
});

describe("sdkDependencySection", () => {
  test("finds the SDK in whichever section declares it", () => {
    expect(sdkDependencySection({ peerDependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "peerDependencies",
    );
    expect(sdkDependencySection({ devDependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "devDependencies",
    );
    expect(sdkDependencySection({ dependencies: { "@glasshome/widget-sdk": "^1.10.2" } })).toBe(
      "dependencies",
    );
  });

  test("returns null when the SDK is not declared", () => {
    expect(sdkDependencySection({ dependencies: { zod: "^4" } })).toBeNull();
  });
});
