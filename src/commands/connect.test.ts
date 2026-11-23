import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitAndUpload } from "./connect";

let root: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  void server?.stop(true);
  server = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("emitAndUpload", () => {
  function setup() {
    root = mkdtempSync(join(tmpdir(), "connect-"));
    mkdirSync(join(root, "src", "climate", "locales"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "src", "climate", "locales", "en.json"), '{"hi":"Hello"}');
    writeFileSync(join(root, "src", "climate", "locales", "fr.json"), '{"hi":"Bonjour"}');
    writeFileSync(join(root, "dist", "climate.js"), "export default 1;");
    writeFileSync(
      join(root, "dist", "registry.json"),
      JSON.stringify({
        version: 1,
        widgets: [
          { name: "Climate", version: "1.0.0", bundleUrl: "./climate.js", sdkVersion: "^1.34.0" },
        ],
      }),
    );
    const calls: { path: string; type: string | null; body: string }[] = [];
    let registered = false;
    let failLocale: string | null = null;
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        calls.push({ path, type: req.headers.get("content-type"), body: await req.text() });
        if (path === "/trpc/widget.register") {
          registered = true;
          return Response.json({ result: { data: null } });
        }
        if (path.includes("/locales/")) {
          if (!registered) return new Response("not registered", { status: 404 });
          if (failLocale) {
            return Response.json(
              { error: "refused", kind: "invalid", reason: failLocale },
              { status: 400 },
            );
          }
        }
        return new Response("ok");
      },
    });
    return {
      cwd: root,
      url: `http://localhost:${server.port}`,
      calls,
      fail: (reason: string) => void (failLocale = reason),
    };
  }

  test("emits the catalogs from source, then posts bundle, register and each locale as JSON", async () => {
    const { cwd, url, calls } = setup();
    await emitAndUpload(cwd, url, "tok");
    expect(calls.map((c) => c.path)).toEqual([
      "/bundles/local/local/climate",
      "/trpc/widget.register",
      "/bundles/local/local/climate/locales/en",
      "/bundles/local/local/climate/locales/fr",
    ]);
    const fr = calls[3];
    expect(fr?.type).toBe("application/json");
    expect(fr?.body).toBe('{"hi":"Bonjour"}');
  });

  test("a locale edited between pushes is the one posted after re-register", async () => {
    const { cwd, url, calls } = setup();
    await emitAndUpload(cwd, url, "tok", ["climate"]);
    writeFileSync(join(cwd, "src", "climate", "locales", "fr.json"), '{"hi":"Salut"}');
    calls.length = 0;
    await emitAndUpload(cwd, url, "tok", ["climate"]);
    expect(calls.map((c) => c.path)[1]).toBe("/trpc/widget.register");
    expect(calls.at(-1)?.body).toBe('{"hi":"Salut"}');
  });

  test("a refused catalog names the server's reason", async () => {
    const { cwd, url, fail } = setup();
    fail("too-large");
    await expect(emitAndUpload(cwd, url, "tok")).rejects.toThrow(/HTTP 400.*too-large/);
  });

  test("an en.json that does not parse stops the push before any upload", async () => {
    const { cwd, url, calls } = setup();
    writeFileSync(join(cwd, "src", "climate", "locales", "en.json"), "{oops");
    await expect(emitAndUpload(cwd, url, "tok")).rejects.toThrow("locales/en.json does not parse");
    expect(calls).toEqual([]);
  });
});
