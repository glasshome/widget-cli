import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";
import { log, note, spinner } from "@clack/prompts";
import color from "picocolors";
import { buildWidgets, createIntrospectSession } from "@glasshome/widget-sdk/vite";
import { trpcMutate, trpcQuery } from "../utils/api";
import {
  clearHostToken,
  type DeviceGrant,
  type DevicePollOutcome,
  deviceAuthorize,
  extractHost,
  getHostToken,
  pollDeviceToken,
  storeHostToken,
} from "../utils/auth";
import { lintAndReport } from "../utils/lint-source";
import { withQuietStdout } from "../utils/quiet";

interface RegistryWidget {
  name: string;
  version: string;
  bundleUrl: string;
  sdkVersion: string;
  [key: string]: unknown;
}

interface RegistryJson {
  version: number;
  widgets: RegistryWidget[];
}

/**
 * Upload a single widget bundle to the API and register it.
 */
async function uploadAndRegister(
  apiUrl: string,
  distDir: string,
  widget: RegistryWidget,
  token: string,
): Promise<void> {
  const api = apiUrl.replace(/\/$/, "");
  // Derive slug from bundleUrl (e.g. "./area.js" → "area")
  const slug = widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, "");

  const bundlePath = resolve(distDir, `${slug}.js`);
  if (!existsSync(bundlePath)) {
    log.warn(`Bundle not found: ${bundlePath}, skipping ${slug}`);
    return;
  }

  const bundleContent = readFileSync(bundlePath, "utf-8");

  const uploadRes = await fetch(`${api}/bundles/local/local/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/javascript",
      Authorization: `Bearer ${token}`,
    },
    body: bundleContent,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload bundle for ${slug}: HTTP ${uploadRes.status}`);
  }

  // Widgets render in shadow roots and need their own stylesheet uploaded
  // alongside the bundle.
  const cssPath = resolve(distDir, `${slug}.css`);
  let cssUrl: string | undefined;
  if (existsSync(cssPath)) {
    const cssRes = await fetch(`${api}/bundles/local/local/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/css",
        Authorization: `Bearer ${token}`,
      },
      body: readFileSync(cssPath, "utf-8"),
    });
    if (!cssRes.ok) {
      throw new Error(`Failed to upload stylesheet for ${slug}: HTTP ${cssRes.status}`);
    }
    cssUrl = `/bundles/local/local/${slug}/bundle.css`;
  }

  const manifest = { ...widget };
  delete (manifest as Record<string, unknown>).bundleUrl;
  delete (manifest as Record<string, unknown>).cssUrl;

  await trpcMutate({
    apiUrl: api,
    path: "widget.register",
    token,
    input: {
      scope: "local",
      name: slug,
      version: widget.version,
      bundleUrl: `/bundles/local/local/${slug}/bundle.js`,
      ...(cssUrl ? { cssUrl } : {}),
      manifestJson: JSON.stringify(manifest),
    },
  });
}

/**
 * Read registry.json and upload all widget bundles.
 * @returns Array of widget slugs that were registered
 */
async function uploadAllWidgets(apiUrl: string, distDir: string, token: string): Promise<string[]> {
  const registryPath = resolve(distDir, "registry.json");
  const registry: RegistryJson = JSON.parse(readFileSync(registryPath, "utf-8"));
  const slugs: string[] = [];

  for (const widget of registry.widgets) {
    const slug = widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, "");
    await uploadAndRegister(apiUrl, distDir, widget, token);
    slugs.push(slug);
  }

  return slugs;
}

type Spinner = ReturnType<typeof spinner>;

type BuildOpts = NonNullable<Parameters<typeof buildWidgets>[0]>;

async function buildOrExit(cwd: string, buildOpts: BuildOpts, s: Spinner): Promise<void> {
  s.start("Building widgets...");
  try {
    const origCwd = process.cwd();
    process.chdir(cwd);
    await withQuietStdout(() => buildWidgets(buildOpts));
    process.chdir(origCwd);
  } catch (err) {
    s.stop("Build failed");
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  s.stop("Build complete");
}

async function validStoredToken(api: string, host: string): Promise<string> {
  const existingToken = getHostToken(host);
  if (!existingToken) return "";
  try {
    const check = await fetch(`${api}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${existingToken}` },
    });
    const body = check.ok ? ((await check.json()) as { session?: unknown } | null) : null;
    if (body?.session) {
      log.info("Using stored credentials");
      return existingToken;
    }
    clearHostToken(host);
    log.warn("Stored credentials expired, re-authenticating");
  } catch {
    log.warn("Could not validate stored credentials, re-authenticating");
  }
  return "";
}

const POLL_FAILURE_MESSAGE: Record<
  Exclude<DevicePollOutcome["kind"], "authorized" | "error" | "failed" | "timeout">,
  string
> = {
  missing_token: "Auth response missing session token",
  denied: "Authorization denied",
  expired: "Device code expired",
};

function reportPollOutcome(outcome: DevicePollOutcome, s: Spinner): void {
  switch (outcome.kind) {
    case "authorized":
    case "timeout":
      return;
    case "error":
      s.stop(`Auth error: ${outcome.code}`);
      return;
    case "failed":
      s.stop("Authorization failed");
      log.warn(`Error polling for token: ${outcome.message}`);
      return;
    default:
      s.stop(POLL_FAILURE_MESSAGE[outcome.kind]);
  }
}

async function authorizeThisDevice(api: string, host: string, s: Spinner): Promise<string> {
  s.start("Requesting authorization code...");
  let grant: DeviceGrant;
  try {
    grant = await deviceAuthorize(api);
  } catch (err) {
    s.stop("Failed to request device code");
    log.warn(
      `Could not reach dashboard at ${api}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }

  s.stop("Authorization code ready");
  log.info(`Open in browser: ${grant.verificationUriComplete}`);
  log.info(`Device code: ${grant.userCode}`);
  await import("open").then((m) => m.default(grant.verificationUriComplete)).catch(() => {});

  s.start("Waiting for authorization (approve in your browser)...");
  const outcome = await pollDeviceToken(api, grant);
  reportPollOutcome(outcome, s);
  if (outcome.kind !== "authorized") {
    s.stop("Not authorized");
    return "";
  }
  storeHostToken(host, outcome.token, Date.now() + outcome.expiresIn * 1000);
  s.stop("Authorized");
  return outcome.token;
}

