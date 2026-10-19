import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type DashRelease, dashRequirement } from "@glasshome/widget-contract/dash-releases";
import { deriveFloor } from "@glasshome/widget-contract/sdk-floor";
import { fetchDashReleases } from "./hub-api";
import { readManifest, writeManifest } from "./manifest";
import { isBunGlobalCache } from "./resolution";
import { getInstalledSdkVersion } from "./sdk-version";

const RELATIVE_JS_RE = /["'`](\.{1,2}\/[^"'`\s]+?\.m?js)["'`]/g;

/** The widget's entry plus every chunk it reaches by relative path; null when one cannot be read. */
function readBuiltChunks(cwd: string, widgetName: string): string | null {
  const distDir = resolve(cwd, "dist");
  const pending = [join(distDir, `${widgetName}.js`)];
  const seen = new Set<string>();
  const parts: string[] = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const inside = relative(distDir, file);
    if (inside.startsWith("..") || inside.startsWith(sep) || !existsSync(file)) return null;
    let code: string;
    try {
      code = readFileSync(file, "utf-8");
    } catch {
      return null;
    }
    parts.push(code);
    for (const match of code.matchAll(RELATIVE_JS_RE)) {
      const spec = match[1];
      if (spec) pending.push(resolve(dirname(file), spec));
    }
  }
  return parts.join("\n");
}

function readExportHistory(cwd: string): Record<string, string[]> | null {
  try {
    const require = createRequire(join(cwd, "package.json"));
    const path = require.resolve("@glasshome/widget-sdk/export-history");
    if (isBunGlobalCache(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

type Settled = { ok: true } | { ok: false; message: string };

type Floor = { ok: true; floor: string; notice: string | null } | { ok: false; message: string };

const KEPT_BECAUSE = {
  "namespace-import": "the widget imports the SDK as a namespace",
  "direct-ui-import": "the widget imports @glasshome/ui directly",
  "no-history": "the installed SDK predates export history",
  unreadable: "the built bundle could not be read",
} as const;

function kept(buildSdk: string, why: keyof typeof KEPT_BECAUSE): Floor {
  return { ok: true, floor: buildSdk, notice: `Floor kept at ${buildSdk}: ${KEPT_BECAUSE[why]}` };
}

function floorOf(cwd: string, widgetName: string): Floor {
  const buildSdk = getInstalledSdkVersion(cwd);
  if (!buildSdk) {
    return {
      ok: false,
      message: "No @glasshome/widget-sdk installed here, so no floor can be set.",
    };
  }
  const history = readExportHistory(cwd);
  if (!history) return kept(buildSdk, "no-history");
  const code = readBuiltChunks(cwd, widgetName);
  if (code === null) return kept(buildSdk, "unreadable");

  const result = deriveFloor({ code, history, buildSdk });
  if ("refused" in result) {
    const verb = result.refused.length === 1 ? "is" : "are";
    return {
      ok: false,
      message: `${result.refused.join(", ")} ${verb} not in any released SDK. Release the SDK first.`,
    };
  }
  if (result.reason === "derived") return { ok: true, floor: result.floor, notice: null };
  return kept(result.floor, result.reason);
}

/** Oldest stable Dash whose SDK satisfies `range`, as a Dash on no channel would be told to update to. */
function oldestStableDash(range: string, releases: DashRelease[]): string | null {
  const needs = dashRequirement(range, releases, { version: "0.0.0", stage: null });
  return needs?.kind === "update" ? needs.version : null;
}

export interface FloorDeps {
  info: (line: string) => void;
  confirm: (message: string) => Promise<boolean>;
}

/** Derive the widget's sdkVersion floor from its built bundle, write it, and say which Dash it reaches. */
export async function settleSdkFloor(
  cwd: string,
  widgetName: string,
  hubUrl: string,
  deps: FloorDeps,
): Promise<Settled> {
  const floor = floorOf(cwd, widgetName);
  if (!floor.ok) return floor;
  const range = `^${floor.floor}`;
  const manifest = readManifest(cwd, widgetName);
  manifest.sdkVersion = range;
  writeManifest(cwd, widgetName, manifest);
  if (floor.notice) deps.info(floor.notice);

  let releases: DashRelease[];
  try {
    releases = await fetchDashReleases(hubUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not read Dash releases from ${hubUrl}: ${detail}` };
  }

  const oldest = oldestStableDash(range, releases);
  if (oldest) {
    deps.info(`Runs on Dash ${oldest} and later`);
    return { ok: true };
  }
  if (await deps.confirm("No stable Dash runs this yet. Publish anyway?")) return { ok: true };
  return { ok: false, message: "Publish cancelled." };
}
