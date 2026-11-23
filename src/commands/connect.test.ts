import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadAndRegister } from "./connect";

let root: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  void server?.stop(true);
  server = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("uploadAndRegister", () => {
  test("posts the bundle, registers, then posts each locale file as JSON", async () => {
    root = mkdtempSync(join(tmpdir(), "connect-"));
    mkdirSync(join(root, "climate", "locales"), { recursive: true });
    writeFileSync(join(root, "climate.js"), "export default 1;");
    writeFileSync(join(root, "climate", "locales", "en.json"), '{"hi":"Hello"}');
    writeFileSync(join(root, "climate", "locales", "fr.json"), '{"hi":"Bonjour"}');

    const calls: { path: string; type: string | null; body: string }[] = [];
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        calls.push({ path, type: req.headers.get("content-type"), body: await req.text() });
        return path.startsWith("/trpc/")
          ? Response.json({ result: { data: null } })
          : new Response("ok");
      },
    });

    await uploadAndRegister(
      `http://localhost:${server.port}`,
      root,
      { name: "Climate", version: "1.0.0", bundleUrl: "./climate.js", sdkVersion: "^1.34.0" },
      "tok",
    );

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
});
