const { createApp } = require("./app");
const { env, validateProductionEnvironment } = require("./config/env");
const { disconnectPrisma } = require("./config/database");
const { log } = require("./utils/logger");

const productionValidation = validateProductionEnvironment();
if (!productionValidation.ok) {
  log("error", "Invalid production configuration", { errors: productionValidation.errors });
  process.exit(1);
}

const { buildContainer } = require("./app");
const container = buildContainer();
const app = createApp(container);
const server = app.listen(env.port, () => {
  log("info", "Omnichannel HTTP service started", { port: env.port, integratedWorker: env.startRetryWorker });
  if (env.startRetryWorker) container.retryJob.start();
});

async function shutdown(signal) {
  log("info", "Graceful shutdown requested", { signal });
  const timeout = setTimeout(() => {
    log("error", "Graceful shutdown timed out", { signal });
    process.exit(1);
  }, env.shutdownTimeoutMs);
  server.close(async () => {
    container.retryJob.stop();
    await disconnectPrisma().catch(() => {});
    clearTimeout(timeout);
    log("info", "Graceful shutdown complete", { signal });
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
