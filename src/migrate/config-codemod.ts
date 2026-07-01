import { Node, type ObjectLiteralExpression, Project, SyntaxKind } from "ts-morph";

/**
 * Codemod: rewrite a widget's raw-zod config to the SDK config API
 * (`defineConfig` + `field.*`). Assistive, never destructive: any field pattern it
 * does not recognize (custom refinements, unions, factory-built schemas, local
 * identifiers) is left as raw zod inside `defineConfig` and reported as a manual TODO.
 * `defineConfig` accepts raw `ZodType` values, so a partially-migrated schema still
 * compiles and validates identically. Powered by `bun widget migrate config`.
 */

export interface MigrationWarning {
  field: string;
  reason: string;
}

export interface MigrationResult {
  code: string;
  changed: boolean;
  warnings: MigrationWarning[];
}

const KNOWN_MODIFIERS = new Set(["optional", "default", "min", "max", "meta"]);

const WIDGET_FIELDS_MAP: Record<string, string> = {
  title: "field.title",
  entityIds: "field.entities",
  singleEntity: "field.entity",
  areaId: "field.area",
};

interface ParsedChain {
  baseObj: string; // "z" | "widgetFields"
  baseMethod: string; // "object" | "enum" | ... | "title"
  baseArgs: Node[];
  optional: boolean;
  defaultText?: string;
  minText?: string;
  maxText?: string;
  meta?: ObjectLiteralExpression;
  unknownMod?: string;
}

/** Walk a zod method chain from outside in; returns null for non-chain expressions. */
function parseChain(expr: Node): ParsedChain | null {
  const mods: { name: string; args: Node[] }[] = [];
  let cur: Node = expr;
  while (Node.isCallExpression(cur)) {
    const callee = cur.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return null; // e.g. powerEntity(...)
    const recv = callee.getExpression();
    const name = callee.getName();
    if (Node.isIdentifier(recv) && (recv.getText() === "z" || recv.getText() === "widgetFields")) {
      // Reached the base constructor.
      const parsed: ParsedChain = {
        baseObj: recv.getText(),
        baseMethod: name,
        baseArgs: cur.getArguments(),
        optional: false,
      };
      for (const m of mods) {
        if (!KNOWN_MODIFIERS.has(m.name)) parsed.unknownMod = m.name;
        if (m.name === "optional") parsed.optional = true;
        else if (m.name === "default") parsed.defaultText = m.args[0]?.getText();
        else if (m.name === "min") parsed.minText = m.args[0]?.getText();
        else if (m.name === "max") parsed.maxText = m.args[0]?.getText();
        else if (m.name === "meta") {
          const arg = m.args[0];
          if (arg && Node.isObjectLiteralExpression(arg)) parsed.meta = arg;
        }
      }
      return parsed;
    }
    mods.push({ name, args: cur.getArguments() });
    cur = recv;
  }
  return null;
}

/** Read an object-literal's string/boolean/simple props into name → source text. */
function readMeta(meta: ObjectLiteralExpression | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta) return out;
  for (const prop of meta.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const init = prop.getInitializer();
      if (init) out[prop.getName()] = init.getText();
    }
  }
  return out;
}

/** Emit `{ key: value, ... }` for the present entries, preserving source text. */
function optionsObject(entries: [string, string | undefined][]): string {
  const parts = entries.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * Transform one field expression to its `field.*` form, or return a skip reason.
 * `indent` is the leading whitespace for a nested `group` shape.
 */
function transformField(expr: Node, indent: string): { text: string } | { skip: string } {
  const c = parseChain(expr);
  if (!c) return { skip: "not a zod chain (factory/identifier/custom expression)" };
  if (c.unknownMod) return { skip: `unsupported modifier .${c.unknownMod}()` };

  // widgetFields.* → field.*
  if (c.baseObj === "widgetFields") {
    const mapped = WIDGET_FIELDS_MAP[c.baseMethod];
    if (!mapped) return { skip: `unknown widgetFields.${c.baseMethod}` };
    const args = c.baseArgs.map((a) => a.getText()).join(", ");
    return { text: `${mapped}(${args})` };
  }

  const m = readMeta(c.meta);
  const title = m.title;
  const description = m.description;

  switch (c.baseMethod) {
    case "string": {
      if (m.formType === '"area-picker"' || m.formType === "'area-picker'") {
        return {
          text: `field.area(${title && title !== '"Area"' ? optionsObject([["title", title]]) : ""})`,
        };
      }
      if (!title) return { skip: "z.string() without a title cannot map to field.text" };
      return {
        text: `field.text(${optionsObject([
          ["title", title],
          ["description", description],
          ["default", c.defaultText],
        ])})`,
      };
    }
    case "number": {
      if (!title) return { skip: "z.number() without a title" };
      return {
        text: `field.number(${optionsObject([
          ["title", title],
          ["description", description],
          ["min", c.minText],
          ["max", c.maxText],
          ["default", c.defaultText],
        ])})`,
      };
    }
    case "boolean": {
      if (!title) return { skip: "z.boolean() without a title" };
      return {
        text: `field.toggle(${optionsObject([
          ["title", title],
          ["description", description],
          ["default", c.defaultText],
        ])})`,
      };
    }
    case "enum": {
      if (!title) return { skip: "z.enum() without a title" };
      const values = c.baseArgs[0]?.getText() ?? "[]";
      return {
        text: `field.choice(${values}, ${optionsObject([
          ["title", title],
          ["description", description],
          ["default", c.defaultText],
        ])})`,
      };
    }
    case "array": {
      const inner = c.baseArgs[0];
      if (
        !inner ||
        !Node.isCallExpression(inner) ||
        inner.getExpression().getText() !== "z.string"
      ) {
        return { skip: "z.array of a non-string element" };
      }
      if (m.domain) {
        const domain = m.domain;
        const opts = optionsObject([
          ["title", title],
          ["description", description],
          ["deviceClass", m.deviceClass],
        ]);
        const optsArg = opts === "{  }" ? "" : `, ${opts}`;
        const fn = m.singleSelect === "true" ? "field.entity" : "field.entities";
        return { text: `${fn}(${domain}${optsArg})` };
      }
      if (!title) return { skip: "z.array(z.string()) without a domain or title" };
      return {
        text: `field.stringList(${optionsObject([
          ["title", title],
          ["description", description],
        ])})`,
      };
    }
    case "object": {
      if (!title) return { skip: "nested z.object() without a title" };
      const innerArg = c.baseArgs[0];
      if (!innerArg || !Node.isObjectLiteralExpression(innerArg))
        return { skip: "z.object() with a non-literal shape" };
      const shape = buildShape(innerArg, `${indent}  `);
      return { text: `field.group(${shape.text}, ${optionsObject([["title", title]])})` };
    }
    default:
      return { skip: `unsupported base z.${c.baseMethod}()` };
  }
}

/** Build a `{ key: <field>, ... }` shape literal from an object of zod fields. */
function buildShape(
  obj: ObjectLiteralExpression,
  indent: string,
): { text: string; warnings: MigrationWarning[] } {
  const warnings: MigrationWarning[] = [];
  const lines: string[] = [];
  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) {
      // Spread, shorthand, method — leave the whole thing untouched conservatively.
      lines.push(`${indent}  ${prop.getText()}`);
      warnings.push({
        field: prop.getText().slice(0, 40),
        reason: "non-standard property (spread/shorthand)",
      });
      continue;
    }
    const name = prop.getName();
    const init = prop.getInitializer();
    if (!init) continue;
    const result = transformField(init, `${indent}  `);
    if ("text" in result) {
      lines.push(`${indent}  ${name}: ${result.text},`);
    } else {
      lines.push(`${indent}  ${name}: ${init.getText()},`);
      warnings.push({ field: name, reason: result.skip });
    }
  }
  return { text: `{\n${lines.join("\n")}\n${indent}}`, warnings };
}

