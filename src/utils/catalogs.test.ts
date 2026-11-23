import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitCatalogs } from "./catalogs";

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function fixture(schema: unknown = { type: "object", properties: {} }): string {
  root = mkdtempSync(join(tmpdir(), "catalogs-"));
  mkdirSync(join(root, "src", "climate", "locales"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "src", "climate", "locales", "en.json"), '{"hi":"Hello"}');
  writeFileSync(join(root, "src", "climate", "locales", "fr.json"), '{"hi":"Bonjour"}');
  writeFileSync(join(root, "src", "climate", "locales", "en-XA.json"), '{"hi":"Hello"}');
  writeFileSync(
    join(root, "dist", "registry.json"),
    JSON.stringify({
      version: 1,
      widgets: [{ name: "Climate", version: "1.0.0", bundleUrl: "./climate.js", schema }],
    }),
  );
  return root;
}

const read = (cwd: string, file: string) =>
  JSON.parse(readFileSync(join(cwd, "dist", "climate", "locales", file), "utf8"));

describe("emitCatalogs", () => {
  test("en.json holds the author keys and the reserved manifest keys", () => {
    const cwd = fixture();
    emitCatalogs(cwd);
    expect(read(cwd, "en.json")).toEqual({ hi: "Hello", "manifest.name": "Climate" });
  });

  test("other sidecar locales are copied; en-XA is not", () => {
    const cwd = fixture();
    emitCatalogs(cwd);
    expect(read(cwd, "fr.json")).toEqual({ hi: "Bonjour" });
    expect(existsSync(join(cwd, "dist", "climate", "locales", "en-XA.json"))).toBe(false);
  });

  test("a widget with no locales folder still ships its reserved keys", () => {
    const cwd = fixture();
    rmSync(join(cwd, "src", "climate", "locales"), { recursive: true });
    emitCatalogs(cwd);
    expect(read(cwd, "en.json")).toEqual({ "manifest.name": "Climate" });
  });

  test("SDK field presets land as reserved config keys", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string", title: "Title", description: "Optional display name override" },
        entities: { type: "array", title: "Entities", items: { type: "string" } },
        area: { type: "string", title: "Area", formType: "area-picker" },
      },
    };
    const cwd = fixture(schema);
    emitCatalogs(cwd);
    const en = read(cwd, "en.json");
    expect(en["manifest.config.title.title"]).toBe("Title");
    expect(en["manifest.config.entities.title"]).toBe("Entities");
    expect(en["manifest.config.area.title"]).toBe("Area");
    expect(en["manifest.config.title.description"]).toBe("Optional display name override");
  });
});
