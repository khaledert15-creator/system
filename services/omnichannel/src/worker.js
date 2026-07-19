const { buildContainer } = require("./app");
const { env, inspectRuntimeEnvironment } = require("./config/env");
const { disconnectPrisma } = require("./config/database");
const { log } = require("./utils/logger");

const runtimeInspection = inspectRuntimeEnvironment();
if (runtimeInspection.warnings.length) log("warn", "Runtime configuration needs attention", { warnings: runtimeInspection.warnings });

const container = buildContainer();
container.retryJob.start();
log("info", "Omnichannel retry worker started", { pollMs: env.retryPollMs });

async function shutdown(signal) {
  log("info", "Retry worker shutdown requested", { signal });
  container.retryJob.stop();
  await disconnectPrisma().catch(() => {});
  log("info", "Retry worker shutdown complete", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