async function obtainToken(api: string, opts: { reAuth?: boolean }, s: Spinner): Promise<string> {
  const host = extractHost(api);
  if (opts.reAuth) {
    clearHostToken(host);
    log.info("Discarded stored credentials (--re-auth)");
  }
  const stored = await validStoredToken(api, host);
  return stored || authorizeThisDevice(api, host, s);
}

// Developer Mode opens the dashboard's /dev and /mcp routes, so only a person switches it on.
async function warnIfDevModeOff(api: string, token: string): Promise<void> {
  const config = await trpcQuery<{ devMode: boolean }>({
    apiUrl: api,
    path: "appConfig.get",
    token,
  }).catch(() => null);
  if (config?.devMode === false) {
    log.warn(
      "Developer Mode is off, so the dashboard won't reload your widgets on save. Switch it on in Settings > General.",
    );
  }
}

interface ReuploadWatch {
  close: () => Promise<void>;
}

/**
 * Rebuild and re-upload only the widgets whose sources changed. Changes collect
 * into `pending` and flush after DEBOUNCE_MS of quiet; changes arriving during a
 * build trigger one more pass after it, so no edit is dropped.
 */
function watchAndReupload(opts: {
  cwd: string;
  apiUrl: string;
  distDir: string;
  buildOpts: BuildOpts;
  token: string;
}): ReuploadWatch {
  const { cwd, apiUrl, distDir, buildOpts, token } = opts;
  const DEBOUNCE_MS = 150;
  const pending = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let buildInFlight = false;
  // One worker for the whole session: a fresh introspection process per save is
  // the boot tax this avoids (docs/superpowers/specs/2026-08-18-widget-sdk-persistent-introspect-worker-design.md).
  const introspectSession = createIntrospectSession();

  async function flush(): Promise<void> {
    debounceTimer = null;
    if (buildInFlight) return;
    if (pending.size === 0) return;

    const widgets = [...pending];
    pending.clear();
    buildInFlight = true;

    try {
      const origCwd = process.cwd();
      process.chdir(cwd);
      try {
        await withQuietStdout(() =>
          buildWidgets({ ...buildOpts, only: widgets, session: introspectSession }),
        );
      } finally {
        process.chdir(origCwd);
      }

      const registry: RegistryJson = JSON.parse(
        readFileSync(resolve(distDir, "registry.json"), "utf-8"),
      );
      for (const widgetName of widgets) {
        const widget = registry.widgets.find((w) => w.bundleUrl === `./${widgetName}.js`);
        if (widget) {
          await uploadAndRegister(apiUrl, distDir, widget, token);
          log.info(`Rebuilt & uploaded ${widgetName}`);
        } else {
          log.warn(`No registry entry for ${widgetName}, skipping upload`);
        }
      }
    } catch (err) {
      log.warn(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      buildInFlight = false;
      if (pending.size > 0) {
        void flush();
      }
    }
  }

  const watcher = watch(resolve(cwd, "src"), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const widgetName = filename.split(/[\\/]/)[0] ?? filename;
    pending.add(widgetName);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  });

  return {
    close: async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
      // connect never exits normally, so without this the worker only dies via
      // its stdin-EOF watchdog.
      await introspectSession.dispose();
    },
  };
}

