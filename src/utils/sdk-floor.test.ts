import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashRelease } from "@glasshome/widget-contract/dash-releases";
import { type FloorDeps, settleSdkFloor } from "./sdk-floor";

const tmpDir = mkdtempSync(join(tmpdir(), "glasshome-sdk-floor-"));
let fixtureCount = 0;

const HISTORY = {
  "1.4.0": ["Widget"],
  "1.5.0": ["Widget", "useEntity"],
  "1.9.0": ["Widget", "useEntity", "useLight"],
};

function release(version: string, stage: DashRelease["stage"], widgetSdk: string): DashRelease {
  return { version, stage, date: "2026-10-01", widgetSdk, ui: "1.0.0", syncLayer: "0.1.0" };
}

let releases: DashRelease[] = [];
let hubUrl = "";
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/widgets/dash-releases") return Response.json(releases);
      if (path === "/garbled/api/widgets/dash-releases") {
        return Response.json([{ version: 1, stage: "nightly" }]);
      }
      // Settles once the caller gives up, or server.stop waits on it past the hook timeout.
      if (path === "/silent/api/widgets/dash-releases") {
        return new Promise<Response>((resolve) =>
          req.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 }))),
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  hubUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.stop(true);
  rmSync(tmpDir, { recursive: true, force: true });
});

interface FixtureOptions {
  files: Record<string, string>;
  history?: Record<string, string[]> | null;
  sdkVersion?: string;
  changelog?: string;
  manifestFloor?: string;
}

const UNTOUCHED = "^1.0.0";

function project(opts: FixtureOptions): string {
  const dir = join(tmpDir, `project-${fixtureCount++}`);
  mkdirSync(join(dir, "src", "demo"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  writeFileSync(
    join(dir, "src", "demo", "manifest.json"),
    `${JSON.stringify({ name: "Demo", sdkVersion: opts.manifestFloor ?? UNTOUCHED }, null, 2)}\n`,
  );
  for (const [path, code] of Object.entries(opts.files)) {
    mkdirSync(join(dir, "dist", path, ".."), { recursive: true });
    writeFileSync(join(dir, "dist", path), code);
  }
  const sdk = join(dir, "node_modules", "@glasshome", "widget-sdk");
  mkdirSync(join(sdk, "dist"), { recursive: true });
  const history = opts.history === undefined ? HISTORY : opts.history;
  writeFileSync(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "@glasshome/widget-sdk",
      version: opts.sdkVersion ?? "1.9.0",
      exports: {
        "./package.json": "./package.json",
        ...(history ? { "./export-history": "./dist/export-history.json" } : {}),
      },
    }),
  );
  if (history) writeFileSync(join(sdk, "dist", "export-history.json"), JSON.stringify(history));
  if (opts.changelog) writeFileSync(join(sdk, "CHANGELOG.md"), opts.changelog);
  return dir;
}

function writtenFloor(dir: string): string {
  return JSON.parse(readFileSync(join(dir, "src", "demo", "manifest.json"), "utf-8")).sdkVersion;
}

function recorder(
  overrides: Partial<Omit<FloorDeps, "info" | "confirm">> & { answer?: boolean } = {},
) {
  const lines: string[] = [];
  const asked: string[] = [];
  const deps: FloorDeps = {
    info: (line) => lines.push(line),
    confirm: async (message) => {
      asked.push(message);
      return overrides.answer ?? true;
    },
    interactive: overrides.interactive ?? true,
    allowPrereleaseDash: overrides.allowPrereleaseDash ?? false,
    lowerFloor: overrides.lowerFloor ?? false,
    releasesSignal: overrides.releasesSignal,
  };
  return { lines, asked, deps };
}

const PLAIN = 'import{Widget as e}from"@glasshome/widget-sdk";export default e;';
const NEEDS_1_9 = 'import{useLight as l}from"@glasshome/widget-sdk";export default l;';
const ENTRY_WITH_LAZY_CHUNK = [
  'import{Widget as e}from"@glasshome/widget-sdk";',
  'const t=()=>import("./assets/panel-abc123.js");',
  "export default e(t);",
].join("\n");
const LAZY_CHUNK = 'import{useEntity as u}from"@glasshome/widget-sdk";export const p=u;';
const ONLY_PRERELEASE = [
  release("1.2.0", "stable", "1.4.0"),
  release("1.3.0-beta.1", "beta", "1.9.0"),
];

