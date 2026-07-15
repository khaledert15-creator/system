const SENSITIVE_KEYS = /token|secret|password|authorization|credential|encryption/i;

function redact(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(item)
  ]));
}

function log(level, message, context = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: "omnichannel",
    message,
    ...redact(context)
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

module.exports = { log, redact };
