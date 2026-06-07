import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * Best-effort nudge: warn when a newer CLI is published on npm. Never blocks;
 * any failure (offline, registry hiccup) is swallowed.
 */
export async function notifyCliUpdate(): Promise<void> {
  const current = getCliVersion();
  try {
    const res = await fetch("https://registry.npmjs.org/@glasshome/widget-cli/latest");
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (latest && semver.valid(latest) && semver.gt(latest, current)) {
      log.warn(
        `A newer widget CLI is available (${current} → ${latest}). Update:  bun add -g @glasshome/widget-cli@latest`,
      );
    }
  } catch {
    // ignore
  }
}
