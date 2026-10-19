import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashRelease } from "@glasshome/widget-contract/dash-releases";
import { settleSdkFloor } from "./sdk-floor";

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
      if (new URL(req.url).pathname === "/api/widgets/dash-releases") {
        return Response.json(releases);
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
}

function project(opts: FixtureOptions): string {
  const dir = join(tmpDir, `project-${fixtureCount++}`);
  mkdirSync(join(dir, "src", "demo"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  writeFileSync(
    join(dir, "src", "demo", "manifest.json"),
    `${JSON.stringify({ name: "Demo", sdkVersion: "^1.0.0" }, null, 2)}\n`,
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
  return dir;
}

function writtenFloor(dir: string): string {
  return JSON.parse(readFileSync(join(dir, "src", "demo", "manifest.json"), "utf-8")).sdkVersion;
}

function recorder(answer = true) {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines,
    asked,
    deps: {
      info: (line: string) => lines.push(line),
      confirm: async (message: string) => {
        asked.push(message);
        return answer;
      },
    },
  };
}

const ENTRY_WITH_LAZY_CHUNK = [
  'import{Widget as e}from"@glasshome/widget-sdk";',
  'const t=()=>import("./assets/panel-abc123.js");',
  "export default e(t);",
].join("\n");
const LAZY_CHUNK = 'import{useEntity as u}from"@glasshome/widget-sdk";export const p=u;';

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
    expect(writtenFloor(dir)).toBe("^1.0.0");
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

  test("an SDK without export history keeps the floor at the build SDK", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({
      history: null,
      files: { "demo.js": 'import{Widget as e}from"@glasshome/widget-sdk";export default e;' },
    });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the installed SDK predates export history");
  });

  test("a chunk the entry names but the build did not write keeps the floor at the build SDK", async () => {
    releases = [release("1.4.0", "stable", "1.9.0")];
    const dir = project({ files: { "demo.js": ENTRY_WITH_LAZY_CHUNK } });
    const out = recorder();
    expect(await settleSdkFloor(dir, "demo", hubUrl, out.deps)).toEqual({ ok: true });
    expect(writtenFloor(dir)).toBe("^1.9.0");
    expect(out.lines).toContain("Floor kept at 1.9.0: the built bundle could not be read");
  });

  test("no stable Dash carrying the floor asks before publishing", async () => {
    releases = [release("1.2.0", "stable", "1.4.0"), release("1.3.0-beta.1", "beta", "1.9.0")];
    const dir = project({
      files: { "demo.js": 'import{useLight as l}from"@glasshome/widget-sdk";export default l;' },
    });
    const yes = recorder(true);
    expect(await settleSdkFloor(dir, "demo", hubUrl, yes.deps)).toEqual({ ok: true });
    expect(yes.asked).toEqual(["No stable Dash runs this yet. Publish anyway?"]);

    const no = recorder(false);
    expect(await settleSdkFloor(dir, "demo", hubUrl, no.deps)).toEqual({
      ok: false,
      message: "Publish cancelled.",
    });
  });

  test("an unreachable hub fails closed", async () => {
    const dir = project({
      files: { "demo.js": 'import{Widget as e}from"@glasshome/widget-sdk";export default e;' },
    });
    const result = await settleSdkFloor(dir, "demo", "http://127.0.0.1:1", recorder().deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toStartWith("Could not read Dash releases from");
  });

  test("a hub that does not serve the table fails closed", async () => {
    const dir = project({
      files: { "demo.js": 'import{Widget as e}from"@glasshome/widget-sdk";export default e;' },
    });
    const result = await settleSdkFloor(dir, "demo", `${hubUrl}/elsewhere`, recorder().deps);
    expect(result.ok).toBe(false);
  });
});
