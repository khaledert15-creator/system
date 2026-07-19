const { env, publicConfig, inspectRuntimeEnvironment } = require("../config/env");

function accountMode(account = {}) {
  const status = `${account.status || ""} ${account.connectionStatus || ""}`;
  const credentialMode = account.configuration?.credentialMode || account.configuration?.connectionMode || "";
  if (status.includes("mock") || credentialMode === "mock") return "mock";
  if (account.status === "connected" || account.connectionStatus === "connected" || credentialMode === "real") return "real";
  return "configured";
}

async function readiness(container) {
  const checks = {};
  const errors = [];
  const warnings = [];
  try {
    if (container.repository.db?.$queryRaw) await container.repository.db.$queryRaw`SELECT 1`;
    else await container.repository.channels();
    checks.database = "ok";
  } catch (error) {
    checks.database = "error";
    errors.push("PostgreSQL is not reachable");
  }

  const config = inspectRuntimeEnvironment();
  checks.runtimeConfig = config.warnings.length ? "warning" : "ok";
  warnings.push(...config.warnings);

  try {
    const accounts = await container.repository.channelAccounts();
    const activeAccounts = accounts.filter(account => account.isActive !== false);
    const unsafeMock = activeAccounts.filter(account => accountMode(account) === "mock");
    if (!env.allowMockEndpoints && unsafeMock.length) {
      warnings.push(`Mock channel accounts are inactive because mock endpoints are disabled: ${unsafeMock.map(item => item.id).join(",")}`);
    }
    for (const account of activeAccounts.filter(account => accountMode(account) === "real")) {
      const hasToken = Boolean(await container.repository.channelAccountCredential(account.id, "access_token"));
      const hasIdentifier = account.channel?.key === "whatsapp" ? Boolean(account.phoneNumberId) : Boolean(account.pageId);
      if (!hasToken || !hasIdentifier) errors.push(`Real channel account ${account.id} is missing ${!hasToken ? "access_token" : "identifier"}`);
    }
    checks.channelAccounts = "ok";
  } catch (error) {
    checks.channelAccounts = "error";
    errors.push("Channel account readiness check failed");
  }

  return {
    ok: errors.length === 0,
    checks,
    errors,
    warnings,
    config: publicConfig()
  };
}

module.exports = { readiness };
