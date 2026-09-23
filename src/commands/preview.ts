import { log } from "@clack/prompts";
import color from "picocolors";
import { runPreview as capturePreview } from "../preview/capture";
import { type Box, DEFAULT_SIZES, runSweep, type Theme } from "../preview/sweep";
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
async function requirePlaywright(): Promise<void> {
  try {
    await import("playwright");
  } catch {
    log.error("Preview needs Playwright + a Chromium build, which are not installed.");
    log.info(`Install them with:\n  ${color.bold("bun add -d playwright && bunx playwright install chromium")}`);
    process.exit(1);
  }
}

const progress = (m: string) => {
  process.stdout.write(`${color.gray("│")}  ${color.dim(m)}\n`);
};

export async function runPreview(cwd: string, names: string[], isolate: boolean): Promise<void> {
  await requirePlaywright();

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

export interface SweepFlags {
  sizes?: string | boolean;
  theme?: string;
  example?: string;
  at?: string;
  config?: string;
  service?: string[];
  click?: string;
  eval?: string;
}

export function wantsSweep(flags: SweepFlags): boolean {
  return Object.values(flags).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));
}

function fail(message: string): never {
  log.error(message);
  process.exit(1);
}

function parseSizes(value: string | boolean | undefined): Box[] {
  if (value === undefined) return [];
  if (value === "grid") return DEFAULT_SIZES;
  return String(value)
    .split(",")
    .map((s) => {
      const m = s.trim().match(/^(\d+)x(\d+)$/);
      if (!m) fail(`--sizes takes grid, or WIDTHxHEIGHT pairs in pixels like 150x156,340x242 (got "${s}")`);
      return { width: Number(m[1]), height: Number(m[2]) };
    });
}

function parseThemes(value: string | undefined): Theme[] {
  if (!value) return ["light", "dark"];
  const themes = value.split(",");
  for (const t of themes) if (t !== "light" && t !== "dark") fail(`--theme is light, dark or both (got "${t}")`);
  return themes as Theme[];
}

function parseConfig(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    fail(`--config must be a JSON object (got ${value})`);
  }
}

/**
 * Render widgets at chosen pixel sizes, with the config, demo state or clock
 * overridden, into `<project>/preview/sweep/`, plus a contact sheet per example
 * and theme when several sizes are rendered.
 */
export async function runSweepPreview(cwd: string, names: string[], flags: SweepFlags): Promise<void> {
  await requirePlaywright();
  const at = flags.at ? new Date(flags.at) : undefined;
  if (at && Number.isNaN(at.getTime())) fail(`--at takes an ISO time like 2026-06-15T21:00:00 (got "${flags.at}")`);
  const examples = flags.example ? flags.example.split(",").map(Number) : [];
  if (examples.some((n) => !Number.isInteger(n) || n < 0)) fail("--example takes example numbers, starting at 0");

  const summary = await withQuietStdout(() =>
    runSweep({
      projectDir: cwd,
      only: names,
      themes: parseThemes(flags.theme),
      examples,
      sizes: parseSizes(flags.sizes),
      at,
      config: parseConfig(flags.config),
      services: flags.service ?? [],
      click: flags.click,
      evaluate: flags.eval,
      onProgress: progress,
      onResult: (line) => process.stdout.write(`${line}\n`),
    }),
  ).catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

  const sheets = summary.sheets ? ` and ${summary.sheets} contact sheet(s)` : "";
  log.success(`Rendered ${summary.shots} image(s)${sheets} into ${color.cyan("preview/sweep/")}`);
  if (summary.failures.length) log.warn(summary.failures.map((f) => `  · ${f}`).join("\n"));
  process.exit(summary.failures.length ? 1 : 0);
}
