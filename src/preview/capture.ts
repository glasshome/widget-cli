import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  freezeClock,
  hashWidgetArtifacts,
  settleAnimations,
  type SharedBrowser,
  watchEgress,
  withFreshBrowser,
  withRenderTimeout,
  withSharedBrowser,
} from "./constraints";
import { serveHarness } from "./serve";

const THEMES = ["light", "dark"] as const;

interface ShotListEntry {
  label?: string;
  size: { w: number; h: number };
}

interface Failure {
  widget: string;
  kind: "network" | "hang" | "integrity";
  detail: string;
}

export interface PreviewSummary {
  shots: number;
  widgets: number;
  skipped: string[];
  failures: Failure[];
}

export interface PreviewOptions {
  projectDir: string;
  only?: string[];
  isolate?: boolean;
  /** Phase updates for a caller-owned spinner; build + vite output is silenced. */
  onProgress?: (message: string) => void;
}

// Filenames become CDN path segments, so keep them to [a-z0-9-]: an example
// labelled "Solar, battery and EV" must not put a comma in a URL.
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build every widget, serve the harness, and screenshot each authored example
 * in light and dark under the render worker's constraints (frozen clock, DNS
 * blackhole, per-render timeout, verify-before-execute hash pin).
 */
export async function capturePreviews(opts: PreviewOptions): Promise<PreviewSummary> {
  const projectDir = resolve(opts.projectDir);
  const only = opts.only ?? [];
  const isolate = opts.isolate ?? false;
  const progress = opts.onProgress ?? (() => {});

  const outDir = resolve(projectDir, "preview");
  const server = await serveHarness(projectDir, only, progress);
  const { base, origin, distDir, widgets: widgetNames } = server;

  const skipped: string[] = [];
  let shot = 0;
  const failures: Failure[] = [];
  const shotLists = new Map<string, ShotListEntry[]>();

  try {
    mkdirSync(outDir, { recursive: true });

    // 3. Enumerate each widget's shot list (one locked browser for the whole pass).
    progress(`Loading ${widgetNames.length} widget(s)...`);
    const pinnedHashes = new Map<string, string>();
    await withFreshBrowser(async (page) => {
      watchEgress(page, origin);
      for (const widget of widgetNames) {
        await page.goto(`${base}?widget=${widget}&ex=0&theme=light`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForSelector("html[data-harness-examples]", {
          state: "attached",
          timeout: 30_000,
        });
        const examples: ShotListEntry[] = JSON.parse(
          (await page.getAttribute("html", "data-harness-examples")) ?? "[]",
        );
        if (examples.length === 0) skipped.push(widget);
        else {
          shotLists.set(widget, examples);
          // Pin the bytes now; every later render must match this.
          pinnedHashes.set(widget, hashWidgetArtifacts(distDir, widget));
        }
      }
    });

    // 4. Render every shot under the worker's constraints.
    const runAll = async (shared: SharedBrowser | null) => {
      let done = 0;
      const total = shotLists.size;
      for (const [widget, examples] of shotLists) {
        progress(`Rendering ${widget} (${++done}/${total})...`);
        const widgetAttempts = new Set<string>();

        // Verify-before-execute: refuse to render bytes that changed since the
        // shot list was built.
        const current = hashWidgetArtifacts(distDir, widget);
        if (current !== pinnedHashes.get(widget)) {
          failures.push({
            widget,
            kind: "integrity",
            detail: `bundle changed after pinning (${pinnedHashes.get(widget)?.slice(0, 12)} -> ${current.slice(0, 12)})`,
          });
          console.log(`${widget}: SKIPPED — bundle hash mismatch`);
          continue;
        }

        for (let i = 0; i < examples.length; i++) {
          const label = slug(examples[i].label ?? `example-${i}`);
          for (const theme of THEMES) {
            const url = `${base}?widget=${widget}&ex=${i}&theme=${theme}`;
            const file = resolve(outDir, `${widget}-${label}-${theme}.png`);

            const shoot = async (page: import("playwright").Page) => {
              const lock = watchEgress(page, origin);
              await freezeClock(page);
              await page.goto(url, { waitUntil: "domcontentloaded" });
              await page.waitForSelector("html[data-harness-ready='1']", {
                state: "attached",
                timeout: 20_000,
              });
              // Fire rAF-gated mount animations before capturing.
              await settleAnimations(page);
              await page.locator("#stage").screenshot({ path: file, omitBackground: true });
              for (const a of lock.attempts) widgetAttempts.add(a);
            };

            const attempt = () =>
              withRenderTimeout(`${widget} / ${label} / ${theme}`, async () => {
                if (shared) {
                  const page = await shared.newPage();
                  try {
                    await shoot(page);
                  } finally {
                    // The browser may already be gone; a failed cleanup must not
                    // mask the real outcome of the render.
                    await page
                      .context()
                      .close()
                      .catch(() => {});
                  }
                } else {
                  await withFreshBrowser(shoot);
                }
              });

            // Two tries. A render that crosses 30s is usually a heavy widget
            // flaking under load, not a real failure: recycle (the wedged
            // browser is why it stalled) and give it one clean retry before
            // recording a miss.
            let ok = false;
            for (let tries = 0; tries < 2 && !ok; tries++) {
              try {
                await attempt();
                ok = true;
              } catch {
                await shared?.recycle().catch(() => {});
              }
            }
            if (ok) shot++;
            else failures.push({ widget, kind: "hang", detail: `${label} (${theme})` });
          }
        }

        for (const a of widgetAttempts) {
          failures.push({ widget, kind: "network", detail: a });
        }
        const flag = widgetAttempts.size ? `  ⚠ needs network (${widgetAttempts.size})` : "";
        console.log(`${widget}: ${examples.length} example(s)${flag}`);
      }
    };

    if (isolate) await runAll(null);
    else await withSharedBrowser((shared) => runAll(shared));
  } finally {
    await server.close();
  }

  return { shots: shot, widgets: shotLists.size, skipped, failures };
}
