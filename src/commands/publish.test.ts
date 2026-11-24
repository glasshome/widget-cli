import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmPublish, requestPublish } from "../utils/hub-api";
import { entries, missingSidecarSupport, uploadSidecars, walkSidecars } from "../utils/sidecars";

let root: string | undefined;
let hub: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  void hub?.stop(true);
  hub = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("a publish sends the sidecar list, uploads each file and confirms the same list", async () => {
  root = mkdtempSync(join(tmpdir(), "publish-"));
  const base = join(root, "dist", "climate");
  mkdirSync(join(base, "files"), { recursive: true });
  mkdirSync(join(base, "locales"), { recursive: true });
  writeFileSync(join(base, "files", "hero.png"), "png");
  writeFileSync(join(base, "locales", "en.json"), "{}");
  writeFileSync(join(base, "locales", "fr.json"), "{}");

  const bodies: Record<string, unknown>[] = [];
  const uploaded: Record<string, string> = {};
  hub = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "PUT") {
        uploaded[decodeURIComponent(url.pathname.slice("/upload/".length))] = await req.text();
        return new Response(null, { status: 200 });
      }
      const body = (await req.json()) as { action: string; files?: { path: string }[] };
      bodies.push(body);
      if (body.action === "confirm") {
        return Response.json({ success: true, bundleUrl: "b" });
      }
      const uploads = Object.fromEntries(
        (body.files ?? []).map((f) => [
          f.path,
          `${url.origin}/upload/${encodeURIComponent(f.path)}`,
        ]),
      );
      return Response.json({
        uploadUrl: `${url.origin}/upload/index.js`,
        cdnUrl: "c",
        widgetId: "w",
        versionId: "v1",
        uploads,
      });
    },
  });
  const hubUrl = `http://localhost:${hub.port}`;

  const sidecars = walkSidecars(join(root, "dist"), "climate");
  const answer = await requestPublish(hubUrl, "t", {
    scope: "glasshome",
    name: "climate",
    displayName: "Climate",
    minSize: { w: 1, h: 1 },
    maxSize: { w: 2, h: 2 },
    sdkVersion: "^1.0.0",
    version: "1.0.0",
    bundleSize: 1,
    sha256Hash: "a",
    manifestJson: "{}",
    files: entries(sidecars),
  });
  await uploadSidecars(answer.uploads, sidecars);
  await confirmPublish(hubUrl, "t", answer.versionId, entries(sidecars));

  expect(bodies[0]?.files).toHaveLength(3);
  expect(uploaded).toEqual({
    "files/hero.png": "png",
    "locales/en.json": "{}",
    "locales/fr.json": "{}",
  });
  expect(bodies[1]?.files).toEqual(bodies[0]?.files);
});

test("a missing upload URL is an error", async () => {
  await expect(
    uploadSidecars({}, [{ path: "files/a.png", sha256: "", bytes: 1, data: Buffer.from("a") }]),
  ).rejects.toThrow("files/a.png");
});

test("a Hub that answers without uploads stops the publish before any upload", async () => {
  root = mkdtempSync(join(tmpdir(), "publish-old-"));
  const base = join(root, "dist", "climate", "locales");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "en.json"), "{}");

  const puts: string[] = [];
  hub = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "PUT") {
        puts.push(url.pathname);
        return new Response(null, { status: 200 });
      }
      return Response.json({
        uploadUrl: `${url.origin}/upload/index.js`,
        cdnUrl: "c",
        widgetId: "w",
        versionId: "v1",
      });
    },
  });

  const sidecars = walkSidecars(join(root, "dist"), "climate");
  const answer = await requestPublish(`http://localhost:${hub.port}`, "t", {
    scope: "glasshome",
    name: "climate",
    displayName: "Climate",
    minSize: { w: 1, h: 1 },
    maxSize: { w: 2, h: 2 },
    sdkVersion: "^1.0.0",
    version: "1.0.0",
    bundleSize: 1,
    sha256Hash: "a",
    manifestJson: "{}",
    files: entries(sidecars),
  });

  expect(missingSidecarSupport(sidecars, answer.uploads)).toContain("does not accept");
  expect(missingSidecarSupport([], undefined)).toBeNull();
  expect(missingSidecarSupport(sidecars, {})).toBeNull();
  expect(puts).toEqual([]);
});
