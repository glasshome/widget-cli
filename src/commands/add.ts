import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, isCancel, log, text } from "@clack/prompts";

/** Capitalize kebab-case into PascalCase for component names. */
function capitalize(str: string): string {
  return str
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Create the widget source files in src/{widgetName}/. */
export function scaffoldWidget(
  cwd: string,
  opts: {
    widgetName: string;
    tag: string;
    description: string;
  },
): void {
  const { widgetName, tag, description } = opts;
  const widgetDir = resolve(cwd, "src", widgetName);

  if (existsSync(widgetDir)) {
    throw new Error(`src/${widgetName}/ already exists`);
  }

  mkdirSync(widgetDir, { recursive: true });

  const displayName = capitalize(widgetName);
  const widgetDescription = description || `A GlassHome dashboard widget: ${widgetName}`;

  // Read index.tsx template from the template directory
  const templateDir = resolve(import.meta.dir, "../../template");
  let srcContent = readFileSync(resolve(templateDir, "src/index.tsx.template"), "utf-8");
  srcContent = srcContent.replace(/WIDGET_TAG/g, tag);
  srcContent = srcContent.replace(/WIDGET_NAME/g, displayName);
  writeFileSync(resolve(widgetDir, "index.tsx"), srcContent);

  // Generate manifest.json
  const manifest = {
    tag,
    name: displayName,
    description: widgetDescription,
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 4 },
    sdkVersion: "^0.2.0",
    version: "0.1.0",
  };
  writeFileSync(resolve(widgetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Interactive prompts for widget details. Returns null if cancelled. */
export async function promptWidgetDetails(defaults?: { widgetName?: string }): Promise<{
  widgetName: string;
  tag: string;
  description: string;
} | null> {
  const widgetName = await text({
    message: "Widget name",
    placeholder: "clock",
    defaultValue: defaults?.widgetName,
    validate(value) {
      if (!value) return "Name is required";
      if (/\s/.test(value)) return "Name cannot contain spaces";
      if (!/^[a-z]/.test(value)) return "Name must start with a lowercase letter";
      if (!/^[a-z][a-z0-9-]*$/.test(value))
        return "Name must be lowercase alphanumeric with optional hyphens";
    },
  });
  if (isCancel(widgetName)) {
    cancel("Operation cancelled.");
    return null;
  }

  const tag = await text({
    message: "Custom element tag",
    placeholder: `glasshome-${widgetName}`,
    defaultValue: `glasshome-${widgetName}`,
    validate(value) {
      if (!value) return "Tag is required";
      if (!/^[a-z]/.test(value)) return "Tag must start with a lowercase letter";
      if (!value.includes("-")) return "Custom element tags must contain a hyphen";
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(value))
        return "Tag must be lowercase alphanumeric with hyphens (e.g. glasshome-my-widget)";
    },
  });
  if (isCancel(tag)) {
    cancel("Operation cancelled.");
    return null;
  }

  const description = await text({
    message: "Description (optional)",
    placeholder: "A GlassHome dashboard widget",
    defaultValue: "",
  });
  if (isCancel(description)) {
    cancel("Operation cancelled.");
    return null;
  }

  return {
    widgetName: widgetName as string,
    tag: tag as string,
    description: description as string,
  };
}

export async function runAdd(cwd: string): Promise<void> {
  // Verify project structure
  const srcDir = resolve(cwd, "src");
  if (!existsSync(srcDir)) {
    log.error("No src/ directory found. Are you in a GlassHome widget project?");
    process.exit(1);
  }

  const details = await promptWidgetDetails();
  if (!details) process.exit(0);

  const widgetDir = resolve(srcDir, details.widgetName);
  if (existsSync(widgetDir)) {
    log.error(`src/${details.widgetName}/ already exists.`);
    process.exit(1);
  }

  try {
    scaffoldWidget(cwd, details);
    log.success(`Widget "${details.widgetName}" added at src/${details.widgetName}/`);
    log.info("Run `bun run build` to include it in the registry.");
  } catch (err) {
    log.error(`Failed to add widget: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
