#!/usr/bin/env bun
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cancel, confirm, intro, isCancel, log, outro, spinner, text } from "@clack/prompts";
import { promptWidgetDetails, scaffoldWidget } from "../src/commands/add";

const templateDir = resolve(import.meta.dir, "../template");

/** Walk up from cwd looking for a package.json with a `workspaces` field. */
function findMonorepoRoot(from: string): string | null {
  let dir = resolve(from);
  const root = (dir.match(/^[A-Za-z]:\\/) ?? ["/"])[0];
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir || parent === root) break;
    dir = parent;
  }
  return null;
}

/** Check if cwd is inside an existing git repository. */
function isInsideGitRepo(from: string): boolean {
  const result = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
    cwd: from,
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

intro("Create GlassHome Widget Project");

// ---- Project-level prompts ----

const projectName = await text({
  message: "Project name",
  placeholder: "my-widgets",
  defaultValue: "my-widgets",
  validate(value) {
    if (!value) return "Name is required";
    if (/\s/.test(value)) return "Name cannot contain spaces";
    if (!/^[a-z]/.test(value)) return "Name must start with a lowercase letter";
    if (!/^[a-z][a-z0-9-]*$/.test(value))
      return "Name must be lowercase alphanumeric with optional hyphens";
  },
});

if (isCancel(projectName)) {
  cancel("Operation cancelled.");
  process.exit(0);
}

const projectDescription = await text({
  message: "Project description (optional)",
  placeholder: "My GlassHome widget collection",
  defaultValue: "",
});

if (isCancel(projectDescription)) {
  cancel("Operation cancelled.");
  process.exit(0);
}

// ---- First widget prompts ----

log.info("Let's set up your first widget:");

const widgetDetails = await promptWidgetDetails();
if (!widgetDetails) process.exit(0);

const targetDir = resolve(process.cwd(), projectName as string);

if (existsSync(targetDir)) {
  cancel(`Directory "${projectName}" already exists.`);
  process.exit(1);
}

const s = spinner();
s.start("Scaffolding widget project...");

try {
  // Copy template to target
  cpSync(templateDir, targetDir, { recursive: true });

  // Strip .template suffixes (used to prevent IDE type-checking of template files)
  function processDir(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        processDir(fullPath);
        continue;
      }
      if (entry.endsWith(".template")) {
        renameSync(fullPath, join(dir, entry.replace(/\.template$/, "")));
      }
    }
  }
  processDir(targetDir);

  // Remove the template's src/index.tsx (it will be placed into a widget subdir)
  const oldSrcIndex = join(targetDir, "src/index.tsx");
  if (existsSync(oldSrcIndex)) {
    rmSync(oldSrcIndex);
  }

  const projectDesc =
    (projectDescription as string) || `A GlassHome widget project: ${projectName}`;

  // Replace project-level placeholders in package.json
  const pkgPath = join(targetDir, "package.json");
  let pkgContent = readFileSync(pkgPath, "utf-8");
  pkgContent = pkgContent.replace(/PROJECT_NAME/g, projectName as string);
  pkgContent = pkgContent.replace(/PROJECT_DESCRIPTION/g, projectDesc);
  writeFileSync(pkgPath, pkgContent);

  // Replace project-level placeholders in README.md
  const readmePath = join(targetDir, "README.md");
  let readmeContent = readFileSync(readmePath, "utf-8");
  readmeContent = readmeContent.replace(/PROJECT_NAME/g, projectName as string);
  readmeContent = readmeContent.replace(/PROJECT_DESCRIPTION/g, projectDesc);
  writeFileSync(readmePath, readmeContent);

  // Create the first widget in src/{widgetName}/
  scaffoldWidget(targetDir, widgetDetails);

  s.stop("Widget project created!");

  // Post-scaffold: auto-install
  const monorepoRoot = findMonorepoRoot(process.cwd());
  const installCwd = monorepoRoot ?? targetDir;
  const installHint = monorepoRoot ? " (from monorepo root)" : "";

  const shouldInstall = await confirm({
    message: `Install dependencies?${installHint}`,
    initialValue: true,
  });

  if (!isCancel(shouldInstall) && shouldInstall) {
    const installSpinner = spinner();
    installSpinner.start("Installing dependencies...");
    const installProc = Bun.spawnSync(["bun", "install"], { cwd: installCwd });
    if (installProc.exitCode === 0) {
      installSpinner.stop("Dependencies installed");
    } else {
      installSpinner.stop(
        monorepoRoot
          ? "Install failed — run `bun install` from the monorepo root"
          : "Install failed — you can run `bun install` manually",
      );
    }
  }

  // Post-scaffold: git init (skip when already inside a git repo)
  const inGitRepo = isInsideGitRepo(process.cwd());

  if (inGitRepo) {
    log.info("Skipping git init — already in a git repository");
  } else {
    const shouldGit = await confirm({
      message: "Initialize git repository?",
      initialValue: true,
    });

    if (!isCancel(shouldGit) && shouldGit) {
      const gitSpinner = spinner();
      gitSpinner.start("Initializing git repository...");
      const initProc = Bun.spawnSync(["git", "init"], { cwd: targetDir });
      if (initProc.exitCode === 0) {
        Bun.spawnSync(["git", "add", "-A"], { cwd: targetDir });
        Bun.spawnSync(["git", "commit", "-m", "Initial widget scaffold"], { cwd: targetDir });
        gitSpinner.stop("Git repository initialized");
      } else {
        gitSpinner.stop("Git init failed — you can run `git init` manually");
      }
    }
  }

  // Enhanced outro with next-steps guide
  log.info("");
  log.step("Next steps:");
  if (monorepoRoot) {
    log.info("  bun install              Run from monorepo root to link workspace packages");
    log.info(`  cd ${projectName}`);
  } else {
    log.info(`  cd ${projectName}`);
    if (isCancel(shouldInstall) || !shouldInstall) {
      log.info("  bun install");
    }
  }
  log.info("  bun widget connect <url>   Connect to a running dashboard for live testing");
  log.info("  bun widget add             Add another widget to the project");
  log.info("  bun run build              Build all widgets + generate registry.json");
  log.info("  bun widget validate        Validate all widgets");
  log.info("  bun widget publish         Build & publish to GlassHome Hub");
  log.info("  bun widget info            Show widget metadata");
  log.info("  bun widget upgrade         Upgrade @glasshome/widget-sdk");

  outro("Happy building!");
} catch (err) {
  s.stop("Failed to scaffold widget project.");
  // Rollback: remove partially created directory
  rmSync(targetDir, { recursive: true, force: true });
  cancel(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
