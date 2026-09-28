import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAgentStubs } from "./agent-guide";

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-guide-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const skillPath = (dir: string) => join(dir, ".claude/skills/glasshome-widget/SKILL.md");
const guide = "node_modules/@glasshome/widget-sdk/guide/widgets.md";

describe("writeAgentStubs", () => {
  test("a fresh project gets a skill and an AGENTS.md that point at the SDK's guide", () => {
    const dir = project();
    expect(writeAgentStubs(dir)).toEqual({ skill: "written", agents: "written" });
    expect(readFileSync(skillPath(dir), "utf-8")).toStartWith("---\nname: glasshome-widget\n");
    expect(readFileSync(skillPath(dir), "utf-8")).toContain(guide);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain(guide);
  });

  test("running again changes nothing", () => {
    const dir = project();
    writeAgentStubs(dir);
    expect(writeAgentStubs(dir)).toEqual({ skill: "kept", agents: "kept" });
  });

  test("an author's AGENTS.md keeps its text and gains one block, replaced in place later", () => {
    const dir = project();
    writeFileSync(join(dir, "AGENTS.md"), "# Mine\n\nUse tabs.\n");
    writeAgentStubs(dir);
    const once = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(once).toStartWith("# Mine\n\nUse tabs.\n\n<!-- glasshome-widget:start -->");

    writeFileSync(
      join(dir, "AGENTS.md"),
      once.replace(
        /start -->[\s\S]*<!-- glasshome-widget:end/,
        "start -->\nold\n<!-- glasshome-widget:end",
      ),
    );
    expect(writeAgentStubs(dir).agents).toBe("updated");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(once);
  });

  test("an AGENTS.md whose block lost its end marker is left alone", () => {
    const dir = project();
    const broken = "# Mine\n\n<!-- glasshome-widget:start -->\nhalf a block\n\nMore of mine.\n";
    writeFileSync(join(dir, "AGENTS.md"), broken);
    expect(writeAgentStubs(dir).agents).toBe("kept");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(broken);
  });

  test("a skill the author took over (marker removed) is left alone", () => {
    const dir = project();
    mkdirSync(join(dir, ".claude/skills/glasshome-widget"), { recursive: true });
    writeFileSync(skillPath(dir), "my own skill\n");
    expect(writeAgentStubs(dir).skill).toBe("kept");
    expect(readFileSync(skillPath(dir), "utf-8")).toBe("my own skill\n");
  });
});
