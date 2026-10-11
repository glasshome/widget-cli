import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { type ProcessRunner, runTypecheck } from "./typecheck";

// Inside the package so fixtures can resolve typescript from its node_modules,
// which is what a hoisted or workspace install looks like.
const tmpDir = mkdtempSync(join(import.meta.dir, ".typecheck-test-"));
// Outside it, for the one case that must find no typescript anywhere above it.
const isolatedDir = mkdtempSync(join(tmpdir(), "glasshome-typecheck-"));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(isolatedDir, { recursive: true, force: true });
});

/**
 * A real installed typescript to link into fixtures, or null.
 *
 * Resolved lazily and allowed to be absent: this package does not declare
 * typescript, so in the monorepo it comes from the root's node_modules and in a
 * standalone checkout there may be none at all. A hard resolve at module load
 * would take the whole file down there. The `node_modules` check keeps bun's
 * global-cache fallback out, which would not be a real install.
 */
function findTypescript(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve("typescript/package.json");
    return pkg.split(sep).includes("node_modules") ? dirname(pkg) : null;
  } catch {
    return null;
  }
}

const typescriptDir = findTypescript();
const noTypescript = typescriptDir === null;

let fixtureCount = 0;

/** Records each call and answers with fixed tsc output; no subprocess. */
function fakeRunner(result: { code: number | null; stdout?: string; stderr?: string }) {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  const run: ProcessRunner = (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    return { code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { run, calls };
}

/** A stand-in typescript install: enough for resolution, never executed. */
function fakeTypescript(dir: string) {
  const pkg = join(dir, "node_modules", "typescript");
  mkdirSync(join(pkg, "bin"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "typescript", version: "0.0.0" }),
  );
  writeFileSync(join(pkg, "bin", "tsc"), "");
  return join(pkg, "bin", "tsc");
}

interface ProjectOptions {
  source?: string;
  tsconfig?: boolean;
  typescript?: boolean;
  /** Somewhere with no node_modules above it, so nothing can be inherited. */
  isolated?: boolean;
}

function project({
  source,
  tsconfig = true,
  typescript = true,
  isolated = false,
}: ProjectOptions): string {
  const dir = join(isolated ? isolatedDir : tmpDir, `project-${fixtureCount++}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
  if (tsconfig) {
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "ESNext",
          target: "ESNext",
          moduleResolution: "bundler",
          // Hermetic: without this tsc auto-loads every @types package it finds
          // walking up to the monorepo root, which is both irrelevant to what
          // is under test and slow enough to blow the test timeout.
          types: [],
        },
        include: ["src"],
      }),
    );
  }
  if (typescript && typescriptDir) {
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    symlinkSync(typescriptDir, join(dir, "node_modules", "typescript"), "dir");
  }
  writeFileSync(join(dir, "src", "index.ts"), source ?? "export const n: number = 1;\n");
  return dir;
}

describe("runTypecheck", () => {
  test("passes a project whose types are sound", () => {
    const dir = project({ typescript: false });
    fakeTypescript(dir);
    const { run } = fakeRunner({ code: 0 });
    expect(runTypecheck(dir, run).status).toBe("ok");
  });

  test("fails on a type error and reports the file and message", () => {
    const dir = project({ typescript: false });
    const tsc = fakeTypescript(dir);
    const { run, calls } = fakeRunner({
      code: 2,
      stdout: `src/index.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\n`,
    });
    const result = runTypecheck(dir, run);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.output).toContain("src/index.ts");
    expect(result.output).toContain("TS2322");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([tsc, "--noEmit", "-p", join(dir, "tsconfig.json")]);
    expect(calls[0]?.cwd).toBe(dir);
  });

  test("reports the exit code when tsc fails without output", () => {
    const dir = project({ typescript: false });
    fakeTypescript(dir);
    const result = runTypecheck(dir, fakeRunner({ code: null }).run);
    expect(result).toEqual({ status: "failed", output: "tsc exited null" });
  });

  test("skips a project with no tsconfig rather than failing it", () => {
    // A JS-only or custom-setup project is not broken, it is just not ours to check.
    const { run, calls } = fakeRunner({ code: 0 });
    const result = runTypecheck(project({ tsconfig: false }), run);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toContain("tsconfig");
    expect(calls).toHaveLength(0);
  });

  test("skips when typescript is not installed in the project", () => {
    // Load-bearing: with nothing installed, bun still resolves a bare
    // "typescript" from its global install cache, so without the node_modules
    // check this would silently check against whatever major is cached there.
    const { run, calls } = fakeRunner({ code: 0 });
    const result = runTypecheck(project({ typescript: false, isolated: true }), run);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toContain("not installed");
    expect(calls).toHaveLength(0);
  });

  test("uses an ancestor's typescript, as hoisted and workspace installs give", () => {
    // Requiring a copy inside the project itself would skip every monorepo.
    const parent = project({ typescript: false });
    const tsc = fakeTypescript(parent);
    const child = join(parent, "nested");
    mkdirSync(join(child, "src"), { recursive: true });
    cpSync(join(parent, "package.json"), join(child, "package.json"));
    cpSync(join(parent, "tsconfig.json"), join(child, "tsconfig.json"));

    const { run, calls } = fakeRunner({ code: 2, stdout: "error TS2322" });
    expect(runTypecheck(child, run).status).toBe("failed");
    expect(calls[0]?.args[0]).toBe(tsc);
  });

  // Outcome only: the one test that runs the real compiler. The timeout is a
  // runner budget for slow machines, not an assertion about speed.
  test.skipIf(noTypescript)(
    "real tsc: passes sound types and fails a type error",
    () => {
      expect(runTypecheck(project({})).status).toBe("ok");
      const bad = runTypecheck(project({ source: `export const n: number = "nope";\n` }));
      expect(bad.status).toBe("failed");
    },
    60_000,
  );
});
