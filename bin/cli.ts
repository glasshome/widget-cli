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
  add                    Add a new widget to the project
  build                  Build all widgets (per-widget, self-contained bundles)
  connect <url>          Connect to a running dashboard for live testing
  validate [name]        Validate all widgets or a specific one
  publish                Build all widgets and publish to Hub
  login [hub-url]        Authenticate with GlassHome Hub
  info [name]            Show widget metadata and bundle info
  upgrade                Upgrade @glasshome/widget-sdk to latest version
  help                   Show this help message

Examples:
  glasshome-widget add
  glasshome-widget build
  glasshome-widget connect http://localhost:3333
  glasshome-widget validate
  glasshome-widget validate clock
  glasshome-widget info
  glasshome-widget info clock
  glasshome-widget publish
  glasshome-widget login
  glasshome-widget login https://my-hub.example.com
  glasshome-widget upgrade
  glasshome-widget publish --dir packages/widgets
`.trim();

const rawArgs = process.argv.slice(2);
const dirFlagIdx = rawArgs.indexOf("--dir");
let explicitDir: string | undefined;
if (dirFlagIdx !== -1) {
  explicitDir = rawArgs[dirFlagIdx + 1];
  rawArgs.splice(dirFlagIdx, 2);
}
const [command, ...args] = rawArgs;

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(0);
}

intro(`glasshome-widget ${command}`);

switch (command) {
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
    const { runPublish } = await import("../src/commands/publish");
    await runPublish(resolveWidgetDir());
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
