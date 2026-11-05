import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import lucideJson from "@iconify-json/lucide/icons.json";
import mdiJson from "@iconify-json/mdi/icons.json";
import type { IconifyJSON } from "@iconify/types";
import { getIcons } from "@iconify/utils";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import semver from "semver";
import vitePluginSolid from "vite-plugin-solid";
import { fetchStage, stageCacheRoot, stageFiles } from "./stage";

export interface HarnessServer {
  base: string;
  origin: string;
  distDir: string;
  widgets: string[];
  sdkVersion: string;
  close: () => Promise<void>;
}

export interface StageRequest {
  widget: string;
  ex: number;
  theme: "light" | "dark";
  box?: { width: number; height: number };
  config?: Record<string, unknown>;
  services?: string[];
  at?: Date;
}

const ICON_SETS: Record<string, IconifyJSON> = {
  mdi: mdiJson as IconifyJSON,
  lucide: lucideJson as IconifyJSON,
};
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ICONS = 256;
const BUNDLE = /^\/dist\/([A-Za-z0-9._-]+)\.(js|css)$/;
const MANIFEST = /^\/manifest\/([A-Za-z0-9._-]+)\.json$/;
const ICONS = /^\/iconify\/([a-z0-9-]+)\.json$/;

export function stageUrl(server: HarnessServer, req: StageRequest): string {
  const q = new URLSearchParams({
    src: `/dist/${req.widget}.js`,
    css: `/dist/${req.widget}.css`,
    man: `/manifest/${req.widget}.json`,
    ex: String(req.ex),
    theme: req.theme,
  });
  if (req.box) {
    q.set("pw", String(req.box.width));
    q.set("ph", String(req.box.height));
  }
  if (req.config) q.set("cfg", Buffer.from(JSON.stringify(req.config)).toString("base64url"));
  for (const s of req.services ?? []) q.append("svc", s);
  if (req.at) q.set("at", req.at.toISOString());
  return `${server.base}?${q}`;
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function iconsFor(prefix: string, query: string | null): Response {
  const set = ICON_SETS[prefix];
  const names = (query ?? "").split(",").filter(Boolean);
  if (!set) return text("Not Found", 404);
  if (!names.length || names.length > MAX_ICONS || names.some((n) => !ICON_NAME.test(n)))
    return text("Bad Request", 400);
  return Response.json(getIcons(set, names, true) ?? { prefix, icons: {} });
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
  const ranges = widgets.flatMap((name) => {
    if (!existsSync(manifestPath(name))) return [];
    const range = (JSON.parse(readFileSync(manifestPath(name), "utf8")) as { sdkVersion?: string })
      .sdkVersion;
    return range && semver.validRange(range) ? [range] : [];
  });

  progress(`Fetching the stage from ${dashUrl}...`);
  const stage = await fetchStage(dashUrl, stageCacheRoot(dashUrl), ranges.join(" ") || "*", note);
  const files = stageFiles(stage);

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (req.method !== "GET") return text("Method Not Allowed", 405);

      const bundle = BUNDLE.exec(path);
      if (bundle?.[1] && bundle[2] && widgets.includes(bundle[1])) {
        const file = resolve(distDir, `${bundle[1]}.${bundle[2]}`);
        return existsSync(file) ? text(readFileSync(file, "utf8")) : text("Not Found", 404);
      }
      const manifest = MANIFEST.exec(path);
      if (manifest?.[1] && widgets.includes(manifest[1]) && existsSync(manifestPath(manifest[1])))
        return text(readFileSync(manifestPath(manifest[1]), "utf8"));
      const icons = ICONS.exec(path);
      if (icons?.[1]) return iconsFor(icons[1], url.searchParams.get("icons"));

      const staged = files.get(path === "/" ? "index.html" : path.slice(1));
      return staged ? new Response(Bun.file(staged)) : text("Not Found", 404);
    },
  });

  const origin = `http://127.0.0.1:${server.port}`;
  return {
    base: `${origin}/index.html`,
    origin,
    distDir,
    widgets,
    sdkVersion: stage.sdkVersion,
    close: async () => {
      await server.stop(true);
    },
  };
}
