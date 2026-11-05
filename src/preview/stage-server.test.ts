import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { STAGE_CSP, startStageServer } from "./stage-server";

const dist = mkdtempSync(join(tmpdir(), "stage-server-"));
writeFileSync(join(dist, "w.js"), "export default 1");
let server: ReturnType<typeof startStageServer>;

beforeAll(() => {
  server = startStageServer({
    files: new Map([
      ["index.html", new TextEncoder().encode("<html>")],
      ["assets/a.wasm", new Uint8Array([0])],
    ]),
    distDir: dist,
    widgets: ["w"],
    manifestPath: () => join(dist, "none.json"),
  });
});

afterAll(async () => {
  await server.stop();
  rmSync(dist, { recursive: true, force: true });
});

test("every response carries the CLI's own policy, whatever the stage page says", async () => {
  for (const path of [
    "/index.html",
    "/assets/a.wasm",
    "/dist/w.js",
    "/nope",
    "/iconify/mdi.json?icons=home",
  ]) {
    const res = await fetch(`${server.origin}${path}`);
    expect(res.headers.get("content-security-policy")).toBe(STAGE_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  }
});

test("files are served with their type, and only the listed ones", async () => {
  expect((await fetch(`${server.origin}/index.html`)).headers.get("content-type")).toContain(
    "text/html",
  );
  expect((await fetch(`${server.origin}/assets/a.wasm`)).headers.get("content-type")).toBe(
    "application/wasm",
  );
  expect((await fetch(`${server.origin}/assets/../../etc/passwd`)).status).toBe(404);
  expect((await fetch(`${server.origin}/dist/other.js`)).status).toBe(404);
});

test("a request that names another host is refused", async () => {
  const port = new URL(server.origin).port;
  const res = await fetch(`${server.origin}/index.html`, {
    headers: { Host: `evil.test:${port}` },
  });
  expect(res.status).toBe(403);
});

test("icons answer the dash route's contract", async () => {
  const res = await fetch(`${server.origin}/iconify/mdi.json?icons=home`);
  expect(((await res.json()) as { icons: Record<string, unknown> }).icons.home).toBeDefined();
});
