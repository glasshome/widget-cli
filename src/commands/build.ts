import { log, spinner } from "@clack/prompts";
import { buildWidgets } from "@glasshome/widget-sdk/vite";
import { emitCatalogs } from "../utils/catalogs";
import { readRegistry } from "../utils/manifest";
import { lintAndReport } from "../utils/lint-source";
import { withQuietStdout } from "../utils/quiet";
import { emitFiles } from "../utils/sidecars";
import { typecheckAndReport } from "../utils/typecheck";

export async function runBuild(cwd: string): Promise<void> {
  const check = spinner();
  check.start("Checking types...");
  const typesOk = typecheckAndReport(cwd);
  check.stop(typesOk ? "Types checked" : "Typecheck failed");
  if (!typesOk) process.exit(1);

  const s = spinner();
  s.start("Building widgets...");

  try {
    const solid = (await import("vite-plugin-solid")).default;
    process.chdir(cwd);
    await withQuietStdout(() =>
      buildWidgets({
        srcDir: "src",
        outDir: "dist",
        // delegateEvents: false, widgets run in closed shadow roots where Solid's
        // document-level event delegation cannot see the target. Must match connect.ts.
        plugins: [solid({ solid: { delegateEvents: false } })],
      }),
    );
    emitCatalogs(cwd);
    for (const widget of readRegistry(cwd)?.widgets ?? []) {
      emitFiles(cwd, widget.bundleUrl.replace(/^\.\//, "").replace(/\.js$/, ""));
    }
    s.stop("Build complete");
    lintAndReport(cwd);
  } catch (err) {
    s.stop("Build failed");
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
