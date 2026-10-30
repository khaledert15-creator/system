"use strict";

// Service-to-service authentication shared with the Store (INTEGRATION_DOCS/INTEGRATION_API_SPEC.md §1).
// Both sides must produce byte-identical signatures:
//   canonical = timestamp \n nonce \n METHOD \n pathWithQuery \n sha256_hex(rawBody or "")
//   X-Maktabaa-Signature = "v1=" + hex(HMAC_SHA256(secret, canonical))
const crypto = require("crypto");

const SIGNATURE_MAX_SKEW_SECONDS = 300;
const NONCE_TTL_MS = 600 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_ID_PATTERN = /^[a-z0-9-]{3,40}$/;
const SECRET_MIN_LENGTH = 32;
const DEFAULT_CHATWOOD_ORIGIN = "https://chat.maktabaa.com";

function sha256Hex(body = "") {
  return crypto.createHash("sha256").update(body ?? "").digest("hex");
}

function integrationSignature({ secret, timestamp, nonce, method, pathWithQuery, body = "" }) {
  const canonical = [String(timestamp), String(nonce), String(method || "").toUpperCase(), String(pathWithQuery), sha256Hex(body ?? "")].join("\n");
  return `v1=${crypto.createHmac("sha256", String(secret)).update(canonical).digest("hex")}`;
}

function signedHeaders({ secret, keyId, method, pathWithQuery, body = "", now = Date.now(), nonce }) {
  if (!secret) throw Object.assign(new Error("INTEGRATION_SHARED_SECRET is not configured"), { code:"INTEGRATION_DISABLED" });
  const timestamp = String(Math.floor(now / 1000));
  const value = nonce || crypto.randomBytes(18).toString("base64url");
  return {
    "X-Maktabaa-Key-Id": keyId,
    "X-Maktabaa-Timestamp": timestamp,
    "X-Maktabaa-Nonce": value,
    "X-Maktabaa-Signature": integrationSignature({ secret, timestamp, nonce:value, method, pathWithQuery, body })
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Single System process: an in-memory nonce window is enough (sessions live in memory too).
function createNonceCache({ ttlMs = NONCE_TTL_MS, sweepAbove = 5000 } = {}) {
  const seen = new Map();
  return {
    remember(nonce, now = Date.now()) {
      if (seen.size > sweepAbove) for (const [key, expiresAt] of seen) if (expiresAt <= now) seen.delete(key);
      const expiresAt = seen.get(nonce);
      if (expiresAt && expiresAt > now) return false;
      seen.set(nonce, now + ttlMs);
      return true;
    },
    size: () => seen.size
  };
}

// Returns { ok:true, keyId } or { ok:false, reason } — reasons are for logs only, never for the response body.
function verifyRequest({ headers = {}, method, pathWithQuery, body = "", secrets = [], acceptedKeyIds = [], nonceCache, now = Date.now() }) {
  const header = name => { const value = headers[name]; return Array.isArray(value) ? undefined : value; };
  const keyId = header("x-maktabaa-key-id"), timestamp = header("x-maktabaa-timestamp");
  const nonce = header("x-maktabaa-nonce"), signature = header("x-maktabaa-signature");
  const usable = secrets.filter(Boolean);
  if (!usable.length) return { ok:false, reason:"not_configured" };
  if (!keyId || !acceptedKeyIds.includes(keyId)) return { ok:false, reason:"unknown_key" };
  if (!timestamp || !/^\d{9,12}$/.test(timestamp) || !nonce || !NONCE_PATTERN.test(nonce) || !signature || !/^v1=[0-9a-f]{64}$/.test(signature)) return { ok:false, reason:"malformed" };
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SECONDS) return { ok:false, reason:"stale" };
  // Every configured secret is compared (no early exit) so timing does not reveal which one matched.
  let valid = false;
  for (const secret of usable) if (safeEqual(signature, integrationSignature({ secret, timestamp, nonce, method, pathWithQuery, body }))) valid = true;
  if (!valid) return { ok:false, reason:"bad_signature" };
  if (nonceCache && !nonceCache.remember(nonce, now)) return { ok:false, reason:"replayed" };
  return { ok:true, keyId };
}

function validOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) && url.origin === String(value) ? url.origin : "";
  } catch { return ""; }
}

