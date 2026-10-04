import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintAndReport } from "./lint-source";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("lintAndReport", () => {
  test("a widget stylesheet reading the glass internals warns; the public contract does not", () => {
    root = mkdtempSync(join(tmpdir(), "lint-source-"));
    mkdirSync(join(root, "src", "neon"), { recursive: true });
    writeFileSync(
      join(root, "src", "neon", "neon.css"),
      [
        ".key { box-shadow: var(--surface-raised); background: var(--surface-face); }",
        ".rim { box-shadow: var(--glass-rim-shine); }",
      ].join("\n"),
    );
    const findings = lintAndReport(root, ["neon"]);
    expect(findings.map((f) => f.line)).toEqual([2]);
    expect(findings[0]?.message).toContain("internal-material-vars");
  });
});
