import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const GUIDE_PATH = "node_modules/@glasshome/widget-sdk/guide/widgets.md";
const START = "<!-- glasshome-widget:start -->";
const END = "<!-- glasshome-widget:end -->";
const SKILL_FILE = ".claude/skills/glasshome-widget/SKILL.md";

const pointer = `Read \`${GUIDE_PATH}\` (or an ancestor's \`node_modules\`) before working on a widget. It matches the installed SDK; \`bun widget upgrade\` updates both.`;

const skill = `---
name: glasshome-widget
description: Use when building, styling, previewing or reviewing a GlassHome widget in this project.
---

# GlassHome widgets

${pointer}

${START}
Managed by \`bun widget upgrade\`. Delete this block to own the file.
${END}
`;

const agentsBlock = `${START}
## GlassHome widgets

${pointer}
${END}`;

export type StubResult = "written" | "updated" | "kept";

/** The skill is ours while it still carries the marker; without it the author owns the file. */
function writeSkill(projectDir: string): StubResult {
  const path = join(projectDir, SKILL_FILE);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, skill);
    return "written";
  }
  const current = readFileSync(path, "utf-8");
  if (!current.includes(START) || current === skill) return "kept";
  writeFileSync(path, skill);
  return "updated";
}

function writeAgents(projectDir: string): StubResult {
  const path = join(projectDir, "AGENTS.md");
  if (!existsSync(path)) {
    writeFileSync(path, `${agentsBlock}\n`);
    return "written";
  }
  const current = readFileSync(path, "utf-8");
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start !== -1 && end < start) return "kept";
  const next =
    start !== -1
      ? current.slice(0, start) + agentsBlock + current.slice(end + END.length)
      : `${current.trimEnd()}\n\n${agentsBlock}\n`;
  if (next === current) return "kept";
  writeFileSync(path, next);
  return "updated";
}

/** The guide the installed SDK ships, or null when the SDK predates it. */
export function installedGuide(projectDir: string): string | null {
  try {
    const require = createRequire(resolve(projectDir, "package.json"));
    const guide = join(
      dirname(require.resolve("@glasshome/widget-sdk/package.json")),
      "guide/widgets.md",
    );
    return existsSync(guide) ? guide : null;
  } catch {
    return null;
  }
}

/** Point coding agents (Claude skill, AGENTS.md) at the guide the installed SDK ships. */
export function writeAgentStubs(projectDir: string): { skill: StubResult; agents: StubResult } {
  return { skill: writeSkill(projectDir), agents: writeAgents(projectDir) };
}
