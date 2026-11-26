import { pathToFileURL } from "node:url";
import type { BuildWidgetsOptions } from "@glasshome/widget-sdk/vite";
import semver from "semver";
import type { Plugin } from "vite";
import { discoverWidgets, readManifest } from "./manifest";
import { isBunGlobalCache } from "./resolution";
import { getInstalledSdkVersion } from "./sdk-version";

type SdkMajor = 1 | 2;

type SolidPluginFactory = (options?: Record<string, unknown>) => Plugin | Plugin[];

const SOLID_PLUGIN: Record<SdkMajor, string> = {
  1: "vite-plugin-solid",
  2: "@solidjs/vite-plugin",
};

function installedSdkMajor(cwd: string): SdkMajor {
  const version = getInstalledSdkVersion(cwd);
  if (!version) {
    throw new Error("No @glasshome/widget-sdk installed here. Run `bun install` first.");
  }
  const major = semver.major(version);
  if (major !== 1 && major !== 2) {
    throw new Error(`@glasshome/widget-sdk ${version} is installed; this CLI builds SDK 1 and 2.`);
  }
  return major;
}

/** Each widget whose manifest sdkVersion floors at a different SDK major than the one installed. */
export function majorMismatches(cwd: string, major: SdkMajor): string[] {
  return discoverWidgets(cwd).flatMap((name) => {
    const range = readManifest(cwd, name).sdkVersion;
    const floor = range && semver.validRange(range) ? semver.minVersion(range) : null;
    if (!floor || floor.major === major) return [];
    return [
      `src/${name}/manifest.json declares sdkVersion ${range}, but SDK ${major} is installed`,
    ];
  });
}

async function loadSolidPlugin(cwd: string, major: SdkMajor): Promise<SolidPluginFactory> {
  const id = SOLID_PLUGIN[major];
  let path: string | null = null;
  try {
    path = Bun.resolveSync(id, cwd);
  } catch {}
  try {
    const mod: { default: SolidPluginFactory } =
      path && !isBunGlobalCache(path) ? await import(pathToFileURL(path).href) : await import(id);
    return mod.default;
  } catch {
    throw new Error(`SDK ${major} widgets build with ${id}. Install it: bun add -d ${id}`);
  }
}

/** The Solid plugin for the SDK major the project has installed; the SDK owns that major's externals and checks. */
export async function widgetBuildOptions(
  cwd: string,
): Promise<Pick<BuildWidgetsOptions, "plugins">> {
  const major = installedSdkMajor(cwd);
  const mismatches = majorMismatches(cwd, major);
  if (mismatches.length > 0) {
    throw new Error(
      `${mismatches.join("\n")}\nOne project builds one SDK major: see https://glasshome.app/docs/widgets/widget-sdk-2-0`,
    );
  }
  const solid = await loadSolidPlugin(cwd, major);
  if (major === 1) {
    // delegateEvents: false, Solid 1 delegates on document, which a closed shadow root hides.
    return { plugins: [solid({ solid: { delegateEvents: false } })].flat() };
  }
  return { plugins: [solid({ dev: false, refresh: false })].flat() };
}
