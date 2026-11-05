import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { fetchStage } from "./stage";

const FILES: Record<string, string> = { "stage.js": "export {}", "assets/a.css": "a{}" };
const SHA = "0".repeat(64);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let dash: ReturnType<typeof Bun.serve> | undefined;
let fileHits = 0;
const roots: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-test-"));
  roots.push(dir);
  return dir;
}

function serveManifest(manifest: unknown, bodies: Record<string, string> = FILES) {
  void dash?.stop(true);
  dash = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname.replace(/^\/stage\//, "");
      if (path === "manifest.json") return Response.json(manifest);
      fileHits++;
      const body = bodies[path];
      return body === undefined ? new Response("no", { status: 404 }) : new Response(body);
    },
  });
}

function serve(tampered: Record<string, string>) {
  const files = Object.fromEntries(Object.entries(FILES).map(([p, t]) => [p, sha(t)]));
  serveManifest({ stageVersion: 1, sdkVersion: "1.30.0", files }, { ...FILES, ...tampered });
}

const url = () => dash?.url.href ?? "";

afterEach(async () => {
  await dash?.stop(true);
  dash = undefined;
  fileHits = 0;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a file that differs from the manifest is refused", async () => {
  serve({ "stage.js": "tampered" });
  await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow(
    "stage.js: sha-256 differs from the manifest",
  );
});

test("a verified stage is cached; the second run reads only the manifest", async () => {
  serve({});
  const root = tmp();
  const first = await fetchStage(url(), root, "^1.0.0");
  expect(first.from).toBe("network");
  fileHits = 0;
  expect((await fetchStage(url(), root, "^1.0.0")).from).toBe("cache");
  expect(fileHits).toBe(0);
});

test("offline, the cached stage still runs and says so", async () => {
  serve({});
  const root = tmp();
  const home = url();
  await fetchStage(home, root, "^1.0.0");
  await dash?.stop(true);
  const notes: string[] = [];
  const offline = await fetchStage(home, root, "^1.0.0", (line) => notes.push(line));
  expect(offline.from).toBe("cache");
  expect(notes.join("\n")).toContain("1.30.0");
});

test("offline with nothing cached is refused", async () => {
  serve({});
  const home = url();
  await dash?.stop(true);
  await expect(fetchStage(home, tmp(), "^1.0.0")).rejects.toThrow("no stage is cached");
});

test("a path that leaves the stage, a newer stage or another SDK is refused", async () => {
  serveManifest({ stageVersion: 1, sdkVersion: "1.30.0", files: { "../x": SHA } });
  await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow("../x");
  serveManifest({ stageVersion: 2, sdkVersion: "1.30.0", files: {} });
  await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow("upgrade @glasshome/widget-cli");
  serveManifest({ stageVersion: 1, sdkVersion: "1.30.0", files: {} });
  await expect(fetchStage(url(), tmp(), "^2.0.0")).rejects.toThrow("1.30.0");
});

test("a cached file edited on disk is fetched again", async () => {
  serve({});
  const root = tmp();
  const first = await fetchStage(url(), root, "^1.0.0");
  await Bun.write(join(first.dir, "stage.js"), "edited");
  const again = await fetchStage(url(), root, "^1.0.0");
  expect(again.from).toBe("network");
  expect(await Bun.file(join(again.dir, "stage.js")).text()).toBe(FILES["stage.js"]);
});

test("plain http is refused except on loopback", async () => {
  await expect(fetchStage("http://home.lan:3124", tmp(), "^1.0.0")).rejects.toThrow("https");
});

test("a dash that redirects to another origin is refused, never followed", async () => {
  const elsewhere = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({}) });
  try {
    dash = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`${elsewhere.url.href}stage/manifest.json`, 302),
    });
    await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow("redirected");
  } finally {
    await elsewhere.stop(true);
  }
});

test("a body past the cap is cut off while it streams", async () => {
  dash = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(256 * 1024));
          },
        }),
      ),
  });
  await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow("larger than the stage allows");
});

test("paths that differ only in case are refused", async () => {
  serveManifest({ stageVersion: 1, sdkVersion: "1.30.0", files: { "A.js": SHA, "a.js": SHA } });
  await expect(fetchStage(url(), tmp(), "^1.0.0")).rejects.toThrow("collides");
});

test("a cached entry whose manifest is not the one its folder names is not trusted", async () => {
  serve({});
  const root = tmp();
  const first = await fetchStage(url(), root, "^1.0.0");
  const other = { stageVersion: 1, sdkVersion: "1.30.0", files: {} };
  await Bun.write(join(first.dir, "manifest.json"), JSON.stringify(other));
  expect((await fetchStage(url(), root, "^1.0.0")).from).toBe("network");
});

test("two first runs at once both end with the verified stage", async () => {
  serve({});
  const root = tmp();
  const [a, b] = await Promise.all([
    fetchStage(url(), root, "^1.0.0"),
    fetchStage(url(), root, "^1.0.0"),
  ]);
  expect(a.dir).toBe(b.dir);
  expect(await Bun.file(join(a.dir, "stage.js")).text()).toBe(FILES["stage.js"]);
});