// All settings are optional. Without a usable shared secret the integration is disabled and its endpoints answer
// 503 INTEGRATION_DISABLED. Secret values are never logged or returned.
function configFromEnv(env = process.env, logger = () => {}) {
  const secret = String(env.INTEGRATION_SHARED_SECRET || "");
  const previous = String(env.INTEGRATION_SHARED_SECRET_PREVIOUS || "");
  const secrets = [];
  if (secret && secret.length >= SECRET_MIN_LENGTH) secrets.push(secret);
  else if (secret) logger({ operationType:"INTEGRATION_CONFIG_INVALID", setting:"INTEGRATION_SHARED_SECRET", message:`shorter than ${SECRET_MIN_LENGTH} characters; integration disabled` });
  if (secrets.length && previous && previous.length >= SECRET_MIN_LENGTH && previous !== secret) secrets.push(previous);
  else if (previous && previous.length < SECRET_MIN_LENGTH) logger({ operationType:"INTEGRATION_CONFIG_INVALID", setting:"INTEGRATION_SHARED_SECRET_PREVIOUS", message:`shorter than ${SECRET_MIN_LENGTH} characters; ignored` });
  const keyId = KEY_ID_PATTERN.test(String(env.INTEGRATION_KEY_ID || "")) ? String(env.INTEGRATION_KEY_ID) : "system-v1";
  const peerKeyId = KEY_ID_PATTERN.test(String(env.INTEGRATION_PEER_KEY_ID || "")) ? String(env.INTEGRATION_PEER_KEY_ID) : "store-v1";
  let storeBaseUrl = "";
  if (env.STORE_INTEGRATION_BASE_URL) {
    try {
      // Origin only: signed paths are always the full /api/integration/v1/... path the Store verifies.
      const url = new URL(String(env.STORE_INTEGRATION_BASE_URL));
      if (["http:", "https:"].includes(url.protocol)) storeBaseUrl = url.origin;
    } catch {}
    if (!storeBaseUrl) logger({ operationType:"INTEGRATION_CONFIG_INVALID", setting:"STORE_INTEGRATION_BASE_URL", message:"not a valid http(s) URL; Store calls disabled" });
  }
  const chatwoodOrigin = validOrigin(env.CHATWOOD_ORIGIN || DEFAULT_CHATWOOD_ORIGIN) || DEFAULT_CHATWOOD_ORIGIN;
  if (env.CHATWOOD_ORIGIN && chatwoodOrigin !== env.CHATWOOD_ORIGIN) logger({ operationType:"INTEGRATION_CONFIG_INVALID", setting:"CHATWOOD_ORIGIN", message:`not an origin; using ${DEFAULT_CHATWOOD_ORIGIN}` });
  const storeAdminOrderUrl = String(env.STORE_ADMIN_ORDER_URL_BASE || "https://store.maktabaa.com/admin/orders/");
  // Chatwood API access of the System itself (an access token of a Chatwood user), used to name contacts after booked
  // orders. Off until both the token and the account id are set.
  const chatwoodApiUrl = validOrigin(env.CHATWOOD_API_URL || chatwoodOrigin) || chatwoodOrigin;
  const chatwoodAccountId = /^\d{1,9}$/.test(String(env.CHATWOOD_ACCOUNT_ID || "")) ? String(env.CHATWOOD_ACCOUNT_ID) : "";
  const chatwoodApiToken = String(env.CHATWOOD_API_TOKEN || "").trim();
  return {
    enabled: secrets.length > 0,
    secrets,
    signingSecret: secrets[0] || "",
    keyId,
    peerKeyId,
    storeBaseUrl,
    storeEnabled: secrets.length > 0 && Boolean(storeBaseUrl),
    storeTimeoutMs: Math.min(30000, Math.max(1000, Number(env.STORE_INTEGRATION_TIMEOUT_MS) || 8000)),
    storeNotifyTimeoutMs: Math.min(15000, Math.max(500, Number(env.STORE_INTEGRATION_NOTIFY_TIMEOUT_MS) || 3000)),
    chatwoodOrigin,
    chatwoodApiUrl,
    chatwoodAccountId,
    chatwoodApiToken,
    chatwoodContactsEnabled: Boolean(chatwoodApiToken && chatwoodAccountId),
    chatwoodTimeoutMs: Math.min(15000, Math.max(500, Number(env.CHATWOOD_API_TIMEOUT_MS) || 5000)),
    storeAdminOrderUrl: /^https?:\/\//.test(storeAdminOrderUrl) ? storeAdminOrderUrl : "https://store.maktabaa.com/admin/orders/"
  };
}

module.exports = {
  SIGNATURE_MAX_SKEW_SECONDS, NONCE_TTL_MS, NONCE_PATTERN, SECRET_MIN_LENGTH, DEFAULT_CHATWOOD_ORIGIN,
  sha256Hex, integrationSignature, signedHeaders, createNonceCache, verifyRequest, configFromEnv, validOrigin
};
