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
  test("storage use is reported with the door to use", () => {
    root = mkdtempSync(join(tmpdir(), "lint-source-"));
    mkdirSync(join(root, "src", "neon"), { recursive: true });
    writeFileSync(join(root, "src", "neon", "index.tsx"), 'localStorage.setItem("k", "v");');
    const findings = lintAndReport(root, ["neon"]);
    expect(findings.map((f) => f.message)).toContain(
      "[@glasshome/widget-sdk] localStorage and sessionStorage are in memory and empty after every reload; keep what must last with useWidgetState (widget-sdk 1.28.0 and later).",
    );
  });

  test("the old icon import is reported with its replacement", () => {
    root = mkdtempSync(join(tmpdir(), "lint-source-"));
    mkdirSync(join(root, "src", "neon"), { recursive: true });
    writeFileSync(
      join(root, "src", "neon", "index.tsx"),
      'import { Icon } from "@iconify-icon/solid";',
    );
    const findings = lintAndReport(root, ["neon"]);
    expect(findings.map((f) => f.message).join("\n")).toContain("iconify-icon is deprecated");
  });

  test("a name that is not a widget is skipped", () => {
    root = mkdtempSync(join(tmpdir(), "lint-source-"));
    mkdirSync(join(root, "src", "neon"), { recursive: true });
    expect(lintAndReport(root, ["missing"])).toEqual([]);
  });
});
