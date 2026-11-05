import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import lucideJson from "@iconify-json/lucide/icons.json";
import mdiJson from "@iconify-json/mdi/icons.json";
import type { IconifyJSON } from "@iconify/types";
import { getIcons } from "@iconify/utils";

export const STAGE_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'";

const ICON_SETS: Record<string, IconifyJSON> = {
  mdi: mdiJson as IconifyJSON,
  lucide: lucideJson as IconifyJSON,
};
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ICONS = 256;
const BUNDLE = /^\/dist\/([A-Za-z0-9._-]+)\.(js|css)$/;
const MANIFEST = /^\/manifest\/([A-Za-z0-9._-]+)\.json$/;
const ICONS = /^\/iconify\/([a-z0-9-]+)\.json$/;

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  wasm: "application/wasm",
  woff2: "font/woff2",
  json: "application/json",
  bin: "application/octet-stream",
};

const headers = (type: string) => ({
  "Content-Type": type,
  "Content-Security-Policy": STAGE_CSP,
  "X-Content-Type-Options": "nosniff",
});

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: headers("text/plain; charset=utf-8") });

function iconsFor(prefix: string, query: string | null): Response {
  const set = ICON_SETS[prefix];
  const names = (query ?? "").split(",").filter(Boolean);
  if (!set) return text("Not Found", 404);
  if (!names.length || names.length > MAX_ICONS || names.some((n) => !ICON_NAME.test(n)))
    return text("Bad Request", 400);
  return new Response(JSON.stringify(getIcons(set, names, true) ?? { prefix, icons: {} }), {
    headers: headers("application/json"),
  });
}

export interface StageServerOptions {
  /** The verified stage, by path. */
  files: ReadonlyMap<string, Uint8Array>;
  distDir: string;
  widgets: readonly string[];
  manifestPath: (widget: string) => string;
}

/** Serves one page: its stage files, built bundles, widget manifests and icons, under the CLI's own CSP. */
export function startStageServer(opts: StageServerOptions): {
  origin: string;
  stop: () => Promise<void>;
} {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      if (req.headers.get("host") !== `127.0.0.1:${server.port}`) return text("Forbidden", 403);
      if (req.method !== "GET") return text("Method Not Allowed", 405);
      const url = new URL(req.url);
      const path = url.pathname;

      const bundle = BUNDLE.exec(path);
      if (bundle?.[1] && bundle[2] && opts.widgets.includes(bundle[1])) {
        const file = resolve(opts.distDir, `${bundle[1]}.${bundle[2]}`);
        return existsSync(file) ? text(readFileSync(file, "utf8")) : text("Not Found", 404);
      }
      const manifest = MANIFEST.exec(path);
      if (
        manifest?.[1] &&
        opts.widgets.includes(manifest[1]) &&
        existsSync(opts.manifestPath(manifest[1]))
      )
        return text(readFileSync(opts.manifestPath(manifest[1]), "utf8"));
      const icons = ICONS.exec(path);
      if (icons?.[1]) return iconsFor(icons[1], url.searchParams.get("icons"));

      const file = path === "/" ? "index.html" : path.slice(1);
      const bytes = opts.files.get(file);
      const type = MIME[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream";
      return bytes
        ? new Response(new Uint8Array(bytes), { headers: headers(type) })
        : text("Not Found", 404);
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
