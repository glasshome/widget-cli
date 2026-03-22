import { log, spinner } from "@clack/prompts";
import { buildWidgets } from "@glasshome/widget-sdk/vite";

export async function runBuild(cwd: string): Promise<void> {
  const s = spinner();
  s.start("Building widgets...");

  try {
    const solid = (await import("vite-plugin-solid")).default;
    process.chdir(cwd);
    await buildWidgets({
      srcDir: "src",
      outDir: "dist",
      plugins: [solid()],
    });
    s.stop("Build complete");
  } catch (err) {
    s.stop("Build failed");
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
