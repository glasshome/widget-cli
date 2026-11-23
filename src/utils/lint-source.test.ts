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
        ".key { box-shadow: var(--material-raised); background: var(--material-face); }",
        ".rim { box-shadow: var(--glass-rim-shine); }",
      ].join("\n"),
    );
    const findings = lintAndReport(root, ["neon"]);
    expect(findings.map((f) => f.line)).toEqual([2]);
    expect(findings[0]?.message).toContain("internal-material-vars");
  });

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

describe("locale-less formatting", () => {
  const lint = (source: string) => {
    root = mkdtempSync(join(tmpdir(), "lint-source-"));
    mkdirSync(join(root, "src", "neon"), { recursive: true });
    writeFileSync(join(root, "src", "neon", "index.tsx"), source);
    return lintAndReport(root, ["neon"]);
  };

  test("toLocaleString with no locale warns and names formatNumber", () => {
    const findings = lint("const s = x.toLocaleString();");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("formatNumber");
  });

  test("toLocaleString with a locale is quiet", () => {
    expect(lint('const s = x.toLocaleString("de-DE");')).toEqual([]);
  });

  test("a locale-less Intl formatter warns", () => {
    expect(lint("new Intl.NumberFormat().format(1);")).toHaveLength(1);
    expect(lint("new Intl.DateTimeFormat(undefined, { month: 'long' });")).toHaveLength(1);
    expect(lint('new Intl.NumberFormat("fr");')).toEqual([]);
  });

  test("localeCompare with one argument warns", () => {
    expect(lint("a.localeCompare(b);")).toHaveLength(1);
    expect(lint('a.localeCompare(b, "de");')).toEqual([]);
  });

  test("parsing a formatted number warns", () => {
    expect(lint("parseFloat(formatNumber(x));")).toHaveLength(1);
    expect(lint("Number(formatNumber(x));")).toHaveLength(1);
  });
});
