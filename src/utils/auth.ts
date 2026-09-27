import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface HubAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  hubUrl: string;
  scope: string;
}

interface HostAuth {
  token: string;
  expiresAt: number;
}

interface StoredAuthFile {
  hub?: HubAuth;
  hosts: Record<string, HostAuth>;
}

// Legacy shape written by older CLI versions (hub auth only, no hosts key)
type LegacyStoredAuth = HubAuth;

const AUTH_DIR = join(homedir(), ".glasshome");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

function ensureDir(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  }
}

function readAuthFile(): StoredAuthFile {
  if (!existsSync(AUTH_FILE)) return { hosts: {} };
  try {
    const raw = JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as
      | StoredAuthFile
      | LegacyStoredAuth;
    // Migrate legacy format (hub-only, no hosts key)
    if ("accessToken" in raw) {
      return { hub: raw as HubAuth, hosts: {} };
    }
    const typed = raw as StoredAuthFile;
    return { hub: typed.hub, hosts: typed.hosts ?? {} };
  } catch {
    return { hosts: {} };
  }
}

function writeAuthFile(data: StoredAuthFile): void {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// --- Host-keyed token storage (for device auth / widget connect) ---

export function storeHostToken(host: string, token: string, expiresAt: number): void {
  const data = readAuthFile();
  data.hosts[host] = { token, expiresAt };
  writeAuthFile(data);
}

export function getHostToken(host: string): string | null {
  const data = readAuthFile();
  const entry = data.hosts[host];
  if (!entry) return null;
  // Return null if expired (60s buffer)
  if (Date.now() >= entry.expiresAt - 60_000) return null;
  return entry.token;
}

export function clearHostToken(host: string): void {
  const data = readAuthFile();
  delete data.hosts[host];
  writeAuthFile(data);
}

// --- Hub auth storage (for widget publishing) ---

export function storeToken(hubData: HubAuth): void {
  const data = readAuthFile();
  data.hub = hubData;
  writeAuthFile(data);
}

function getStoredAuth(): HubAuth | null {
  return readAuthFile().hub ?? null;
}

export async function getToken(hubUrl: string): Promise<string | null> {
  // Check host-keyed token first (for connect flow)
  const host = extractHost(hubUrl);
  const hostToken = getHostToken(host);
  if (hostToken) return hostToken;

  // Fall back to hub auth (for publishing)
  const stored = getStoredAuth();
  if (!stored) return null;
  if (stored.hubUrl !== hubUrl) return null;

  if (Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) return null;

  try {
    const res = await fetch(`${hubUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: "glasshome-widget-cli",
      }),
    });

    if (!res.ok) return null;

    const tokenData = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    storeToken({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? stored.refreshToken,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      hubUrl: stored.hubUrl,
      scope: stored.scope,
    });

    return tokenData.access_token;
  } catch {
    return null;
  }
}

function clearToken(): void {
  const data = readAuthFile();
  delete data.hub;
  writeAuthFile(data);
}

export function getHubUrl(): string {
  const stored = getStoredAuth();
  if (stored) {
    if (stored.hubUrl.includes("localhost") || stored.hubUrl.includes("127.0.0.1")) {
      clearToken();
    } else {
      return stored.hubUrl;
    }
  }
  return "https://glasshome.app";
}

// --- OAuth device authorization grant (RFC 8628) ---

const CLI_CLIENT_ID = "glasshome-widget-cli";

export interface DeviceGrant {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type DevicePollOutcome =
  | { kind: "authorized"; token: string; expiresIn: number }
  | { kind: "missing_token" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "error"; code: string | number }
  | { kind: "failed"; message: string }
  | { kind: "timeout" };

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface DevicePollDeps {
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const realPollDeps: DevicePollDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export async function deviceAuthorize(
  api: string,
  fetchImpl: FetchFn = realPollDeps.fetch,
): Promise<DeviceGrant> {
  const res = await fetchImpl(`${api}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLI_CLIENT_ID }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUriComplete:
      data.verification_uri_complete ??
      `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}`,
    expiresIn: data.expires_in,
    interval: data.interval ?? 5,
  };
}

export async function pollDeviceToken(
  api: string,
  grant: DeviceGrant,
  deps: DevicePollDeps = realPollDeps,
): Promise<DevicePollOutcome> {
  const deadline = deps.now() + grant.expiresIn * 1000;
  let interval = grant.interval;

  while (deps.now() < deadline) {
    await deps.sleep(interval * 1000);

    try {
      const res = await deps.fetch(`${api}/api/auth/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: grant.deviceCode,
          client_id: CLI_CLIENT_ID,
        }),
      });

      if (res.ok) {
        // better-auth's device plugin returns an OAuth bundle whose access_token is the session token.
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!data.access_token) return { kind: "missing_token" };
        return { kind: "authorized", token: data.access_token, expiresIn: data.expires_in ?? 0 };
      }

      const errData = (await res.json()) as { error?: string };
      switch (errData.error) {
        case "slow_down":
          interval = Math.min(interval + 5, 30);
          continue;
        case "authorization_pending":
          continue;
        case "access_denied":
          return { kind: "denied" };
        case "expired_token":
          return { kind: "expired" };
        default:
          return { kind: "error", code: errData.error ?? res.status };
      }
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
    }
  }

  return { kind: "timeout" };
}

// --- Helpers ---

export function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Bare host:port or path-less string
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}
