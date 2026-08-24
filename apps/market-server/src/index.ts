import { loadConfig, ConfigError } from "./config/env.js";
import { createMarketServer } from "./app.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Safe message: names the missing variable, never its value.
      console.error(`[market-server] configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const server = await createMarketServer(config);
  try {
    await server.start();
  } catch (err) {
    console.error(
      `[market-server] failed to start: ${err instanceof Error ? err.message : "unknown error"}`
    );
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[market-server] ${signal} received — shutting down gracefully`);
    void (async () => {
      try {
        await server.stop();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((err) => {
  console.error(
    `[market-server] fatal startup error: ${err instanceof Error ? err.message : "unknown"}`
  );
  process.exit(1);
});
