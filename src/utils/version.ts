import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { log } from "@clack/prompts";
import semver from "semver";

/** This CLI's own version, read from the package.json it ships with. */
export function getCliVersion(): string {
  try {
    const pkgPath = resolve(import.meta.dir, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Ask the hub for the minimum CLI version its protocol still accepts and stop
 * with an actionable message when this CLI is below it. Older hub-facing breaks
 * (e.g. the 0.4.11 OAuth redirect change) surfaced as opaque errors; this turns
 * them into "update your CLI". Network/parse failures are non-fatal: the check
 * never blocks publishing when the hub can't be reached.
 */
export async function enforceCliVersion(hubUrl: string): Promise<void> {
  const current = getCliVersion();

  let minSupported: string | undefined;
  try {
    const res = await fetch(`${hubUrl}/api/widgets/cli-version`);
    if (res.ok) {
      const data = (await res.json()) as { minSupported?: string };
      minSupported = data.minSupported;
    }
  } catch {
    return;
  }

  if (minSupported && semver.valid(minSupported) && semver.lt(current, minSupported)) {
    throw new Error(
      `This widget CLI (${current}) is no longer supported by ${hubUrl} (minimum ${minSupported}).\n` +
        "Update it:  bun add -g @glasshome/widget-cli@latest\n" +
        "Or run once without installing:  bunx @glasshome/widget-cli@latest <command>",
    );
  }
}

const UPDATE_CACHE_FILE = join(homedir(), ".glasshome", "update-check.json");
// Hit npm at most once per day; every other run reads the cached result.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Cap the daily refresh so a slow registry never stalls a command.
const UPDATE_FETCH_TIMEOUT_MS = 2000;
const CLI_PKG = "@glasshome/widget-cli";
const SDK_PKG = "@glasshome/widget-sdk";

interface UpdateCache {
  lastCheck: number;
  cli: string | null;
  sdk: string | null;
}

function notifierDisabled(): boolean {
  return Boolean(process.env.GLASSHOME_NO_UPDATE_NOTIFIER || process.env.CI);
}

function readUpdateCache(): UpdateCache | null {
  try {
    const raw = JSON.parse(readFileSync(UPDATE_CACHE_FILE, "utf-8")) as Partial<UpdateCache>;
    if (typeof raw.lastCheck === "number") {
      return {
        lastCheck: raw.lastCheck,
        cli: typeof raw.cli === "string" ? raw.cli : null,
        sdk: typeof raw.sdk === "string" ? raw.sdk : null,
      };
    }
  } catch {}
  return null;
}

function writeUpdateCache(cache: UpdateCache): void {
  try {
    mkdirSync(join(homedir(), ".glasshome"), { recursive: true });
    writeFileSync(UPDATE_CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  } catch {}
}

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Latest published cli + sdk versions, refreshing the shared daily cache when
 * stale. Warm runs stay offline; a failed refresh keeps the last known value.
 */
async function getLatestVersions(): Promise<{ cli: string | null; sdk: string | null }> {
  const cache = readUpdateCache();
  const now = Date.now();
  if (cache && now - cache.lastCheck < UPDATE_CHECK_INTERVAL_MS) {
    return { cli: cache.cli, sdk: cache.sdk };
  }
  const [cli, sdk] = await Promise.all([
    fetchLatestVersion(CLI_PKG),
    fetchLatestVersion(SDK_PKG),
  ]);
  const merged = { cli: cli ?? cache?.cli ?? null, sdk: sdk ?? cache?.sdk ?? null };
  writeUpdateCache({ lastCheck: now, ...merged });
  return merged;
}

/**
 * Best-effort nudge: warn when a newer CLI is published on npm. Runs on every
 * command but only queries the registry once per day (shared cache in
 * ~/.glasshome/update-check.json) so warm runs stay offline and instant. Never
 * blocks; any failure (offline, registry hiccup) is swallowed. Opt out with
 * GLASSHOME_NO_UPDATE_NOTIFIER or CI.
 */
export async function notifyCliUpdate(): Promise<void> {
  if (notifierDisabled()) return;

  const current = getCliVersion();
  const { cli: latest } = await getLatestVersions();
  if (latest && semver.valid(latest) && semver.gt(latest, current)) {
    log.warn(
      `A newer widget CLI is available (${current} → ${latest}). Update:  bun add -g ${CLI_PKG}@latest`,
    );
  }
}

/** The @glasshome/widget-sdk version this project declares in its package.json. */
export function getProjectSdkVersion(cwd: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const range =
      pkg.peerDependencies?.[SDK_PKG] ??
      pkg.devDependencies?.[SDK_PKG] ??
      pkg.dependencies?.[SDK_PKG];
    if (!range) return null;
    const clean = range.replace(/^[\^~]/, "");
    return semver.valid(clean) ? clean : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort nudge: warn when the project's @glasshome/widget-sdk is behind the
 * latest published SDK. Same throttled cache as the CLI check; opt out the same
 * way. No-ops outside a widget project or when the pin isn't a plain version.
 */
export async function notifySdkUpdate(cwd: string): Promise<void> {
  if (notifierDisabled()) return;

  const declared = getProjectSdkVersion(cwd);
  if (!declared) return;

  const { sdk: latest } = await getLatestVersions();
  if (latest && semver.valid(latest) && semver.gt(latest, declared)) {
    log.warn(
      `A newer widget SDK is available (${declared} → ${latest}). Update:  bun widget upgrade`,
    );
  }
}
