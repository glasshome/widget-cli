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

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

function validateManifest(manifest: WidgetManifest): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasValidMinSize =
    !!manifest.minSize &&
    typeof manifest.minSize.w === "number" &&
    typeof manifest.minSize.h === "number";
  const hasValidMaxSize =
    !!manifest.maxSize &&
    typeof manifest.maxSize.w === "number" &&
    typeof manifest.maxSize.h === "number";

  // Required fields
  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.sdkVersion) errors.push("Missing required field: sdkVersion");

  // INS-05: "*" sdkVersion is rejected at publish time — authors must declare
  // a real range (e.g. "^0.3.0"). Installed widgets that already ship "*" are
  // still tolerated by the loader with a warn-and-mount, but new publishes
  // are blocked here.
  if (manifest.sdkVersion === "*") {
    errors.push(
      `sdkVersion "*" is not allowed — declare a semver range (e.g. "^0.3.0") to opt into host compatibility checks`,
    );
  }

  // Size validation
  if (!hasValidMinSize) {
    errors.push("minSize must be an object with numeric w and h properties");
  }
  if (!hasValidMaxSize) {
    errors.push("maxSize must be an object with numeric w and h properties");
  }
  if (
    manifest.defaultSize &&
    (typeof manifest.defaultSize.w !== "number" || typeof manifest.defaultSize.h !== "number")
  ) {
    errors.push("defaultSize must be an object with numeric w and h properties");
  }
  if (hasValidMinSize && hasValidMaxSize) {
    if (manifest.minSize.w > manifest.maxSize.w || manifest.minSize.h > manifest.maxSize.h) {
      errors.push("minSize must be less than or equal to maxSize");
    }
    if (manifest.defaultSize) {
      if (
        manifest.defaultSize.w < manifest.minSize.w ||
        manifest.defaultSize.h < manifest.minSize.h ||
        manifest.defaultSize.w > manifest.maxSize.w ||
        manifest.defaultSize.h > manifest.maxSize.h
      ) {
        errors.push("defaultSize must be within minSize and maxSize bounds");
      }
    }
  }

  // Schema validation
  if (manifest.schema) {
    if (typeof manifest.schema !== "object") {
      errors.push("Schema must be an object");
    } else {
      if ((manifest.schema as Record<string, unknown>).type !== "object") {
        warnings.push('Schema type should be "object"');
      }
      if (
        !(manifest.schema as Record<string, unknown>).properties ||
        typeof (manifest.schema as Record<string, unknown>).properties !== "object"
      ) {
        warnings.push("Schema should have a properties object");
      }
    }

    // Check defaultConfig matches schema properties
    if (manifest.defaultConfig && (manifest.schema as Record<string, unknown>).properties) {
      const schemaKeys = Object.keys(
        (manifest.schema as Record<string, unknown>).properties as Record<string, unknown>,
      );
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
    const proc = Bun.spawn(["bun", "run", "build"], { cwd, stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      s.stop("Build failed");
      log.error(stderr);
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
      if (!quiet)
        log.error(`  Failed to read manifest: ${err instanceof Error ? err.message : String(err)}`);
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
