import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import {
  discoverWidgets,
  formatBytes,
  getWidgetBundleInfo,
  readManifest,
  readRegistry,
  type WidgetManifest,
} from "../utils/manifest";

const TAG_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function validateManifest(manifest: WidgetManifest): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!manifest.tag) errors.push("Missing required field: tag");
  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.sdkVersion) errors.push("Missing required field: sdkVersion");

  // Tag format
  if (manifest.tag && !TAG_REGEX.test(manifest.tag)) {
    errors.push(
      `Invalid tag format "${manifest.tag}" — must match ${TAG_REGEX} (e.g. glasshome-my-widget)`,
    );
  }

  // minSize validation
  if (
    !manifest.minSize ||
    typeof manifest.minSize !== "object" ||
    typeof manifest.minSize.w !== "number" ||
    typeof manifest.minSize.h !== "number"
  ) {
    errors.push("minSize must be an object with numeric w and h properties");
  }

  // maxSize validation
  if (
    !manifest.maxSize ||
    typeof manifest.maxSize !== "object" ||
    typeof manifest.maxSize.w !== "number" ||
    typeof manifest.maxSize.h !== "number"
  ) {
    errors.push("maxSize must be an object with numeric w and h properties");
  }

  // Schema validation
  if (manifest.schema) {
    if (typeof manifest.schema !== "object") {
      errors.push("Schema must be an object");
    } else {
      if (manifest.schema.type !== "object") {
        warnings.push('Schema type should be "object"');
      }
      if (!manifest.schema.properties || typeof manifest.schema.properties !== "object") {
        warnings.push("Schema should have a properties object");
      }
    }

    // Check defaultConfig matches schema properties
    if (manifest.defaultConfig && manifest.schema.properties) {
      const schemaKeys = Object.keys(manifest.schema.properties as Record<string, unknown>);
      const configKeys = Object.keys(manifest.defaultConfig);
      for (const key of configKeys) {
        if (!schemaKeys.includes(key)) {
          warnings.push(`defaultConfig key "${key}" is not defined in schema properties`);
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

export async function runValidate(
  cwd: string,
  widgetName?: string,
  options?: { quiet?: boolean },
): Promise<boolean> {
  const quiet = options?.quiet ?? false;
  const widgets = discoverWidgets(cwd);

  if (widgets.length === 0) {
    log.error("No widgets found in src/. Each widget needs a manifest.json.");
    return false;
  }

  const toValidate = widgetName ? widgets.filter((w) => w === widgetName) : widgets;

  if (widgetName && toValidate.length === 0) {
    log.error(`Widget "${widgetName}" not found. Available: ${widgets.join(", ")}`);
    return false;
  }

  // Auto-build if dist/ is missing
  const distDir = resolve(cwd, "dist");
  if (!existsSync(distDir)) {
    const s = spinner();
    s.start("Building widgets (dist/ not found)...");
    const proc = Bun.spawnSync(["bun", "run", "build"], { cwd });
    if (proc.exitCode !== 0) {
      s.stop("Build failed");
      log.error(proc.stderr.toString());
      return false;
    }
    s.stop("Build complete");
  }

  let allPassed = true;

  const failed: string[] = [];

  for (const name of toValidate) {
    if (!quiet) log.info(`\nValidating widget: ${name}`);

    // Read and validate manifest.json
    let manifest: WidgetManifest;
    try {
      manifest = readManifest(cwd, name);
    } catch (err) {
      if (!quiet) log.error(`  Failed to read manifest: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(name);
      allPassed = false;
      continue;
    }

    const result = validateManifest(manifest);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        if (!quiet) log.error(`  - ${err}`);
      }
    }

    if (!quiet && result.warnings.length > 0) {
      for (const warn of result.warnings) {
        log.warn(`  - ${warn}`);
      }
    }

    // Check bundle exists
    const bundlePath = resolve(cwd, "dist", `${name}.js`);
    if (!existsSync(bundlePath)) {
      if (!quiet) log.error(`  - dist/${name}.js not found`);
      allPassed = false;
      failed.push(name);
    } else if (!quiet) {
      try {
        const info = getWidgetBundleInfo(cwd, name);
        log.info(`  Bundle: ${formatBytes(info.raw)} (${formatBytes(info.gzip)} gzipped)`);
      } catch {
        // Ignore size reporting errors
      }
    }

    if (result.passed) {
      if (!quiet) log.success(`  ${name}: passed`);
    } else {
      if (!quiet) log.error(`  ${name}: failed`);
      failed.push(name);
      allPassed = false;
    }
  }

  // Validate registry.json
  const registry = readRegistry(cwd);
  if (!registry) {
    if (!quiet) log.error("\ndist/registry.json not found");
    allPassed = false;
  } else {
    const registryTags = new Set(registry.widgets.map((w) => w.bundleUrl));
    for (const name of toValidate) {
      if (!registryTags.has(`./${name}.js`)) {
        if (!quiet) log.error(`  Widget "${name}" not listed in registry.json`);
        allPassed = false;
      }
    }
    if (!quiet) log.info(`\nRegistry: ${registry.widgets.length} widget(s)`);
  }

  if (quiet) {
    if (allPassed) {
      log.success(`Validated ${toValidate.length} widget(s)`);
    } else {
      log.error(`Validation failed for: ${failed.join(", ")}`);
    }
  } else {
    if (allPassed) {
      log.success("\nAll checks passed");
    } else {
      log.error("\nValidation failed");
    }
  }

  return allPassed;
}
