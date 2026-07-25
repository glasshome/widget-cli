import { log } from "@clack/prompts";
import color from "picocolors";
import { runPreview as capturePreview } from "../preview/capture";
import { withQuietStdout } from "../utils/quiet";

/**
 * Screenshot every widget's authored examples (light + dark) into
 * `<project>/preview/`, rendered through the same constraints as the hub's
 * render worker: frozen clock, DNS blackhole, per-render timeout, hash pin.
 *
 * Playwright is an OPTIONAL peer — the CLI stays Chromium-free by default — so
 * detect it first and give an actionable install hint rather than a raw
 * module-not-found when it is absent.
 */
export async function runPreview(cwd: string, names: string[], isolate: boolean): Promise<void> {
  try {
    await import("playwright");
  } catch {
    log.error("Preview needs Playwright + a Chromium build, which are not installed.");
    log.info(`Install them with:\n  ${color.bold("bun add -d playwright && bunx playwright install chromium")}`);
    process.exit(1);
  }

  // Capture the REAL stdout writer before withQuietStdout no-ops
  // process.stdout.write. A clack spinner writes through that same override and
  // would freeze inside the quiet block, so progress goes out this bound
  // reference (which the override cannot intercept) as plain lines. Build/vite
  // noise stays silenced; only these phase lines get through.
  const realWrite = process.stdout.write.bind(process.stdout);
  const progress = (m: string) => {
    realWrite(`${color.gray("│")}  ${color.dim(m)}\n`);
  };

  log.info(names.length ? `Previewing ${names.join(", ")}` : "Previewing all widgets");

  let summary: Awaited<ReturnType<typeof capturePreview>>;
  try {
    summary = await withQuietStdout(() =>
      capturePreview({ projectDir: cwd, only: names, isolate, onProgress: progress }),
    );
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const hangs = summary.failures.filter((f) => f.kind === "hang");
  const integrity = summary.failures.filter((f) => f.kind === "integrity");
  const networkWidgets = [
    ...new Set(summary.failures.filter((f) => f.kind === "network").map((f) => f.widget)),
  ];
  const attempted = summary.shots + hangs.length;

  // Headline: plain count of what landed in preview/. A miss only matters if a
  // render could not complete (hangs) or a bundle changed under us (integrity).
  const out = color.cyan("preview/");
  if (hangs.length || integrity.length) {
    log.warn(`Rendered ${summary.shots} of ${attempted} previews into ${out}`);
  } else {
    log.success(`Rendered ${summary.shots} previews (light + dark) into ${out}`);
  }

  if (summary.skipped.length) {
    log.message(color.dim(`No examples to render: ${summary.skipped.join(", ")}`));
  }

  // Real miss: a render still too slow after one retry. Its slot is left without
  // a PNG; everything else rendered.
  if (hangs.length) {
    log.warn(
      `Too slow to render, even after a retry (no image written):\n` +
        hangs.map((f) => `  · ${f.widget}  ${f.detail}`).join("\n"),
    );
  }

  // Should never happen: a bundle's bytes changed mid-run. This is a real
  // problem, not a slow render.
  if (integrity.length) {
    log.error(
      `A bundle changed while rendering (report this):\n` +
        integrity.map((f) => `  · ${f.widget}`).join("\n"),
    );
  }

  // Informational, not a failure: some widgets have no offline data and reach
  // for the network. The request is blocked and nothing leaves the machine; the
  // widget renders a placeholder. Expected for camera; worth a glance if another
  // widget shows up here.
  if (networkWidgets.length) {
    log.message(
      color.dim(
        `Used a placeholder (no offline data; network blocked, nothing left the machine): ${networkWidgets.join(", ")}`,
      ),
    );
  }

  // Vite's dev server leaves live handles behind (file watchers, keep-alive
  // sockets from browsers that crashed mid-render), so the process would sit
  // idle forever after the verdict instead of exiting. Leave deliberately.
  process.exit(hangs.length || integrity.length ? 1 : 0);
}
