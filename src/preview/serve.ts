import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import semver from "semver";
import vitePluginSolid from "vite-plugin-solid";
import { startStageServer } from "./stage-server";
import { assertWidgetSdk, fetchStage, readStage, stageCacheRoot } from "./stage";

export interface HarnessServer {
  base: string;
  origin: string;
  distDir: string;
  widgets: string[];
  sdkVersion: string;
  withManifest: ReadonlySet<string>;
  withCss: ReadonlySet<string>;
  close: () => Promise<void>;
}

export interface StageRequest {
  widget: string;
  ex: number;
  theme: "light" | "dark";
  box?: { width: number; height: number };
  config?: Record<string, string | number | boolean>;
  services?: string[];
  at?: Date;
}

export function stageUrl(
  server: Pick<HarnessServer, "base" | "withManifest" | "withCss">,
  req: StageRequest,
): string {
  const q = new URLSearchParams({ src: `/dist/${req.widget}.js` });
  if (server.withCss.has(req.widget)) q.set("css", `/dist/${req.widget}.css`);
  if (server.withManifest.has(req.widget)) q.set("man", `/manifest/${req.widget}.json`);
  q.set("ex", String(req.ex));
  q.set("theme", req.theme);
  if (req.box) {
    q.set("pw", String(req.box.width));
    q.set("ph", String(req.box.height));
  }
  if (req.config) q.set("cfg", Buffer.from(JSON.stringify(req.config)).toString("base64url"));
  for (const s of req.services ?? []) q.append("svc", s);
  if (req.at) q.set("at", req.at.toISOString());
  return `${server.base}?${q}`;
}

/**
 * Build the widget bundles, fetch the dash's stage, and serve both on loopback.
 * The stage page can reach only what is listed here: its verified files, the
 * built bundles and manifests, and the two icon sets.
 */
export async function serveHarness(
  projectDir: string,
  only: string[],
  dashUrl: string,
  progress: (message: string) => void,
  note: (line: string) => void,
): Promise<HarnessServer> {
  const cacheRoot = stageCacheRoot(dashUrl);
  const distDir = resolve(projectDir, "dist");

  progress(only.length ? `Building ${only.join(", ")}...` : "Building widgets...");
  process.chdir(projectDir);
  await buildWidgets({
    srcDir: "src",
    outDir: "dist",
    ...(only.length ? { only } : {}),
    plugins: [vitePluginSolid({ solid: { delegateEvents: false } })],
  });

  const widgets = readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3))
    .filter((n) => (only.length ? only.includes(n) : true))
    .sort();

  const manifestPath = (name: string) => resolve(projectDir, "src", name, "manifest.json");
  const withManifest = new Set(widgets.filter((name) => existsSync(manifestPath(name))));
  const withCss = new Set(widgets.filter((name) => existsSync(resolve(distDir, `${name}.css`))));

  progress(`Fetching the stage from ${dashUrl}...`);
  const stage = await fetchStage(dashUrl, cacheRoot, "*", note);
  for (const name of withManifest) {
    const range = (JSON.parse(readFileSync(manifestPath(name), "utf8")) as { sdkVersion?: string })
      .sdkVersion;
    if (range && semver.validRange(range)) assertWidgetSdk(stage, name, range);
  }

  const server = startStageServer({ files: readStage(stage), distDir, widgets, manifestPath });
  return {
    base: `${server.origin}/index.html`,
    origin: server.origin,
    distDir,
    widgets,
    sdkVersion: stage.sdkVersion,
    withManifest,
    withCss,
    close: server.stop,
  };
}
