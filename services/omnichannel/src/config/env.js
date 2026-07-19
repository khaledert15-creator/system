const fs = require("fs");
const path = require("path");

function loadDotEnv(file = path.join(__dirname, "..", "..", "..", ".env")) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name, fallback = []) {
  const explicit = process.env[name] !== undefined;
  const values = String(process.env[name] || "").split(",").map(item => item.trim()).filter(Boolean);
  return (explicit ? values : values.concat(fallback)).filter((item, index, arr) => arr.indexOf(item) === index);
}

function boolEnv(name, fallback = false) {
  if (process.env[name] === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(process.env[name]).toLowerCase());
}

function isWeakSecret(value, defaults = []) {
  return !value || defaults.includes(value) || String(value).length < 24;
}

function isLocalUrl(value = "") {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(String(value));
}

const env = {
  runtimeName: "default",
  port: numberEnv("OMNICHANNEL_PORT", 8775),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8775",
  omnichannelPublicUrl: process.env.OMNICHANNEL_PUBLIC_URL || process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8775",
  databaseUrl: process.env.DATABASE_URL || "",
  existingAppBaseUrl: process.env.EXISTING_APP_BASE_URL || "http://127.0.0.1:8765",
  existingAppDatabasePath: path.resolve(__dirname, "..", "..", process.env.EXISTING_APP_DATABASE_PATH || "../../data/database.json"),
  sessionBridgeSecret: process.env.SESSION_BRIDGE_SECRET || "dev-session-bridge-secret",
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v20.0",
  metaAppSecret: process.env.META_APP_SECRET || "",
  metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "change-this-verify-token",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  whatsappTestPhoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  messengerPageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN || "",
  messengerPageId: process.env.MESSENGER_PAGE_ID || "",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  logLevel: process.env.LOG_LEVEL || "info",
  allowedOrigins: listEnv("ALLOWED_ORIGINS", ["http://127.0.0.1:8765", "http://127.0.0.1:8775"]),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "12mb",
  uploadRoot: process.env.OMNI_UPLOAD_ROOT || path.resolve(__dirname, "..", "..", "storage", "uploads"),
  uploadMaxBytes: numberEnv("OMNI_UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
  storageProvider: process.env.STORAGE_DRIVER || process.env.OMNI_STORAGE_PROVIDER || "local",
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Bucket: process.env.S3_BUCKET || "",
  s3Region: process.env.S3_REGION || "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  whatsappServiceWindowHours: numberEnv("WHATSAPP_SERVICE_WINDOW_HOURS", 24),
  retryPollMs: numberEnv("OMNI_RETRY_POLL_MS", 10000),
  retryMaxAttempts: numberEnv("OMNI_RETRY_MAX_ATTEMPTS", 3),
  startRetryWorker: boolEnv("OMNI_START_RETRY_WORKER", true),
  rateLimitWindowMs: numberEnv("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitMax: numberEnv("RATE_LIMIT_MAX", 300),
  webhookRateLimitMax: numberEnv("WEBHOOK_RATE_LIMIT_MAX", 2000),
  sendRateLimitMax: numberEnv("SEND_RATE_LIMIT_MAX", 120),
  uploadRateLimitMax: numberEnv("UPLOAD_RATE_LIMIT_MAX", 60),
  trustProxy: process.env.TRUST_PROXY || "1",
  forceHttps: boolEnv("FORCE_HTTPS", false),
  enableHsts: boolEnv("ENABLE_HSTS", false),
  verifyWebhookSignatures: boolEnv("VERIFY_WEBHOOK_SIGNATURES", true),
  allowMockEndpoints: boolEnv("ALLOW_MOCK_ENDPOINTS", false),
  allowQuerySessionToken: boolEnv("ALLOW_QUERY_SESSION_TOKEN", false),
  sessionBridgeTimeoutMs: numberEnv("SESSION_BRIDGE_TIMEOUT_MS", 5000),
  sseTicketTtlMs: numberEnv("SSE_TICKET_TTL_MS", 60 * 1000),
  shutdownTimeoutMs: numberEnv("SHUTDOWN_TIMEOUT_MS", 15000)
};

function publicConfig() {
  return {
    runtimeName: env.runtimeName,
    publicBaseUrl: env.publicBaseUrl,
    omnichannelPublicUrl: env.omnichannelPublicUrl,
    existingAppBaseUrl: env.existingAppBaseUrl,
    metaGraphApiVersion: env.metaGraphApiVersion,
    hasDatabaseUrl: Boolean(env.databaseUrl),
    hasMetaAppSecret: Boolean(env.metaAppSecret),
    hasWhatsappAccessToken: Boolean(env.whatsappAccessToken),
    hasMessengerPageAccessToken: Boolean(env.messengerPageAccessToken),
    storageProvider: env.storageProvider,
    workerIntegrated: env.startRetryWorker
  };
}

function inspectRuntimeEnvironment() {
  const warnings = [];
  if (!env.databaseUrl) warnings.push("DATABASE_URL is not configured");
  if (!env.publicBaseUrl || isLocalUrl(env.publicBaseUrl)) warnings.push("PUBLIC_BASE_URL is local; external webhooks need a public HTTPS URL");
  if (!env.omnichannelPublicUrl || isLocalUrl(env.omnichannelPublicUrl)) warnings.push("OMNICHANNEL_PUBLIC_URL is local; external webhooks need a public URL");
  if (!env.existingAppBaseUrl) warnings.push("EXISTING_APP_BASE_URL is not configured");
  if (!env.allowedOrigins.length || env.allowedOrigins.includes("*")) warnings.push("ALLOWED_ORIGINS must contain explicit origins");
  if (isWeakSecret(env.metaWebhookVerifyToken, ["change-this-verify-token"])) warnings.push("META_WEBHOOK_VERIFY_TOKEN should be changed");
  if (isWeakSecret(env.sessionBridgeSecret, ["dev-session-bridge-secret", "change-this-long-random-secret"])) warnings.push("SESSION_BRIDGE_SECRET should be changed");
  if (isWeakSecret(env.encryptionKey)) warnings.push("ENCRYPTION_KEY should be configured");
  if (env.storageProvider === "s3" && (!env.s3Bucket || !env.s3Region || !env.s3AccessKeyId || !env.s3SecretAccessKey)) warnings.push("S3 storage requires bucket, region and credentials");
  return { ok: true, warnings };
}

module.exports = { env, publicConfig, loadDotEnv, inspectRuntimeEnvironment };
