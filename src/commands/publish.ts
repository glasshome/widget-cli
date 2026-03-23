import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, isCancel, log, multiselect, select, spinner } from "@clack/prompts";
import semver from "semver";
import { getHubUrl, getToken } from "../utils/auth";
import { confirmPublish, fetchScopes, requestPublish, uploadToR2 } from "../utils/hub-api";
import {
  discoverWidgets,
  formatBytes,
  getWidgetBundleInfo,
  readManifest,
  writeManifest,
} from "../utils/manifest";
import { runLogin } from "./login";

export async function runPublish(cwd: string, hubUrlOverride?: string): Promise<void> {
  // Step 1: Validate all widgets
  log.info("Running validation...");
  const { runValidate } = await import("./validate");
  const valid = await runValidate(cwd);
  if (!valid) {
    log.error("Fix validation errors before publishing.");
    process.exit(1);
  }

  // Step 2: Read package.json
  const pkgPath = resolve(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion = pkg.version ?? "0.0.0";

  // Step 3: Version bump prompt
  const bump = await select({
    message: `Current version: ${currentVersion}. Bump version?`,
    options: [
      { value: "keep", label: `Keep ${currentVersion}`, hint: "fails if already published" },
      {
        value: "patch",
        label: `Patch (${semver.inc(currentVersion, "patch")})`,
      },
      {
        value: "minor",
        label: `Minor (${semver.inc(currentVersion, "minor")})`,
      },
      {
        value: "major",
        label: `Major (${semver.inc(currentVersion, "major")})`,
      },
    ],
  });

  if (isCancel(bump)) {
    cancel("Publish cancelled.");
    process.exit(0);
  }

  let version = currentVersion;
  if (bump !== "keep") {
    version = semver.inc(currentVersion, bump as "patch" | "minor" | "major") ?? currentVersion;

    pkg.version = version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const allWidgets = discoverWidgets(cwd);
    for (const name of allWidgets) {
      const manifest = readManifest(cwd, name);
      manifest.version = version;
      writeManifest(cwd, name, manifest);
    }

    log.info(`Version bumped to ${version}`);
  }

  // Step 4: Rebuild
  const s = spinner();
  s.start("Building widgets...");
  const buildProc = Bun.spawnSync(["bun", "run", "build"], { cwd });
  if (buildProc.exitCode !== 0) {
    s.stop("Build failed");
    log.error(buildProc.stderr.toString());
    process.exit(1);
  }
  s.stop("Build complete");

  // Step 5: Show summary
  const widgets = discoverWidgets(cwd);
  log.success(`Ready for publishing: ${pkg.name}@${version}`);
  log.info("");

  for (const name of widgets) {
    const manifest = readManifest(cwd, name);
    let sizeInfo = "";
    try {
      const info = getWidgetBundleInfo(cwd, name);
      sizeInfo = ` — ${formatBytes(info.raw)} (${formatBytes(info.gzip)} gzipped)`;
    } catch {}
    log.info(
      `  ${manifest.tag} [${manifest.minSize.w}x${manifest.minSize.h} - ${manifest.maxSize.w}x${manifest.maxSize.h}]${sizeInfo}`,
    );
  }

  // Step 6: Authenticate with Hub
  const hubUrl = hubUrlOverride ?? getHubUrl();
  log.info(`Hub: ${hubUrl}`);
  let token = await getToken(hubUrl);

  if (!token) {
    log.warn("Not authenticated with Hub. Starting login...");
    try {
      await runLogin(hubUrl);
    } catch (err) {
      log.error(err instanceof Error ? err.message : "Login failed.");
      process.exit(1);
    }
    token = await getToken(hubUrl);
    if (!token) {
      log.error("Authentication failed. Run `bun widget login` manually.");
      process.exit(1);
    }
  }

  // Fetch available scopes from hub
  const scopes = await fetchScopes(hubUrl, token!);
  if (scopes.length === 0) {
    log.error("No publishing scopes available. Ensure your account is properly set up.");
    process.exit(1);
  }

  let scope: string;
  if (scopes.length === 1) {
    const only = scopes[0]!;
    scope = only.name;
    log.info(`Publishing as @${scope} (${only.type})`);
  } else {
    const choice = await select({
      message: "Publish under which scope?",
      options: scopes.map((s) => ({
        value: s.name,
        label: s.type === "personal" ? `@${s.name} (personal)` : `@${s.name} (${s.displayName})`,
      })),
    });

    if (isCancel(choice)) {
      cancel("Publish cancelled.");
      process.exit(0);
    }

    scope = choice as string;
  }

  // Step 7: Select widgets to publish
  const widgetOptions = widgets.map((name) => {
    const manifest = readManifest(cwd, name);
    return {
      value: name,
      label: `${manifest.tag} (${manifest.minSize.w}x${manifest.minSize.h} - ${manifest.maxSize.w}x${manifest.maxSize.h})`,
    };
  });

  const selected = await multiselect({
    message: "Select widgets to publish:",
    options: widgetOptions,
    initialValues: widgets,
  });

  if (isCancel(selected)) {
    cancel("Publish cancelled.");
    process.exit(0);
  }

  const selectedWidgets = selected as string[];
  if (selectedWidgets.length === 0) {
    log.warn("No widgets selected.");
    return;
  }

  // Step 8: Publish each selected widget
  const published: Array<{ name: string; cdnUrl: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const widgetName of selectedWidgets) {
    const manifest = readManifest(cwd, widgetName);
    const distPath = resolve(cwd, "dist", `${widgetName}.js`);

    let bundleBuffer: Buffer;
    try {
      bundleBuffer = Buffer.from(readFileSync(distPath));
    } catch {
      log.error(`Bundle not found: dist/${widgetName}.js`);
      continue;
    }

    // Compute SHA-256 hash
    const sha256Hash = createHash("sha256").update(bundleBuffer).digest("hex");

    s.start(`Publishing ${manifest.tag}@${version}...`);

    // Request publish (get presigned URL)
    let publishData: Awaited<ReturnType<typeof requestPublish>>;
    try {
      publishData = await requestPublish(hubUrl, token!, {
        scope,
        name: widgetName,
        displayName: manifest.name,
        description: manifest.description,
        minSize: manifest.minSize,
        maxSize: manifest.maxSize,
        sdkVersion: manifest.sdkVersion,
        version,
        bundleSize: bundleBuffer.byteLength,
        sha256Hash,
        manifestJson: JSON.stringify(manifest),
      });
    } catch (err: any) {
      if (err.status === 409) {
        s.stop(`Skipped ${manifest.tag}@${version}`);
        log.warn(`${manifest.tag}@${version}: already published (immutable)`);
        skipped.push({ name: manifest.tag, reason: "version already exists" });
        continue;
      }
      s.stop(`Failed ${manifest.tag}`);
      log.error(`${manifest.tag}: ${err.message}`);
      continue;
    }

    // Upload to R2
    s.message(`Uploading ${manifest.tag} to CDN...`);
    try {
      await uploadToR2(publishData.uploadUrl, bundleBuffer);
    } catch (err: any) {
      s.stop(`Upload failed for ${manifest.tag}`);
      log.error(`${manifest.tag}: ${err.message}`);
      continue;
    }

    // Confirm publish
    s.message(`Confirming ${manifest.tag}...`);
    try {
      const result = await confirmPublish(hubUrl, token!, publishData.versionId);
      s.stop(`Published ${manifest.tag}@${version}`);
      published.push({ name: manifest.tag, cdnUrl: result.bundleUrl });
    } catch (err: any) {
      s.stop(`Confirm failed for ${manifest.tag}`);
      log.error(`${manifest.tag}: ${err.message}`);
    }
  }

  // Step 9: Summary
  log.info("");
  if (published.length > 0) {
    log.success(`Published ${published.length} widget(s):`);
    for (const w of published) {
      log.info(`  ${w.name} -> ${w.cdnUrl}`);
    }
  }

  if (skipped.length > 0) {
    log.warn(`Skipped ${skipped.length} widget(s):`);
    for (const w of skipped) {
      log.info(`  ${w.name}: ${w.reason}`);
    }
  }

  if (published.length === 0 && skipped.length === 0) {
    log.error("No widgets were published.");
  }
}
