import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, isCancel, log, text } from "@clack/prompts";
import { defaultSdkRange, FALLBACK_SDK_RANGE } from "../utils/sdk-version";

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
    description: string;
  },
): void {
  const { widgetName, description } = opts;
  const widgetDir = resolve(cwd, "src", widgetName);

  if (existsSync(widgetDir)) {
    throw new Error(`src/${widgetName}/ already exists`);
  }

  mkdirSync(widgetDir, { recursive: true });

  const displayName = capitalize(widgetName);
  const widgetDescription = description || `A GlassHome dashboard widget: ${widgetName}`;

  // The range the host checks before mounting, derived from the SDK this
  // project actually builds against. Hardcoding it produced widgets that
  // declared a 0.2-era range while running on 1.x, which reads as "pre-1.0" to
  // `requiresCapabilities` and quietly excused them from declaring capabilities.
  const sdkRange = defaultSdkRange(cwd) ?? FALLBACK_SDK_RANGE;

  // Read index.tsx template from the template directory
  const templateDir = resolve(import.meta.dir, "../../template");
  let srcContent = readFileSync(resolve(templateDir, "src/index.tsx.template"), "utf-8");
  srcContent = srcContent.replace(/WIDGET_NAME/g, displayName);
  srcContent = srcContent.replace(/SDK_RANGE/g, sdkRange);
  writeFileSync(resolve(widgetDir, "index.tsx"), srcContent);

  // Generate manifest.json. `capabilities` is required for any SDK >= 1.0.0
  // range and an empty array is the honest default: a fresh widget reads
  // nothing from Home Assistant, and the declaration is what consent shows.
  const manifest = {
    name: displayName,
    description: widgetDescription,
    minSize: { w: 1, h: 1 },
    maxSize: { w: 4, h: 4 },
    defaultSize: { w: 2, h: 2 },
    sdkVersion: sdkRange,
    capabilities: [],
    version: "0.1.0",
  };
  writeFileSync(resolve(widgetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Interactive prompts for widget details. Returns null if cancelled. */
export async function promptWidgetDetails(defaults?: { widgetName?: string }): Promise<{
  widgetName: string;
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
