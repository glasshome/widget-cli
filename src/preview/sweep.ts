import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { slug } from "./capture";
import {
  freezeClock,
  settleAnimations,
  watchEgress,
  withRenderTimeout,
  withSharedBrowser,
} from "./constraints";
import { serveHarness } from "./serve";

export type Theme = "light" | "dark";

export interface Box {
  width: number;
  height: number;
}

export interface SweepOptions {
  projectDir: string;
  only: string[];
  themes: Theme[];
  /** Example indexes to render; all when empty. */
  examples: number[];
  /** Pixel boxes to render; each example's own size when empty. */
  sizes: Box[];
  at?: Date;
  config?: Record<string, unknown>;
  /** `domain.service|entity_id|json`, replayed against the demo home before mount. */
  services: string[];
  click?: string;
  evaluate?: string;
  onProgress?: (message: string) => void;
  onResult?: (line: string) => void;
}

export interface SweepSummary {
  shots: number;
  sheets: number;
  outDir: string;
  failures: string[];
}

interface Example {
  label?: string;
  size: { w: number; h: number };
}

interface Bounds {
  min: { w: number; h: number };
  max: { w: number; h: number };
}

export const DEFAULT_SIZES: Box[] = [70, 156, 242, 328].flatMap((height) =>
  [84, 150, 200, 270, 340, 420].map((width) => ({ width, height })),
);

// Inverse of the harness's tilePx height: rows * 70 + (rows - 1) * 16.
const rowsFor = (height: number) => Math.round((height + 16) / 86);

// Roots stay closed as in dash, so a handler that cannot fire there fails here too; --eval and --click reach in through this.
function keepShadowRoots(): void {
  // oxlint-disable-next-line typescript/unbound-method -- captured to re-call with .call(this) from the patch
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    Object.defineProperty(this, "__widgetRoot", { value: root });
    return root;
  };
}

