import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { systemClock, withDeadline } from "@glasshome/widget-contract/clock";
import semver from "semver";

const STAGE_VERSION = 1;
export const DEFAULT_DASH = "https://demo.glasshome.app";

const FILE_DEADLINE_MS = 30_000;
const MAX_FILES = 64;
const MAX_BYTES = 64 * 1024 * 1024;
const MANIFEST_NAME = "manifest.json";
const STAGE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface StageDir {
  dir: string;
  sdkVersion: string;
  from: "network" | "cache";
}

interface StageManifest {
  stageVersion: number;
  sdkVersion: string;
  files: Record<string, string>;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return bare === "localhost" || bare === "::1" || /^127(\.\d{1,3}){3}$/.test(bare);
}

function stageBase(dashUrl: string): URL {
  let url: URL;
  try {
    url = new URL(dashUrl);
  } catch {
    throw new Error(`--dash takes a URL like https://demo.glasshome.app (got "${dashUrl}")`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
    throw new Error(
      `${url.origin}: previews fetch the stage over https (plain http only on localhost)`,
    );
  return new URL("stage/", url.href.endsWith("/") ? url.href : `${url.href}/`);
}

export function stageCacheRoot(dashUrl: string): string {
  stageBase(dashUrl);
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "glasshome", "stage", new URL(dashUrl).host.replace(/[^A-Za-z0-9.-]/g, "_"));
}

class StageRefused extends Error {}

async function readCapped(res: Response, url: URL, limit: number, abort: AbortController) {
  const tooBig = () => {
    abort.abort();
    return new StageRefused(`${url.pathname}: larger than the stage allows`);
  };
  if (Number(res.headers.get("content-length") ?? 0) > limit) throw tooBig();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const part = await reader?.read();
    if (!part || part.done) break;
    total += part.value.length;
    if (total > limit) throw tooBig();
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function download(url: URL, limit: number): Promise<Uint8Array> {
  const abort = new AbortController();
  const work = (async () => {
    const res = await fetch(url, { signal: abort.signal, redirect: "manual" });
    if (res.status >= 300 && res.status < 400)
      throw new StageRefused(
        `${url.pathname}: the dash redirected; a stage is served from the dash itself`,
      );
    if (!res.ok) throw new Error(`${url.pathname}: the dash answered ${res.status}`);
    return readCapped(res, url, limit, abort);
  })();
  const result = await withDeadline(systemClock, work, FILE_DEADLINE_MS).catch((err: unknown) => {
    abort.abort();
    throw err;
  });
  if (!result.ok) {
    abort.abort();
    work.catch(() => {});
    throw new Error(`${url.pathname}: no answer in ${FILE_DEADLINE_MS / 1000} s`);
  }
  return result.value;
}

function parseManifest(bytes: Uint8Array): StageManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("the stage manifest is not JSON");
  }
  const m = raw as Partial<StageManifest> | null;
  if (!m || typeof m !== "object" || m.stageVersion !== STAGE_VERSION)
    throw new Error(
      `this dash serves a stage version ${String((m as { stageVersion?: unknown } | null)?.stageVersion)} this CLI does not know; upgrade @glasshome/widget-cli`,
    );
  if (typeof m.sdkVersion !== "string" || !semver.valid(m.sdkVersion))
    throw new Error("the stage manifest names no SDK version");
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files))
    throw new Error("the stage manifest lists no files");
  const paths = Object.keys(m.files);
  if (paths.length > MAX_FILES) throw new Error(`the stage lists more than ${MAX_FILES} files`);
  const lower = new Set<string>();
  for (const path of paths) {
    if (lower.has(path.toLowerCase()))
      throw new Error(`${path}: collides with another path in the stage`);
    lower.add(path.toLowerCase());
  }
  for (const path of paths) {
    const sha = m.files[path];
    if (!STAGE_PATH.test(path) || path.split("/").some((s) => s === "." || s === ".."))
      throw new Error(`${path}: not a path inside the stage`);
    if (path === MANIFEST_NAME || typeof sha !== "string" || !SHA256_HEX.test(sha))
      throw new Error(`${path}: the manifest gives no sha-256 for it`);
  }
  return m as StageManifest;
}

function assertSdk(manifest: StageManifest, range: string): void {
  if (!semver.satisfies(manifest.sdkVersion, range))
    throw new Error(
      `the stage runs SDK ${manifest.sdkVersion}, outside the widget's sdkVersion ${range}`,
    );
}

