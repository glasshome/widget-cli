import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WidgetManifest } from "../utils/manifest";
import { validateCatalogs } from "./validate";

let root: string | undefined;
const SDK_HOOK = 'import { useTranslation } from "@glasshome/widget-sdk"; ';

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const manifest: WidgetManifest = {
  name: "Climate",
  minSize: { w: 2, h: 2 },
  maxSize: { w: 4, h: 4 },
  description: "Thermostat",
  sdkVersion: "^1.34.0",
  schema: { type: "object", properties: {} },
};

function widget(files: Record<string, string>, source = ""): string {
  root = mkdtempSync(join(tmpdir(), "validate-"));
  mkdirSync(join(root, "src", "climate", "locales"), { recursive: true });
  writeFileSync(join(root, "src", "climate", "index.tsx"), source);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, "src", "climate", "locales", name), text);
  }
  return root;
}

describe("validateCatalogs", () => {
  test("a clean widget passes", () => {
    const cwd = widget(
      { "en.json": '{"hi":"Hello"}' },
      SDK_HOOK + 'const { t } = useTranslation();\nt("hi")',
    );
    expect(validateCatalogs(cwd, "climate", manifest)).toEqual({ errors: [], warnings: [] });
  });

  test("a manifest key written in en.json is author-defined", () => {
    const cwd = widget({ "en.json": '{"manifest.name":"X"}' });
    const { errors } = validateCatalogs(cwd, "climate", manifest);
    expect(errors.join("\n")).toContain("author-defined");
  });

  test("a locale's reserved name over the limit, text past the grammar or an unknown key fails", () => {
    const long = "n".repeat(101);
    const cwd = widget({
      "en.json": '{"hi":"Hello"}',
      "fr.json": JSON.stringify({ hi: "Salut", "manifest.name": long }),
      "es.json": JSON.stringify({ hi: "Hola", "manifest.name": "Clima {x}" }),
      "de.json": JSON.stringify({ hi: "Hallo", "manifest.config.nope.title": "x" }),
    });
    const errors = validateCatalogs(cwd, "climate", manifest).errors.join("\n");
    expect(errors).toContain("fr.json");
    expect(errors).toContain("too-long");
    expect(errors).toContain("grammar");
    expect(errors).toContain("unknown-key");
  });

  test("a literal t() key missing from en.json fails with key, file and line", () => {
    const cwd = widget(
      { "en.json": '{"hi":"Hello"}' },
      SDK_HOOK + 'const { t } = useTranslation();\nt("missing");',
    );
    const { errors } = validateCatalogs(cwd, "climate", manifest);
    expect(errors).toEqual(['src/climate/index.tsx:2 t("missing") is not in locales/en.json']);
  });

  test("non-literal t() keys are warnings, never errors", () => {
    const source =
      SDK_HOOK + 'const { t } = useTranslation();\nt(someVar);\nt(`a.${x}`);\nt("a" + b);';
    const cwd = widget({ "en.json": '{"hi":"Hello"}' }, source);
    const result = validateCatalogs(cwd, "climate", manifest);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.slice(0, 24))).toEqual([
      "src/climate/index.tsx:2 ",
      "src/climate/index.tsx:3 ",
      "src/climate/index.tsx:4 ",
    ]);
  });

  test("a renamed destructure and the SDK import are checked", () => {
    const source =
      'import { t, useTranslation } from "@glasshome/widget-sdk";\nconst { t: tr } = useTranslation();\ntr("one");\nt("two");';
    const cwd = widget({ "en.json": "{}" }, source);
    expect(validateCatalogs(cwd, "climate", manifest).errors).toEqual([
      'src/climate/index.tsx:3 t("one") is not in locales/en.json',
      'src/climate/index.tsx:4 t("two") is not in locales/en.json',
    ]);
  });

  test("an en.json that does not parse is an error", () => {
    const cwd = widget({ "en.json": "{oops" });
    expect(validateCatalogs(cwd, "climate", manifest).errors.join("\n")).toContain(
      "does not parse",
    );
  });

  test("a locale key absent from en.json warns; an unparseable locale file errors", () => {
    const cwd = widget({
      "en.json": '{"hi":"Hello"}',
      "fr.json": '{"hi":"Bonjour","extra":"Plus"}',
      "de.json": "[]",
    });
    const result = validateCatalogs(cwd, "climate", manifest);
    expect(result.warnings.join("\n")).toContain('locales/fr.json: key "extra"');
    expect(result.errors.join("\n")).toContain("locales/de.json");
  });

  test("a refused locale file name errors", () => {
    const cwd = widget({ "en.json": "{}", "en-XA.json": "{}", "pt.json": "{}" });
    const { errors } = validateCatalogs(cwd, "climate", manifest);
    expect(errors.join("\n")).toContain("locales/en-XA.json");
    expect(errors.join("\n")).toContain("locales/pt.json");
  });

  test("a blank display name fails", () => {
    const cwd = widget({});
    const { errors } = validateCatalogs(cwd, "climate", {
      ...manifest,
      displayName: "ㅤ",
    } as WidgetManifest);
    expect(errors.join("\n")).toContain("blank");
  });

  test("a reserved value the catalog grammar cannot carry warns and stays English", () => {
    const cwd = widget({});
    const result = validateCatalogs(cwd, "climate", { ...manifest, description: "Use {x}" });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'Reserved key "manifest.description" stays English in every language: translations carry plain text only, without {, <, tabs or past the length limit',
    ]);
  });
});
