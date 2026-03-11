import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import { discoverWidgets, readManifest, writeManifest } from "../utils/manifest";
import { runValidate } from "./validate";

/** Walk up from cwd looking for a package.json with a `workspaces` field. */
function findMonorepoRoot(from: string): string | null {
  let dir = resolve(from);
  const root = (dir.match(/^[A-Za-z]:\\/) ?? ["/"])[0];
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir || parent === root) break;
    dir = parent;
  }
  return null;
}

/** Find @glasshome/widget-sdk version from workspace resolution or node_modules. */
function findWorkspaceSdkVersion(monorepoRoot: string): string | null {
  const sdkPkgPaths = [
    join(monorepoRoot, "widget-sdk/package.json"),
    join(monorepoRoot, "node_modules/@glasshome/widget-sdk/package.json"),
  ];

  for (const sdkPath of sdkPkgPaths) {
    if (existsSync(sdkPath)) {
      try {
        const sdkPkg = JSON.parse(readFileSync(sdkPath, "utf-8"));
        if (sdkPkg.version) return sdkPkg.version;
      } catch {}
    }
  }
  return null;
}

/** Update sdkVersion in all manifest.json files. */
function syncManifestSdkVersions(cwd: string, newVersion: string): void {
  const widgets = discoverWidgets(cwd);
  if (widgets.length === 0) return;

  const sdkRange = `^${newVersion}`;
  for (const name of widgets) {
    const manifest = readManifest(cwd, name);
    if (manifest.sdkVersion !== sdkRange) {
      manifest.sdkVersion = sdkRange;
      writeManifest(cwd, name, manifest);
    }
  }
  log.info(`Updated sdkVersion to ${sdkRange} in ${widgets.length} manifest(s)`);
}

export async function runUpgrade(cwd: string): Promise<void> {
  const pkgPath = resolve(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    log.error("No package.json found in current directory.");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const currentVersion =
    pkg.peerDependencies?.["@glasshome/widget-sdk"] ??
    pkg.devDependencies?.["@glasshome/widget-sdk"] ??
    pkg.dependencies?.["@glasshome/widget-sdk"];

  if (!currentVersion) {
    log.error("@glasshome/widget-sdk is not listed in dependencies or peerDependencies.");
    process.exit(1);
  }

  log.info(`Current @glasshome/widget-sdk version: ${currentVersion}`);

  const monorepoRoot = findMonorepoRoot(cwd);

  if (monorepoRoot) {
    // Workspace mode: read SDK version from workspace, sync with bun install
    const sdkVersion = findWorkspaceSdkVersion(monorepoRoot);

    if (!sdkVersion) {
      log.warn(
        "Could not find @glasshome/widget-sdk in the workspace. Run `bun install` from the monorepo root.",
      );
      return;
    }

    const cleanCurrent = currentVersion.replace(/^[\^~]/, "");
    if (cleanCurrent === sdkVersion) {
      log.success(`Already up to date with workspace SDK (${sdkVersion})`);
      // Still sync manifests in case they're out of date
      syncManifestSdkVersions(cwd, sdkVersion);
      return;
    }

    log.info(`Workspace SDK version: ${sdkVersion}`);

    const s = spinner();
    s.start("Syncing workspace dependencies...");
    const installProc = Bun.spawnSync(["bun", "install"], { cwd: monorepoRoot });
    if (installProc.exitCode !== 0) {
      s.stop("Install failed");
      log.error(installProc.stderr.toString());
      process.exit(1);
    }
    s.stop("Dependencies synced");

    // Sync sdkVersion in all manifest.json files
    syncManifestSdkVersions(cwd, sdkVersion);

    // Run validate to check compatibility
    log.info("Checking compatibility...");
    const valid = await runValidate(cwd);
    if (valid) {
      log.success(`Synced with workspace @glasshome/widget-sdk@${sdkVersion}`);
    } else {
      log.warn(`Synced to ${sdkVersion} but validation has warnings/errors. Check above.`);
    }
  } else {
    // Standalone mode: can't fetch from npm (private package), guide user
    log.info("@glasshome/widget-sdk is a workspace package and is not published to npm.");
    log.info("");
    log.step("To upgrade:");
    log.info("  1. Update the @glasshome/widget-sdk version in your package.json peerDependencies");
    log.info("  2. Run `bun install` to install the new version");
    log.info("  3. Run `bun widget upgrade` again to sync manifest files");
    log.info("  4. Run `bun widget validate` to check compatibility");
  }
}