describe("settleSdkFloor", () => {
  test("writes the floor derived from the entry and its lazy chunk, and prints the reach", async () => {
    releases = [
      release("1.2.0", "stable", "1.4.0"),
      release("1.3.0-beta.1", "beta", "1.5.0"),
      release("1.3.0", "stable", "1.5.0"),
      release("1.4.0", "stable", "1.9.0"),
    ];
    const dir = project({
      files: { "demo.js": ENTRY_WITH_LAZY_CHUNK, "assets/panel-abc123.js": LAZY_CHUNK },
    });
    const out = recorder();
    const result = await settleSdkFloor(dir, "demo", hubUrl, out.deps);
    expect(result).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.5.0");
    expect(out.lines).toContain("Runs on Dash 1.3.0 and later");
    expect(out.asked).toEqual([]);
  });

  test("a relative path in a string literal is no import and is not followed", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      files: {
        "demo.js":
          'import{Widget as e}from"@glasshome/widget-sdk";const c="./copy.js";export default e(c);',
      },
    });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.4.0");
    expect(out.lines).not.toContain("Floor kept at 1.9.0: the built bundle could not be read");
  });

  test("a name no released SDK exports aborts before anything is written", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      files: { "demo.js": 'import{brandNew as b}from"@glasshome/widget-sdk";export default b;' },
    });
    const result = await settleSdkFloor(dir, "demo", hubUrl, recorder().deps);
    expect(result).toEqual({
      ok: false,
      message: "brandNew is not in any released SDK. Release the SDK first.",
    });
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("a namespace import keeps the floor at the build SDK and says why", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      files: { "demo.js": 'import*as s from"@glasshome/widget-sdk";export default s.Widget;' },
    });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the widget imports the SDK as a namespace");
    expect(out.lines).toContain("Runs on Dash 1.4.0 and later");
  });

  test("a direct ui import keeps the floor at the build SDK and says why", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      files: {
        "demo.js":
          'import{Widget as e}from"@glasshome/widget-sdk";import{Card as c}from"@glasshome/ui/solid";export default e(c);',
      },
    });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the widget imports @glasshome/ui directly");
  });

  test("an SDK without export history keeps the floor at the build SDK", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({ history: null, files: { "demo.js": PLAIN } });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the installed SDK predates export history");
  });

  test("a history that skips a release in the SDK's changelog aborts before anything is written", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      history: { "1.4.0": ["Widget"], "1.9.0": ["Widget", "useEntity"] },
      changelog: "## [1.9.0](x)\n\n## [1.5.0](x)\n\n## [1.4.0](x)\n",
      files: { "demo.js": 'import{useEntity as u}from"@glasshome/widget-sdk";export default u;' },
    });
    const result = await settleSdkFloor(dir, "demo", hubUrl, recorder().deps);
    expect(result).toEqual({
      ok: false,
      message:
        "The SDK's export history has no entry for 1.5.0, so no floor can be derived. Run scripts/backfill-export-history.ts in the SDK, then rebuild it.",
    });
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("a history that covers the SDK's changelog floors at the release that added the name", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      history: {
        "1.4.0": ["Widget"],
        "1.5.0": ["Widget", "useEntity"],
        "1.9.0": ["Widget", "useEntity"],
      },
      changelog: "## [1.9.0](x)\n\n## [1.5.0](x)\n\n## [1.4.0](x)\n",
      files: { "demo.js": 'import{useEntity as u}from"@glasshome/widget-sdk";export default u;' },
    });
    expect(await settleSdkFloor(dir, "demo", hubUrl, recorder().deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.5.0");
  });

  test("a chunk the entry imports but the build did not write keeps the floor at the build SDK", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({ files: { "demo.js": ENTRY_WITH_LAZY_CHUNK } });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the built bundle could not be read");
  });

  test("no stable Dash carrying the floor asks before publishing", async () => {
    releases = ONLY_PRERELEASE;
    const dir = project({ files: { "demo.js": NEEDS_1_9 } });
    const yes = recorder({ answer: true });
    expect(await settleSdkFloor(dir, "demo", hubUrl, yes.deps)).toEqual({ ok: true });
    expect(yes.asked).toEqual(["No stable Dash runs this yet. Publish anyway?"]);
    expect(writtenFloor(dir)).toBe("^1.9.0");
  });

  test("declining leaves the manifest unchanged", async () => {
    releases = ONLY_PRERELEASE;
    const dir = project({ files: { "demo.js": NEEDS_1_9 } });
    expect(await settleSdkFloor(dir, "demo", hubUrl, recorder({ answer: false }).deps)).toEqual({
      ok: false,
      message: "Publish cancelled.",
    });
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("without a terminal and without the flag, no stable Dash fails closed naming the flag", async () => {
    releases = ONLY_PRERELEASE;
    const dir = project({ files: { "demo.js": NEEDS_1_9 } });
    const out = recorder({ interactive: false });
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({
      ok: false,
      message: "No stable Dash runs this yet. Pass --allow-prerelease-dash to publish anyway.",
    });
    expect(out.asked).toEqual([]);
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("--allow-prerelease-dash publishes without asking", async () => {
    releases = ONLY_PRERELEASE;
    const dir = project({ files: { "demo.js": NEEDS_1_9 } });
    const out = recorder({ interactive: false, allowPrereleaseDash: true });
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(out.asked).toEqual([]);
    expect(writtenFloor(dir)).toBe("^1.9.0");
  });

  test("an unreachable hub fails closed and leaves the manifest unchanged", async () => {
    const dir = project({ files: { "demo.js": PLAIN } });
    const result = await settleSdkFloor(dir, "demo", "http://127.0.0.1:1", recorder().deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toStartWith("Could not read Dash releases from");
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("a hub that never answers is cut off by the signal and fails closed", async () => {
    const dir = project({ files: { "demo.js": PLAIN } });
    const timedOut = new AbortController();
    const settling = settleSdkFloor(
      dir,
      "demo",
      `${hubUrl}/silent`,
      recorder({ releasesSignal: () => timedOut.signal }).deps,
    );
    timedOut.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const result = await settling;
    expect(result).toEqual({
      ok: false,
      message: `Could not read Dash releases from ${hubUrl}/silent: The operation timed out.`,
    });
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("a hub that does not serve the table fails closed", async () => {
    const dir = project({ files: { "demo.js": PLAIN } });
    const result = await settleSdkFloor(dir, "demo", `${hubUrl}/elsewhere`, recorder().deps);
    expect(result.ok).toBe(false);
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });

  test("a hub answering a table of the wrong shape fails closed", async () => {
    const dir = project({ files: { "demo.js": PLAIN } });
    const result = await settleSdkFloor(dir, "demo", `${hubUrl}/garbled`, recorder().deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toStartWith("Could not read Dash releases from");
    expect(writtenFloor(dir)).toBe(UNTOUCHED);
  });
});

describe("settleSdkFloor against the manifest's floor", () => {
  const needs15 = 'import{useEntity as u}from"@glasshome/widget-sdk";export default u;';
  const stableDash = [release("1.4.0", "stable", "1.9.0")];

  test("a derived floor below the manifest's stops publish naming both, and writes nothing", async () => {
    releases = stableDash;
    const dir = project({ manifestFloor: "^1.9.0", files: { "demo.js": needs15 } });
    const result = await settleSdkFloor(dir, "demo", hubUrl, recorder().deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("needs SDK ^1.5.0, below the manifest's ^1.9.0");
      expect(result.message).toContain("--lower-floor");
    }
    expect(writtenFloor(dir)).toBe("^1.9.0");
  });

  test("--lower-floor writes the derived floor and prints both", async () => {
    releases = stableDash;
    const dir = project({ manifestFloor: "^1.9.0", files: { "demo.js": needs15 } });
    const out = recorder({ lowerFloor: true });
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.5.0");
    expect(out.lines).toContain("Lowering the floor from ^1.9.0 to ^1.5.0 (--lower-floor)");
  });

  test("a derived floor at or above the manifest's is written without the flag", async () => {
    releases = stableDash;
    const above = project({ manifestFloor: "^1.4.0", files: { "demo.js": needs15 } });
    const aboveOut = recorder();
    expect(await settleSdkFloor(above, "demo", hubUrl, aboveOut.deps)).toEqual({ ok: true });
    expect(writtenFloor(above)).toBe("^1.5.0");
    expect(aboveOut.lines.some((line) => line.startsWith("Lowering"))).toBe(false);

    const equal = project({ manifestFloor: "^1.5.0", files: { "demo.js": needs15 } });
    expect(await settleSdkFloor(equal, "demo", hubUrl, recorder().deps)).toEqual({ ok: true });
    expect(writtenFloor(equal)).toBe("^1.5.0");
  });
});
