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

  log.success(`Captured ${summary.shots} shot(s) across ${summary.widgets} widget(s)`);

  if (summary.skipped.length) {
    log.info(`No examples (skipped): ${summary.skipped.join(", ")}`);
  }

  const network = summary.failures.filter((f) => f.kind === "network");
  const hangs = summary.failures.filter((f) => f.kind === "hang");
  const integrity = summary.failures.filter((f) => f.kind === "integrity");

  // Nothing can actually leave — DNS is blackholed. These are blocked attempts,
  // i.e. what each widget wanted from the network and must degrade without.
  if (network.length) {
    log.warn(
      `NETWORK: ${network.length} blocked request(s) — all denied, none left the machine\n` +
        network.map((f) => `  ${f.widget}  ${f.detail}`).join("\n"),
    );
  } else {
    log.success("NETWORK: no widget attempted to reach the network");
  }

  if (hangs.length) {
    log.error(
      `RENDER: ${hangs.length} render(s) failed or timed out\n` +
        hangs.map((f) => `  ${f.widget}  ${f.detail}`).join("\n"),
    );
  } else {
    log.success("RENDER: every render settled inside the timeout");
  }

  if (integrity.length) {
    log.error(
      `INTEGRITY: ${integrity.length} widget(s) changed after pinning\n` +
        integrity.map((f) => `  ${f.widget}  ${f.detail}`).join("\n"),
    );
  } else {
    log.success("INTEGRITY: every bundle matched its pinned hash");
  }

  log.info(`Previews written to ${color.cyan("preview/")}`);

  // Vite's dev server leaves live handles behind (file watchers, keep-alive
  // sockets from browsers that crashed mid-render), so the process would sit
  // idle forever after the verdict instead of exiting. Leave deliberately.
  process.exit(hangs.length || integrity.length ? 1 : 0);
}
