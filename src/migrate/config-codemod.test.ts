import { describe, expect, test } from "bun:test";
import { migrateConfigSource } from "./config-codemod";

function migrate(body: string) {
  const code = `import { defineWidget, widgetFields, z } from "@glasshome/widget-sdk";\n\n${body}\n`;
  return migrateConfigSource(code, "widget.tsx");
}

describe("migrateConfigSource — field kinds", () => {
  test("widgetFields.* map to field.*", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  title: widgetFields.title(),\n  area: widgetFields.areaId(),\n  lights: widgetFields.entityIds("light"),\n  th: widgetFields.singleEntity("sensor", { deviceClass: "temperature" }),\n});`,
    );
    expect(r.changed).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain("defineConfig({");
    expect(r.code).toContain("title: field.title(),");
    expect(r.code).toContain("area: field.area(),");
    expect(r.code).toContain('lights: field.entities("light"),');
    expect(r.code).toContain('th: field.entity("sensor", { deviceClass: "temperature" }),');
  });

  test("raw scalars → field.text/number/toggle/choice", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  name: z.string().optional().meta({ title: "Name" }),\n  size: z.number().min(1).max(10).default(5).meta({ title: "Size" }),\n  on: z.boolean().default(false).meta({ title: "On" }),\n  style: z.enum(["a", "b"]).default("a").meta({ title: "Style" }),\n});`,
    );
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain('name: field.text({ title: "Name" }),');
    expect(r.code).toContain('size: field.number({ title: "Size", min: 1, max: 10, default: 5 }),');
    expect(r.code).toContain('on: field.toggle({ title: "On", default: false }),');
    expect(r.code).toContain('style: field.choice(["a", "b"], { title: "Style", default: "a" }),');
  });

  test("entity arrays with domain/deviceClass/singleSelect + stringList", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  ids: z.array(z.string()).default([]).meta({ domain: "light", title: "Lights" }),\n  one: z.array(z.string()).default([]).meta({ domain: "sensor", singleSelect: true, deviceClass: "power" }),\n  tags: z.array(z.string()).default([]).meta({ title: "Tags" }),\n});`,
    );
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain('ids: field.entities("light", { title: "Lights" }),');
    expect(r.code).toContain('one: field.entity("sensor", { deviceClass: "power" }),');
    expect(r.code).toContain('tags: field.stringList({ title: "Tags" }),');
  });

  test("nested z.object → field.group (clock analogOptions)", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  analogOptions: z.object({\n    border: z.boolean().default(false).meta({ title: "Show Border" }),\n    ticks: z.enum(["none", "hour"]).default("hour").meta({ title: "Tick Marks" }),\n  }).default({ border: false, ticks: "hour" }).meta({ title: "Analog Options" }),\n});`,
    );
    expect(r.warnings).toEqual([]);
    expect(r.code).toContain("analogOptions: field.group({");
    expect(r.code).toContain('border: field.toggle({ title: "Show Border", default: false }),');
    expect(r.code).toContain('ticks: field.choice(["none", "hour"], { title: "Tick Marks", default: "hour" }),');
    expect(r.code).toContain('}, { title: "Analog Options" }),');
  });

  test("z.infer → Infer", () => {
    const r = migrate(
      `export const configSchema = z.object({ title: widgetFields.title() });\nexport type Config = z.infer<typeof configSchema>;`,
    );
    expect(r.code).toContain("export type Config = Infer<typeof configSchema>;");
  });
});

describe("migrateConfigSource — imports", () => {
  test("adds defineConfig/field/Infer, drops widgetFields/z when unused", () => {
    const r = migrate(
      `export const configSchema = z.object({ title: widgetFields.title() });\nexport type Config = z.infer<typeof configSchema>;`,
    );
    const importLine = r.code.split("\n")[0];
    expect(importLine).toContain("defineConfig");
    expect(importLine).toContain("field");
    expect(importLine).toContain("Infer");
    // `Infer` is a type — must be type-only for verbatimModuleSyntax widgets.
    expect(importLine).toContain("type Infer");
    expect(importLine).not.toContain("widgetFields");
    expect(importLine).not.toContain(" z,");
    expect(importLine).not.toContain(" z ");
    expect(importLine).toContain("defineWidget");
  });

  test("keeps z when a raw field survives (escape hatch)", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  title: widgetFields.title(),\n  custom: z.string().url().meta({ title: "URL" }),\n});`,
    );
    expect(r.code.split("\n")[0]).toContain("z");
    expect(r.warnings.map((w) => w.field)).toContain("custom");
  });

  test("rewrites a bare zod import to the SDK import", () => {
    const code = `import { defineWidget } from "@glasshome/widget-sdk";\nimport { z } from "zod";\n\nexport const configSchema = z.object({\n  custom: z.string().refine((v) => !!v).meta({ title: "X" }),\n});`;
    const r = migrateConfigSource(code, "widget.tsx");
    expect(r.code).not.toContain('from "zod"');
    expect(r.code).toContain('from "@glasshome/widget-sdk"');
    expect(r.code.split("\n").find((l) => l.includes("widget-sdk"))).toContain("z");
  });
});

describe("migrateConfigSource — report and skip (never drop validation)", () => {
  test("factory-built + identifier fields are left raw and reported", () => {
    const r = migrate(
      `const powerEntity = (l: string) => z.array(z.string()).default([]).meta({ domain: "sensor", title: l });\nexport const configSchema = z.object({\n  title: widgetFields.title(),\n  solar: powerEntity("Solar"),\n  strategy: consumptionStrategy,\n});`,
    );
    expect(r.changed).toBe(true);
    expect(r.code).toContain("title: field.title(),");
    // unmigratable values preserved verbatim
    expect(r.code).toContain('solar: powerEntity("Solar"),');
    expect(r.code).toContain("strategy: consumptionStrategy,");
    const fields = r.warnings.map((w) => w.field).sort();
    expect(fields).toEqual(["solar", "strategy"]);
  });

  test("unsupported modifiers (.refine) are reported, value kept", () => {
    const r = migrate(
      `export const configSchema = z.object({\n  url: z.string().url().refine((v) => v.length > 0).meta({ title: "URL" }),\n});`,
    );
    expect(r.code).toContain("url: z.string().url().refine");
    expect(r.warnings[0]?.field).toBe("url");
    expect(r.warnings[0]?.reason).toContain("unsupported modifier");
  });

  test("no configSchema → unchanged", () => {
    const r = migrateConfigSource(`export const x = 1;\n`, "widget.tsx");
    expect(r.changed).toBe(false);
    expect(r.code).toBe(`export const x = 1;\n`);
  });
});