function verifiedEntry(dir: string): StageManifest | null {
  try {
    const manifestBytes = readFileSync(join(dir, MANIFEST_NAME));
    if (sha256(manifestBytes) !== basename(dir)) return null;
    const manifest = parseManifest(manifestBytes);
    for (const [path, sha] of Object.entries(manifest.files))
      if (sha256(readFileSync(join(dir, path))) !== sha) return null;
    return manifest;
  } catch {
    return null;
  }
}

function newestVerified(root: string): { dir: string; manifest: StageManifest } | null {
  if (!existsSync(root)) return null;
  const entries = readdirSync(root)
    .filter((name) => SHA256_HEX.test(name))
    .map((name) => ({ dir: join(root, name), at: statSync(join(root, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const entry of entries) {
    const manifest = verifiedEntry(entry.dir);
    if (manifest) return { dir: entry.dir, manifest };
  }
  return null;
}

async function downloadInto(
  base: URL,
  manifest: StageManifest,
  manifestBytes: Uint8Array,
  dir: string,
) {
  const staging = `${dir}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    let left = MAX_BYTES;
    for (const [path, sha] of Object.entries(manifest.files)) {
      const bytes = await download(new URL(path, base), left);
      left -= bytes.length;
      if (sha256(bytes) !== sha) throw new Error(`${path}: sha-256 differs from the manifest`);
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, MANIFEST_NAME), manifestBytes);
    try {
      renameSync(staging, dir);
    } catch (err) {
      if (!verifiedEntry(dir)) throw err;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The dash's stage, verified file by file against its manifest and kept under `cacheRoot`. */
export async function fetchStage(
  dashUrl: string,
  cacheRoot: string,
  widgetSdkRange: string,
  note: (line: string) => void = () => {},
): Promise<StageDir> {
  const base = stageBase(dashUrl);

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await download(new URL(MANIFEST_NAME, base), 1024 * 1024);
  } catch (err) {
    if (err instanceof StageRefused) throw err;
    const cached = newestVerified(cacheRoot);
    if (!cached)
      throw new Error(
        `${base.origin} is unreachable and no stage is cached: ${(err as Error).message}`,
      );
    assertSdk(cached.manifest, widgetSdkRange);
    note(
      `${base.origin} is unreachable; using the cached stage (SDK ${cached.manifest.sdkVersion})`,
    );
    return { dir: cached.dir, sdkVersion: cached.manifest.sdkVersion, from: "cache" };
  }

  const manifest = parseManifest(manifestBytes);
  assertSdk(manifest, widgetSdkRange);
  const dir = join(cacheRoot, sha256(manifestBytes));
  if (verifiedEntry(dir)) return { dir, sdkVersion: manifest.sdkVersion, from: "cache" };

  mkdirSync(cacheRoot, { recursive: true });
  if (existsSync(dir))
    renameSync(dir, `${dir}.stale-${process.pid}-${randomBytes(4).toString("hex")}`);
  await downloadInto(base, manifest, manifestBytes, dir);
  for (const name of readdirSync(cacheRoot))
    if (name.startsWith(`${basename(dir)}.stale-${process.pid}-`))
      rmSync(join(cacheRoot, name), { recursive: true, force: true });
  return { dir, sdkVersion: manifest.sdkVersion, from: "network" };
}

/** The stage's bytes, read once and hashed again, so what is served is what the manifest names. */
export function readStage(stage: StageDir): Map<string, Uint8Array> {
  const manifestBytes = readFileSync(join(stage.dir, MANIFEST_NAME));
  if (sha256(manifestBytes) !== basename(stage.dir))
    throw new Error("the cached stage does not match its manifest");
  const files = new Map<string, Uint8Array>();
  for (const [path, sha] of Object.entries(parseManifest(manifestBytes).files)) {
    const bytes = readFileSync(join(stage.dir, path));
    if (sha256(bytes) !== sha) throw new Error(`${path}: sha-256 differs from the manifest`);
    files.set(path, bytes);
  }
  return files;
}

/** Throws naming `label` when the stage's SDK is outside `range`. */
export function assertWidgetSdk(stage: StageDir, label: string, range: string): void {
  if (!semver.satisfies(stage.sdkVersion, range))
    throw new Error(
      `${label}: the stage runs SDK ${stage.sdkVersion}, outside the widget's sdkVersion ${range}`,
    );
}
