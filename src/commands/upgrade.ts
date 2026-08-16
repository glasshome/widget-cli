import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { log, spinner } from "@clack/prompts";
import { discoverWidgets, readManifest, writeManifest } from "../utils/manifest";
import { getInstalledSdkVersion } from "../utils/sdk-version";
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

const SDK_PKG = "@glasshome/widget-sdk";

type DependencySection = "peerDependencies" | "devDependencies" | "dependencies";
type PackageManifest = Partial<Record<DependencySection, Record<string, string>>>;

const SECTION_FLAG: Record<DependencySection, string[]> = {
  peerDependencies: ["--peer"],
  devDependencies: ["--dev"],
  dependencies: [],
};

/** Which section declares the SDK, so the bump lands where the author put it. */
export function sdkDependencySection(pkg: PackageManifest): DependencySection | null {
  const sections: DependencySection[] = ["peerDependencies", "devDependencies", "dependencies"];
  return sections.find((section) => pkg[section]?.[SDK_PKG] !== undefined) ?? null;
}

/**
 * Standalone project: `bun add` the SDK at the requested version (default
 * latest) into the section that already declares it. Bun installs the SDK's
 * required peers alongside, so @glasshome/ui follows without a second step.
 */
function bumpSdkDependency(cwd: string, section: DependencySection, target: string): boolean {
  const s = spinner();
  s.start(`Installing ${SDK_PKG}@${target}...`);
  const proc = Bun.spawnSync(["bun", "add", ...SECTION_FLAG[section], `${SDK_PKG}@${target}`], {
    cwd,
  });
  if (proc.exitCode !== 0) {
    s.stop("Install failed");
    log.error(proc.stderr.toString());
    return false;
  }
  s.stop(`Installed ${SDK_PKG}@${target}`);
  return true;
}

export interface UpgradeOptions {
  /** Version or dist-tag to move to in a standalone project. Default "latest". */
  to?: string;
}

export async function runUpgrade(cwd: string, options: UpgradeOptions = {}): Promise<void> {
  const pkgPath = resolve(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    log.error("No package.json found in current directory.");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageManifest;
  const section = sdkDependencySection(pkg);
  const currentVersion = section ? pkg[section]?.[SDK_PKG] : undefined;

  if (!section || !currentVersion) {
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
    return;
  }

  // Standalone project: bump the dependency, then sync every manifest to what
  // is now installed. A manifest range that excludes the installed SDK fails
  // validation, and this is the command that error tells people to run.
  if (!bumpSdkDependency(cwd, section, options.to ?? "latest")) process.exit(1);

  const installed = getInstalledSdkVersion(cwd);
  if (!installed) {
    log.warn("No @glasshome/widget-sdk installed here, so manifests were left alone.");
    return;
  }
  syncManifestSdkVersions(cwd, installed);
  const valid = await runValidate(cwd);
  if (valid) {
    log.success(`Upgraded to @glasshome/widget-sdk@${installed}`);
  } else {
    log.warn(`Upgraded to ${installed}, but validation found problems above.`);
  }
}
