import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GUIDE_PATH = "node_modules/@glasshome/widget-sdk/guide/widgets.md";
const START = "<!-- glasshome-widget:start -->";
const END = "<!-- glasshome-widget:end -->";
const SKILL_FILE = ".claude/skills/glasshome-widget/SKILL.md";

const pointer = `Before building, styling or reviewing a widget in this project, read \`${GUIDE_PATH}\` in full (in a workspace it may sit in an ancestor's \`node_modules\`). It ships with the installed \`@glasshome/widget-sdk\`, so it always matches the SDK this project builds against, and it wins over anything you remember about GlassHome widgets. \`bun widget upgrade\` moves the SDK and this guide forward together.`;

const skill = `---
name: glasshome-widget
description: Use when building, styling, or reviewing a GlassHome widget in this project, or when a widget should look like the official GlassHome widgets.
---

# GlassHome widgets

${pointer}

${START}
Written by the GlassHome widget CLI; it rewrites this file on \`bun widget upgrade\`. Delete this marker block to keep your own edits.
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
  const next =
    start !== -1 && end > start
      ? current.slice(0, start) + agentsBlock + current.slice(end + END.length)
      : `${current.trimEnd()}\n\n${agentsBlock}\n`;
  if (next === current) return "kept";
  writeFileSync(path, next);
  return "updated";
}

/** Point coding agents (Claude skill, AGENTS.md) at the guide the installed SDK ships. */
export function writeAgentStubs(projectDir: string): { skill: StubResult; agents: StubResult } {
  return { skill: writeSkill(projectDir), agents: writeAgents(projectDir) };
}
