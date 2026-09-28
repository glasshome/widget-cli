import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import tailwindcss from "@tailwindcss/vite";
import { createServer } from "vite";
import solid from "vite-plugin-solid";

export interface HarnessServer {
  base: string;
  origin: string;
  distDir: string;
  widgets: string[];
  close: () => Promise<void>;
}

// Every ancestor of the project dir, so vite's fs guard allows the harness to
// reach node_modules hoisted anywhere up the workspace (bun hoists widget-cli's
// deps to the project root, which may be several levels above a widget project).
function ancestors(dir: string): string[] {
  const out: string[] = [];
  let d = dir;
  for (;;) {
    out.push(d);
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return out;
}

/**
 * Build the widget bundles and serve the render harness over them.
 *
 * The vite root is a temp dir created UNDER the project so that: the harness's
 * `../dist/*.js` glob resolves to `<projectDir>/dist`, and every bare import
 * (@glasshome/*, iconify, solid) resolves from the project's own node_modules —
 * a single solid/ui instance, which the built bundle's external imports require.
 */
export async function serveHarness(
  projectDir: string,
  only: string[],
  progress: (message: string) => void,
): Promise<HarnessServer> {
  const distDir = resolve(projectDir, "dist");
  const harnessSrc = resolve(import.meta.dirname, "harness");
  const tempRoot = resolve(projectDir, ".glasshome-preview");

  progress(only.length ? `Building ${only.join(", ")}...` : "Building widgets...");
  process.chdir(projectDir);
  await buildWidgets({
    srcDir: "src",
    outDir: "dist",
    ...(only.length ? { only } : {}),
    plugins: [solid({ solid: { delegateEvents: false } })],
  });

  const widgets = readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3))
    .filter((n) => (only.length ? only.includes(n) : true))
    .sort();

  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  copyFileSync(resolve(harnessSrc, "harness.tsx"), resolve(tempRoot, "harness.tsx"));
  copyFileSync(resolve(harnessSrc, "index.html"), resolve(tempRoot, "index.html"));

  const server = await createServer({
    root: tempRoot,
    configFile: false,
    // delegateEvents: false — widgets mount in closed shadow roots where Solid's
    // document-level event delegation cannot see the target (matches the widgets
    // build and dash mount). tailwindcss() compiles @glasshome/ui/styles so the
    // app theme tokens land on :root exactly as they do in dash.
    plugins: [tailwindcss(), solid({ solid: { delegateEvents: false } })],
    // ui resolves to its Solid source; prebundling would compile that JSX as React unless ui is a direct dependency.
    optimizeDeps: { exclude: ["@glasshome/ui"] },
    server: { fs: { allow: [tempRoot, ...ancestors(projectDir)] } },
  });

  const close = async () => {
    await server.close().catch(() => {});
    // Temp root is throwaway staging; never leave it in the project tree.
    rmSync(tempRoot, { recursive: true, force: true });
  };

  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("vite dev server has no local url");
    return { base, origin: new URL(base).origin, distDir, widgets, close };
  } catch (err) {
    await close();
    throw err;
  }
}
