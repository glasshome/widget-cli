#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { intro, log, outro } from "@clack/prompts";

function resolveWidgetDir(): string {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "src"))) return cwd;
  const sibling = resolve(cwd, "../widgets");
  if (existsSync(resolve(sibling, "src"))) return sibling;
  return cwd;
}

const HELP = `
glasshome-widget <command> [options]

Commands:
  add                    Add a new widget to the project
  connect <url>          Connect to a running dashboard for live testing
  add-dev-registry [url] Add a local dev server as a widget registry
  validate [name]        Validate all widgets or a specific one
  publish                Build all widgets and publish to Hub
  login [hub-url]        Authenticate with GlassHome Hub
  info [name]            Show widget metadata and bundle info
  upgrade                Upgrade @glasshome/widget-sdk to latest version
  help                   Show this help message

Options for add-dev-registry:
  [url]              Registry URL (default: http://localhost:5173/__widgets/registry.json)
  --api-url <url>    Dashboard API URL (default: http://localhost:3333)

Examples:
  glasshome-widget add
  glasshome-widget connect http://localhost:3333
  glasshome-widget add-dev-registry
  glasshome-widget validate
  glasshome-widget validate clock
  glasshome-widget info
  glasshome-widget info clock
  glasshome-widget publish
  glasshome-widget login
  glasshome-widget login https://my-hub.example.com
  glasshome-widget upgrade
`.trim();

const [command, ...args] = process.argv.slice(2);

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

  case "add-dev-registry": {
    const registryUrl = args[0]?.startsWith("--") ? undefined : args[0];
    const apiUrlIdx = args.indexOf("--api-url");
    const apiUrl = apiUrlIdx >= 0 ? args[apiUrlIdx + 1] : undefined;
    const { runAddDevRegistry } = await import("../src/commands/dev-registry");
    await runAddDevRegistry({ registryUrl, apiUrl });
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
    await runLogin(loginHubUrl);
    outro("Done");
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