export async function runSweep(opts: SweepOptions): Promise<SweepSummary> {
  const progress = opts.onProgress ?? (() => {});
  const report = opts.onResult ?? (() => {});
  const projectDir = resolve(opts.projectDir);
  const outDir = resolve(projectDir, "preview", "sweep");
  const server = await serveHarness(projectDir, opts.only, progress);
  const failures: string[] = [];
  let shots = 0;
  let sheets = 0;

  const query = (widget: string, ex: number, theme: Theme, box?: Box) => {
    const q = new URLSearchParams({ widget, ex: String(ex), theme });
    if (box) {
      q.set("pw", String(box.width));
      q.set("ph", String(box.height));
    }
    if (opts.config) q.set("cfg", JSON.stringify(opts.config));
    for (const s of opts.services) q.append("svc", s);
    return `${server.base}?${q}`;
  };

  const render = async (page: Page, url: string, file: string): Promise<unknown> => {
    watchEgress(page, server.origin);
    await page.addInitScript(keepShadowRoots);
    if (opts.at) await page.clock.install({ time: opts.at });
    else await freezeClock(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("html[data-harness-ready='1']", {
      state: "attached",
      timeout: 20_000,
    });
    await settleAnimations(page);
    if (opts.click) {
      // Playwright's actionability checks wait on animation frames, which a frozen clock never runs.
      await page.clock.resume();
      const at = await page.evaluate((selector) => {
        const stage = document.getElementById("stage") as { __widgetRoot?: ShadowRoot } | null;
        const box = stage?.__widgetRoot?.querySelector(selector)?.getBoundingClientRect();
        return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
      }, opts.click);
      if (!at) throw new Error(`--click: nothing matches ${opts.click} inside the widget`);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(1_500);
    }
    await page.locator("#stage").screenshot({ path: file, omitBackground: true });
    if (!opts.evaluate) return undefined;
    return page.evaluate(
      `(function (root) { return (${opts.evaluate}); })(document.getElementById("stage")?.__widgetRoot)`,
    );
  };

  try {
    mkdirSync(outDir, { recursive: true });
    await withSharedBrowser(async (browser) => {
      for (const widget of server.widgets) {
        const probe = await browser.newPage();
        let examples: Example[] = [];
        let bounds: Bounds | undefined;
        try {
          await probe.goto(query(widget, 0, "light"), { waitUntil: "domcontentloaded" });
          await probe.waitForSelector("html[data-harness-bounds]", {
            state: "attached",
            timeout: 30_000,
          });
          examples = JSON.parse(
            (await probe.getAttribute("html", "data-harness-examples")) ?? "[]",
          );
          bounds = JSON.parse((await probe.getAttribute("html", "data-harness-bounds")) ?? "null");
        } finally {
          await probe.context().close();
        }
        if (!examples.length || !bounds) {
          failures.push(`${widget}: no examples to render`);
          continue;
        }
        const fits = (box: Box) => {
          const rows = rowsFor(box.height);
          return bounds !== undefined && rows >= bounds.min.h && rows <= bounds.max.h;
        };

        const indexes = opts.examples.length ? opts.examples : examples.map((_, i) => i);
        for (const ex of indexes) {
          const example = examples[ex];
          if (!example) {
            failures.push(`${widget}: no example ${ex}`);
            continue;
          }
          const label = slug(example.label ?? `example-${ex}`);
          const boxes = opts.sizes.length ? opts.sizes.filter(fits) : [undefined];
          for (const theme of opts.themes) {
            progress(`Rendering ${widget} / ${label} / ${theme}...`);
            const shot: { box: Box | undefined; file: string }[] = [];
            for (const box of boxes) {
              const size = box ? `-${box.width}x${box.height}` : "";
              const file = resolve(outDir, `${widget}-${label}-${theme}${size}.png`);
              const page = await browser.newPage();
              try {
                const result = await withRenderTimeout(`${widget} ${label} ${theme}${size}`, () =>
                  render(page, query(widget, ex, theme, box), file),
                );
                shots++;
                shot.push({ box, file });
                if (opts.evaluate) {
                  report(`${widget} ${label} ${theme}${size}: ${JSON.stringify(result)}`);
                }
              } catch (err) {
                failures.push(`${widget} ${label} ${theme}${size}: ${(err as Error).message}`);
                await browser.recycle().catch(() => {});
              } finally {
                await page
                  .context()
                  .close()
                  .catch(() => {});
              }
            }
            if (shot.length > 1) {
              const page = await browser.newPage();
              try {
                await writeSheet(
                  page,
                  theme,
                  shot,
                  resolve(outDir, `${widget}-${label}-${theme}.png`),
                );
                sheets++;
              } finally {
                await page
                  .context()
                  .close()
                  .catch(() => {});
              }
            }
          }
        }
      }
    });
  } finally {
    await server.close();
  }

  return { shots, sheets, outDir, failures };
}

// One row per height, widths left to right, each shot at its CSS size.
async function writeSheet(
  page: Page,
  theme: Theme,
  shots: { box: Box | undefined; file: string }[],
  path: string,
): Promise<void> {
  const rows = new Map<number, { box: Box; file: string }[]>();
  for (const s of shots) {
    if (!s.box) continue;
    rows.set(s.box.height, [...(rows.get(s.box.height) ?? []), { box: s.box, file: s.file }]);
  }
  const background =
    theme === "light"
      ? "linear-gradient(135deg,#e9edf3,#cfd8e3)"
      : "linear-gradient(135deg,#1b2230,#0d1117)";
  const body = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((height) => {
      const cells = (rows.get(height) ?? [])
        .sort((a, b) => a.box.width - b.box.width)
        .map(
          ({ box, file }) =>
            `<figure><img width="${box.width}" height="${box.height}" src="data:image/png;base64,${readFileSync(file).toString("base64")}"><figcaption>${box.width}x${box.height}</figcaption></figure>`,
        )
        .join("");
      return `<div class="row">${cells}</div>`;
    })
    .join("");
  await page.setContent(
    `<style>body{margin:0}#sheet{display:inline-block;padding:20px 20px 4px;background:${background};font:12px sans-serif;color:#888}.row{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}figure{margin:0}img{display:block}</style><div id="sheet">${body}</div>`,
  );
  await page.locator("#sheet").screenshot({ path });
}
