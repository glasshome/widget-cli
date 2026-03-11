import { log, outro, spinner } from "@clack/prompts";
import { trpcMutate, trpcQuery } from "../utils/api";

interface DevStatusResponse {
  devMode: boolean;
  registries: Array<{ url: string; name: string; isDefault: boolean }>;
}

export async function runAddDevRegistry(options: {
  registryUrl?: string;
  apiUrl?: string;
}): Promise<void> {
  const registryUrl = options.registryUrl || "http://localhost:5173/__widgets/registry.json";
  const apiUrl = options.apiUrl || "http://localhost:3333";

  const s = spinner();

  // Step 1: Check if dev mode is enabled
  s.start("Checking dev mode status...");
  let devEnabled = false;
  try {
    const status = await trpcQuery<DevStatusResponse>({
      apiUrl,
      path: "appConfig.get",
    });
    devEnabled = status.devMode;
  } catch (err) {
    s.stop("Failed to connect");
    log.error(
      `Could not reach dashboard API at ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
    log.info("Make sure the dashboard API server is running and the URL is correct.");
    process.exit(1);
  }

  // Step 2: Enable dev mode if needed
  if (!devEnabled) {
    s.message("Enabling dev mode...");
    try {
      const result = await trpcMutate<{ devMode: boolean }>({
        apiUrl,
        path: "appConfig.toggleDevMode",
        input: {},
      });
      if (!result.devMode) {
        s.stop("Failed");
        log.error("Could not enable dev mode");
        process.exit(1);
      }
    } catch (err) {
      s.stop("Failed");
      log.error(`Failed to enable dev mode: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  s.stop("Dev mode enabled");

  // Step 3: Add the registry via /dev/registries endpoint
  s.start("Adding dev registry...");
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/dev/registries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: registryUrl, name: "Local Dev Server" }),
    });

    if (res.status === 409) {
      s.stop("Registry already registered");
      log.info(`Registry ${registryUrl} is already configured`);
    } else if (res.ok) {
      s.stop("Registry added");
      log.success(`Added registry: ${registryUrl}`);
    } else {
      const err = (await res.json()) as { error: string };
      s.stop("Failed");
      log.error(`Failed to add registry: ${err.error}`);
      process.exit(1);
    }
  } catch (err) {
    s.stop("Failed");
    log.error(`Failed to add registry: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  outro("Done! Refresh your dashboard to see dev widgets.");
}
