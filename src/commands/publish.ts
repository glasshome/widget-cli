import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, isCancel, log, select, spinner } from "@clack/prompts";
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
  const s = spinner();

  // Step 1: Validate (quiet)
  const { runValidate } = await import("./validate");
  const valid = await runValidate(cwd, undefined, { quiet: true });
  if (!valid) {
    log.error("Fix validation errors before publishing.");
    process.exit(1);
  }

  // Step 2: Authenticate
  const hubUrl = hubUrlOverride ?? getHubUrl();
  if (hubUrlOverride) log.info(`Hub: ${hubUrl}`);
  let token = await getToken(hubUrl);

  if (!token) {
    log.warn("Not authenticated. Starting login...");
    try {
      await runLogin(hubUrl);
    } catch (err) {
      log.error(err instanceof Error ? err.message : "Login failed.");
      process.exit(1);
    }
    token = await getToken(hubUrl);
    if (!token) {
      log.error("Authentication failed. Run `glasshome-widget login` manually.");
      process.exit(1);
    }
  }

  // Step 3: Select scope
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

  // Step 4: Select widget
  const widgets = discoverWidgets(cwd);
  const widgetOptions = widgets.map((name) => {
    const manifest = readManifest(cwd, name);
    let sizeInfo = "";
    try {
      const info = getWidgetBundleInfo(cwd, name);
      sizeInfo = ` — ${formatBytes(info.raw)}`;
    } catch {}
    return {
      value: name,
      label: `${manifest.tag}${sizeInfo}`,
    };
  });

  const selected = await select({
    message: "Select widget to publish:",
    options: widgetOptions,
  });

  if (isCancel(selected)) {
    cancel("Publish cancelled.");
    process.exit(0);
  }

  const widgetName = selected as string;
  const manifest = readManifest(cwd, widgetName);

  // Step 5: Version bump (per-widget, from manifest)
  const currentVersion = manifest.version ?? "0.0.0";

  const bump = await select({
    message: `${manifest.tag} version: ${currentVersion}. Bump?`,
    options: [
      { value: "keep", label: `Keep ${currentVersion}`, hint: "fails if already published" },
      { value: "patch", label: `Patch (${semver.inc(currentVersion, "patch")})` },
      { value: "minor", label: `Minor (${semver.inc(currentVersion, "minor")})` },
      { value: "major", label: `Major (${semver.inc(currentVersion, "major")})` },
    ],
  });

  if (isCancel(bump)) {
    cancel("Publish cancelled.");
    process.exit(0);
  }

  let version = currentVersion;
  if (bump !== "keep") {
    version = semver.inc(currentVersion, bump as "patch" | "minor" | "major") ?? currentVersion;
    manifest.version = version;
    writeManifest(cwd, widgetName, manifest);
  }

  // Step 6: Build (async so spinner animates)
  s.start("Building widget...");
  const buildProc = Bun.spawn(["bun", "run", "build"], { cwd, stdout: "pipe", stderr: "pipe" });
  const buildExit = await buildProc.exited;
  if (buildExit !== 0) {
    const stderr = await new Response(buildProc.stderr).text();
    s.stop("Build failed");
    log.error(stderr);
    process.exit(1);
  }
  s.stop("Build complete");

  // Step 7: Publish
  const distPath = resolve(cwd, "dist", `${widgetName}.js`);

  let bundleBuffer: Buffer;
  try {
    bundleBuffer = Buffer.from(readFileSync(distPath));
  } catch {
    log.error(`Bundle not found: dist/${widgetName}.js`);
    process.exit(1);
  }

  const sha256Hash = createHash("sha256").update(bundleBuffer).digest("hex");

  s.start(`Publishing ${manifest.tag}@${version}...`);

  let publishData: Awaited<ReturnType<typeof requestPublish>>;
  try {
    publishData = await requestPublish(hubUrl, token!, {
      scope,
      name: widgetName,
      displayName: manifest.name,
      description: manifest.description,
      icon: manifest.icon,
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
      s.stop(`${manifest.tag}@${version} already published — bump version to republish`);
      process.exit(0);
    }
    s.stop(`Publish failed: ${err.message}`);
    process.exit(1);
  }

  s.message(`Uploading ${manifest.tag} to CDN...`);
  try {
    await uploadToR2(publishData.uploadUrl, bundleBuffer);
  } catch (err: any) {
    s.stop(`Upload failed: ${err.message}`);
    process.exit(1);
  }

  s.message(`Confirming ${manifest.tag}...`);
  try {
    const result = await confirmPublish(hubUrl, token!, publishData.versionId);
    s.stop(`Published ${manifest.tag}@${version}`);
    log.info(`CDN: ${result.bundleUrl}`);
  } catch (err: any) {
    s.stop(`Confirmation failed: ${err.message}`);
    process.exit(1);
  }
}
