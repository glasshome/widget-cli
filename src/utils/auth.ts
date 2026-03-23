import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  hubUrl: string;
  scope: string;
}

const AUTH_DIR = join(homedir(), ".glasshome");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

function ensureDir(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  }
}

export function storeToken(data: StoredAuth): void {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function getStoredAuth(): StoredAuth | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function getToken(hubUrl: string): Promise<string | null> {
  const stored = getStoredAuth();
  if (!stored) return null;
  if (stored.hubUrl !== hubUrl) return null;

  // Check if token is still valid (with 60s buffer)
  if (Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken;
  }

  // Try to refresh
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

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    storeToken({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? stored.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      hubUrl: stored.hubUrl,
      scope: stored.scope,
    });

    return data.access_token;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  if (existsSync(AUTH_FILE)) {
    unlinkSync(AUTH_FILE);
  }
}

export function getHubUrl(): string {
  const stored = getStoredAuth()?.hubUrl;
  // Ignore localhost URLs from local dev sessions
  if (stored && !stored.includes("localhost") && !stored.includes("127.0.0.1")) {
    return stored;
  }
  return "https://glasshome.app";
}

export function getScope(): string | null {
  return getStoredAuth()?.scope ?? null;
}
