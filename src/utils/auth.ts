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

export function getStoredAuth(): HubAuth | null {
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
        client_secret: "glasshome-cli-public",
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

export function clearToken(): void {
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

export function getScope(): string | null {
  return getStoredAuth()?.scope ?? null;
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
