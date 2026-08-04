import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { runTypecheck } from "./typecheck";

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
  test.skipIf(noTypescript)("passes a project whose types are sound", () => {
    expect(runTypecheck(project({})).status).toBe("ok");
  });

  test.skipIf(noTypescript)("fails on a type error and reports the file and message", () => {
    const result = runTypecheck(project({ source: `export const n: number = "nope";\n` }));
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.output).toContain("src/index.ts");
    expect(result.output).toContain("TS2322");
  });

  test("skips a project with no tsconfig rather than failing it", () => {
    // A JS-only or custom-setup project is not broken, it is just not ours to check.
    const result = runTypecheck(project({ tsconfig: false }));
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toContain("tsconfig");
  });

  test("skips when typescript is not installed in the project", () => {
    // Load-bearing: with nothing installed, bun still resolves a bare
    // "typescript" from its global install cache, so without the node_modules
    // check this would silently check against whatever major is cached there.
    const result = runTypecheck(project({ typescript: false, isolated: true }));
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") return;
    expect(result.reason).toContain("not installed");
  });

  test.skipIf(noTypescript)("uses an ancestor's typescript, as hoisted and workspace installs give", () => {
    // Requiring a copy inside the project itself would skip every monorepo.
    const parent = project({ typescript: true });
    const child = join(parent, "nested");
    mkdirSync(join(child, "src"), { recursive: true });
    cpSync(join(parent, "package.json"), join(child, "package.json"));
    cpSync(join(parent, "tsconfig.json"), join(child, "tsconfig.json"));
    writeFileSync(join(child, "src", "index.ts"), `export const n: number = "nope";\n`);

    expect(runTypecheck(child).status).toBe("failed");
  });
});