function rewriteNamedImport(
  project: Project,
  filePath: string,
  moduleName: string,
  add: { name: string; isTypeOnly?: boolean }[],
  remove: string[],
): void {
  const sf = project.getSourceFileOrThrow(filePath);
  const decl = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === moduleName);
  if (!decl) return;
  for (const named of decl.getNamedImports()) {
    if (remove.includes(named.getName())) named.remove();
  }
  const existing = new Set(decl.getNamedImports().map((n) => n.getName()));
  const toAdd = add.filter((n) => !existing.has(n.name));
  // `Infer` is a type: import it type-only so `verbatimModuleSyntax` widgets compile.
  if (toAdd.length > 0) decl.addNamedImports(toAdd);
  // Drop an import that has no remaining named/default/namespace bindings.
  if (
    decl.getNamedImports().length === 0 &&
    !decl.getDefaultImport() &&
    !decl.getNamespaceImport()
  ) {
    decl.remove();
  }
}

export function migrateConfigSource(code: string, filePath = "widget.tsx"): MigrationResult {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(filePath, code);

  const decl = sf.getVariableDeclaration("configSchema");
  const initializer = decl?.getInitializer();
  const warnings: MigrationWarning[] = [];
  let changed = false;

  if (
    initializer &&
    Node.isCallExpression(initializer) &&
    initializer.getExpression().getText() === "z.object"
  ) {
    const shapeArg = initializer.getArguments()[0];
    if (shapeArg && Node.isObjectLiteralExpression(shapeArg)) {
      const built = buildShape(shapeArg, "");
      warnings.push(...built.warnings);
      initializer.replaceWithText(`defineConfig(${built.text})`);
      changed = true;
    }
  }

  // z.infer<...> → Infer<...>
  for (const ref of sf.getDescendantsOfKind(SyntaxKind.TypeReference)) {
    if (ref.getText().startsWith("z.infer")) {
      ref.getTypeName().replaceWithText("Infer");
      changed = true;
    }
  }

  if (!changed) return { code, changed: false, warnings };

  // Recompute which SDK symbols the migrated body needs (ignore import statements).
  const body = sf
    .getStatements()
    .filter((s) => !Node.isImportDeclaration(s))
    .map((s) => s.getText())
    .join("\n");
  const needField = /\bfield\./.test(body);
  const needDefineConfig = /\bdefineConfig\(/.test(body);
  const needInfer = /\bInfer\s*</.test(body);
  const needZ = /\bz\./.test(body);
  const usesWidgetFields = /\bwidgetFields\./.test(body);

  const add: { name: string; isTypeOnly?: boolean }[] = [];
  if (needField) add.push({ name: "field" });
  if (needDefineConfig) add.push({ name: "defineConfig" });
  if (needInfer) add.push({ name: "Infer", isTypeOnly: true });
  const remove: string[] = [];
  if (!usesWidgetFields) remove.push("widgetFields");
  if (!needZ) remove.push("z");

  // Move any surviving `z` need onto the SDK import; drop the bare "zod" import.
  const zodDecl = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === "zod");
  if (zodDecl) {
    zodDecl.remove();
    if (needZ) add.push({ name: "z" });
  }

  rewriteNamedImport(project, filePath, "@glasshome/widget-sdk", add, remove);

  return { code: sf.getFullText(), changed, warnings };
}
