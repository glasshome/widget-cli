import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { log, spinner } from "@clack/prompts";
import open from "open";
import { getHubUrl, storeToken } from "../utils/auth";

const CLIENT_ID = "glasshome-widget-cli";
const CLIENT_SECRET = "glasshome-cli-public";
const REDIRECT_PORT = 9274;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 120_000;

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function runLogin(hubUrl?: string): Promise<void> {
  const hub = hubUrl ?? getHubUrl();

  // Generate PKCE parameters
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = randomBytes(16).toString("hex");

  const s = spinner();

  // Start local callback server
  const { code, receivedState } = await new Promise<{
    code: string;
    receivedState: string;
  }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 120 seconds"));
    }, LOGIN_TIMEOUT_MS);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const receivedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><head><script>window.close()</script></head><body></body></html>`);
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code || !receivedState) {
        res.writeHead(400);
        res.end("Missing code or state");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><head><script>window.close()</script></head><body></body></html>`);

      clearTimeout(timeout);
      server.close();
      resolve({ code, receivedState });
    });

    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL(`${hub}/api/auth/oauth2/authorize`);
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("scope", "openid profile email");

      log.info(`Opening browser for login at ${hub}`);
      s.start("Waiting for browser login...");
      open(authUrl.toString()).catch(() => {
        log.warn(`Could not open browser. Visit this URL manually:\n  ${authUrl.toString()}`);
      });
    });
  });

  // Verify state
  if (receivedState !== state) {
    s.stop("Login failed");
    log.error("State mismatch. Possible CSRF attack.");
    process.exit(1);
  }

  // Exchange code for tokens
  s.message("Exchanging code for tokens...");

  const tokenRes = await fetch(`${hub}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    s.stop("Login failed");
    const text = await tokenRes.text();
    log.error(`Token exchange failed: ${text}`);
    process.exit(1);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Fetch user info for scope
  s.message("Fetching user info...");

  const userRes = await fetch(`${hub}/api/auth/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    s.stop("Login failed");
    log.error("Could not fetch user info.");
    process.exit(1);
  }

  const userInfo = (await userRes.json()) as {
    name?: string;
    email?: string;
    sub?: string;
  };
  const displayName = userInfo.name || userInfo.email || userInfo.sub || "unknown";
  const scopeBase = userInfo.name || userInfo.email?.split("@")[0] || userInfo.sub || "unknown";
  const scope = scopeBase.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  // Store tokens
  storeToken({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    hubUrl: hub,
    scope,
  });

  s.stop("Logged in successfully");
  log.success(`Authenticated as ${displayName} (scope: ${scope})`);
  log.info(`Hub: ${hub}`);
}
