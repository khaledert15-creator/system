const crypto = require("crypto");

function id(prefix = "omni") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function clientMessageId() {
  return id("cmid");
}

function eventHash(payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHash("sha256").update(body).digest("hex");
}

module.exports = { id, clientMessageId, eventHash };