function countWidgets(cwd: string): number {
  const srcDir = resolve(cwd, "src");
  if (!existsSync(srcDir)) return 0;
  return readdirSync(srcDir).filter(
    (d) =>
      statSync(resolve(srcDir, d)).isDirectory() && existsSync(resolve(srcDir, d, "manifest.json")),
  ).length;
}

function announceConnected(cwd: string): void {
  log.success(color.green(`Connected: ${countWidgets(cwd)} widget(s) live`));
  note(
    [
      `${color.cyan("watching")}  src/ (edits auto-rebuild & re-upload)`,
      `${color.cyan("add")}       new widgets with ${color.bold("bun widget add")}`,
      `${color.cyan("stop")}      press ${color.bold("Ctrl+C")} to disconnect`,
    ].join("\n"),
    "Live testing",
  );
}

function disconnectOnSignal(opts: {
  api: string;
  token: string;
  registeredTags: string[];
  reupload: ReuploadWatch;
}): void {
  const cleanup = async () => {
    log.info("Disconnecting...");
    await opts.reupload.close();

    for (const slug of opts.registeredTags) {
      try {
        await trpcMutate({
          apiUrl: opts.api,
          path: "widget.unregister",
          token: opts.token,
          input: { scope: "local", name: slug },
        });
      } catch {
        // Non-fatal, API may be down
      }
    }
    log.info("Widgets unregistered");

    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export async function runConnect(
  apiUrl: string,
  cwd: string,
  opts: { reAuth?: boolean } = {},
): Promise<void> {
  const distDir = resolve(cwd, "dist");
  const solid = (await import("vite-plugin-solid")).default;
  // delegateEvents: false, widgets run in closed shadow roots where Solid's
  // document-level event delegation cannot see the target.
  const buildOpts: BuildOpts = {
    srcDir: "src",
    outDir: "dist",
    plugins: [solid({ solid: { delegateEvents: false } })],
  };

  const s = spinner();
  await buildOrExit(cwd, buildOpts, s);
  lintAndReport(cwd);

  if (!existsSync(resolve(distDir, "registry.json"))) {
    log.error("dist/registry.json not found after build. Check your vite.config.ts.");
    process.exit(1);
  }

  const api = apiUrl.replace(/\/$/, "");
  const token = await obtainToken(api, opts, s);
  if (!token) {
    log.warn(
      "Authentication failed, widgets won't be connected. Log in at the dashboard first, then restart.",
    );
    return;
  }

  s.start("Registering widgets with dashboard...");
  const registeredTags = await uploadAllWidgets(apiUrl, distDir, token);
  s.stop("Widgets registered");
  await warnIfDevModeOff(api, token);

  const reupload = watchAndReupload({ cwd, apiUrl, distDir, buildOpts, token });
  announceConnected(cwd);
  disconnectOnSignal({ api, token, registeredTags, reupload });

  // Keep alive
  await new Promise(() => {});
}
