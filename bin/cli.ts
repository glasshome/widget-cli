#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { intro, log, outro } from "@clack/prompts";

function resolveWidgetDir(): string {
  if (explicitDir) {
    const dir = resolve(process.cwd(), explicitDir);
    if (existsSync(resolve(dir, "src"))) return dir;
    log.error(`No src/ directory found in ${dir}`);
    process.exit(1);
  }
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "src"))) return cwd;
  const sibling = resolve(cwd, "../widgets");
  if (existsSync(resolve(sibling, "src"))) return sibling;
  return cwd;
}

const HELP = `
glasshome-widget <command> [--dir <path>] [options]

Commands:
  create                 Create a new widget project (default when no project found)
  add                    Add a new widget to the project
  build                  Build all widgets (per-widget, self-contained bundles)
  connect <url>          Connect to a running dashboard for live testing
  validate [name]        Validate all widgets or a specific one
  publish [hub-url]      Build and publish a widget to Hub
  login [hub-url]        Authenticate with GlassHome Hub
  info [name]            Show widget metadata and bundle info
  upgrade                Upgrade @glasshome/widget-sdk to latest version
  help                   Show this help message

Examples:
  glasshome-widget                              Create a new widget project
  glasshome-widget create                       Create a new widget project
  glasshome-widget add
  glasshome-widget build
  glasshome-widget connect http://localhost:3333
  glasshome-widget validate
  glasshome-widget validate clock
  glasshome-widget info
  glasshome-widget info clock
  glasshome-widget publish
  glasshome-widget publish --name light --bump patch
  glasshome-widget publish --name light --bump minor --scope glasshome
  glasshome-widget login
  glasshome-widget login https://my-hub.example.com
  glasshome-widget upgrade
  glasshome-widget publish --dir packages/widgets
`.trim();

import { parseArgs } from "node:util";

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    dir: { type: "string" },
    name: { type: "string" },
    bump: { type: "string" },
    scope: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

const explicitDir = flags.dir;
const [command, ...args] = positionals;

if (command === "help" || flags.help) {
  console.log(HELP);
  process.exit(0);
}

// No command: if inside a widget project show help, otherwise run create
const effectiveCommand = command ?? (existsSync(resolve(process.cwd(), "src")) ? "help" : "create");

if (effectiveCommand === "help") {
  console.log(HELP);
  process.exit(0);
}

intro(`glasshome-widget ${effectiveCommand}`);

switch (effectiveCommand) {
  case "create": {
    const { runCreate } = await import("../src/commands/create");
    await runCreate();
    outro("Happy building!");
    break;
  }

  case "add": {
    const { runAdd } = await import("../src/commands/add");
    await runAdd(resolveWidgetDir());
    outro("Done");
    break;
  }

  case "build": {
    const { runBuild } = await import("../src/commands/build");
    await runBuild(resolveWidgetDir());
    outro("Done");
    break;
  }

  case "connect": {
    const url = args[0];
    if (!url) {
      log.error("Missing required argument: <url>");
      log.info("Usage: glasshome-widget connect <dashboard-api-url>");
      process.exit(1);
    }
    const { runConnect } = await import("../src/commands/connect");
    await runConnect(url, resolveWidgetDir());
    break;
  }

  case "validate": {
    const widgetName = args[0];
    const { runValidate } = await import("../src/commands/validate");
    const passed = await runValidate(resolveWidgetDir(), widgetName);
    outro(passed ? "All checks passed" : "Validation failed");
    process.exit(passed ? 0 : 1);
    break;
  }

  case "login": {
    const loginHubUrl = args[0];
    const { runLogin } = await import("../src/commands/login");
    try {
      await runLogin(loginHubUrl);
      outro("Done");
    } catch (err) {
      log.error(err instanceof Error ? err.message : "Login failed.");
      process.exit(1);
    }
    break;
  }

  case "publish": {
    const hubUrlArg = args[0];
    const { runPublish } = await import("../src/commands/publish");
    await runPublish(resolveWidgetDir(), hubUrlArg, {
      name: flags.name,
      bump: flags.bump as "keep" | "patch" | "minor" | "major" | undefined,
      scope: flags.scope,
    });
    outro("Done");
    break;
  }

  case "info": {
    const widgetName = args[0];
    const { runInfo } = await import("../src/commands/info");
    await runInfo(resolveWidgetDir(), widgetName);
    outro("");
    break;
  }

  case "upgrade": {
    const { runUpgrade } = await import("../src/commands/upgrade");
    await runUpgrade(resolveWidgetDir());
    outro("Done");
    break;
  }

  default: {
    log.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
  }
}
