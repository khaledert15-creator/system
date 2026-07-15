const crypto = require("crypto");
const { env } = require("../config/env");

function sign(payload) {
  return crypto.createHmac("sha256", env.sessionBridgeSecret).update(payload).digest("base64url");
}

function createSseTicket(user) {
  const body = Buffer.from(JSON.stringify({
    sub: user.id,
    username: user.username,
    exp: Date.now() + env.sseTicketTtlMs
  })).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifySseTicket(ticket) {
  if (!ticket || typeof ticket !== "string" || !ticket.includes(".")) return null;
  const [body, signature] = ticket.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  if (Buffer.byteLength(expected) !== Buffer.byteLength(signature)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

module.exports = { createSseTicket, verifySseTicket };
