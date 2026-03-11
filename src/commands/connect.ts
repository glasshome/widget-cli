import { existsSync, readdirSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { log, spinner } from "@clack/prompts";

function getLanIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      // Skip internal and non-IPv4 addresses
      if (!net.internal && net.family === "IPv4") {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

export async function runConnect(apiUrl: string, cwd: string): Promise<void> {
  const distDir = resolve(cwd, "dist");

  // Step 1: Initial build (generates dist/*.js + dist/registry.json)
  const s = spinner();
  s.start("Building widgets...");
  const buildProc = Bun.spawnSync(["bun", "run", "build"], { cwd });
  if (buildProc.exitCode !== 0) {
    s.stop("Build failed");
    log.error(buildProc.stderr.toString());
    process.exit(1);
  }
  s.stop("Build complete");

  // Step 2: Check registry was generated
  const registryPath = resolve(distDir, "registry.json");
  if (!existsSync(registryPath)) {
    log.error("dist/registry.json not found after build. Check your vite.config.ts.");
    process.exit(1);
  }

  // Step 3: Start local HTTP server serving entire dist/ directory
  const lanIp = getLanIp();
  const server = Bun.serve({
    port: 0, // let OS pick a free port
    fetch(req) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Serve any file from dist/
      const pathname = url.pathname === "/" ? "/registry.json" : url.pathname;
      const filePath = join(distDir, pathname.slice(1));

      // Prevent directory traversal
      if (!filePath.startsWith(distDir)) {
        return new Response("Forbidden", { status: 403 });
      }

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const file = Bun.file(filePath);
        const contentType = filePath.endsWith(".js")
          ? "application/javascript"
          : filePath.endsWith(".json")
            ? "application/json"
            : "application/octet-stream";

        return new Response(file, {
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Cache-Control": "no-cache",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  const registryUrl = `http://${lanIp}:${server.port}/registry.json`;
  log.info(`Serving dist/ at http://${lanIp}:${server.port}/`);
  log.info(`Registry URL: ${registryUrl}`);

  // Step 4: Enable dev mode + register registry URL with dashboard API
  s.start("Registering registry with dashboard...");
  try {
    // Check/enable dev mode
    const configRes = await fetch(`${apiUrl.replace(/\/$/, "")}/trpc/appConfig.get`);
    if (configRes.ok) {
      const configData = (await configRes.json()) as { result: { data: { devMode: boolean } } };
      if (!configData.result.data.devMode) {
        await fetch(`${apiUrl.replace(/\/$/, "")}/trpc/appConfig.toggleDevMode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }
    }

    // Register the registry
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/dev/registries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: registryUrl, name: "Local Dev Server" }),
    });

    if (res.ok || res.status === 409) {
      s.stop("Registry registered");
    } else {
      const err = (await res.json()) as { error: string };
      s.stop("Registration failed");
      log.error(`Failed to register registry: ${err.error}`);
      server.stop();
      process.exit(1);
    }
  } catch (err) {
    s.stop("Registration failed");
    log.error(`Failed to register: ${err instanceof Error ? err.message : String(err)}`);
    server.stop();
    process.exit(1);
  }

  // Step 5: Start vite build --watch for auto-rebuild
  const watchProc = Bun.spawn(["bunx", "vite", "build", "--watch"], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });

  // Count widgets
  const widgetCount = existsSync(resolve(cwd, "src"))
    ? readdirSync(resolve(cwd, "src")).filter(
        (d) =>
          statSync(resolve(cwd, "src", d)).isDirectory() &&
          existsSync(resolve(cwd, "src", d, "manifest.json")),
      ).length
    : 0;

  log.success(`Connected! ${widgetCount} widget(s) are live.`);
  log.info("Dashboard will discover widgets via registry.json.");
  log.info("File changes auto-rebuild. Add widgets with `bun widget add`.");
  log.info("Press Ctrl+C to disconnect.");

  // Step 6: Handle SIGINT — unregister and clean up
  const cleanup = async () => {
    log.info("\nDisconnecting...");
    try {
      await fetch(`${apiUrl.replace(/\/$/, "")}/dev/registries`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: registryUrl }),
      });
      log.info("Registry unregistered");
    } catch {
      log.warn("Could not unregister registry (API may be down)");
    }
    watchProc.kill();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}
