const crypto = require("crypto");
const { env } = require("../config/env");

const CHANNEL_ADMIN_PERMISSIONS = [
  "omnichannel.channels.view",
  "omnichannel.channels.create",
  "omnichannel.channels.update",
  "omnichannel.channels.delete",
  "omnichannel.channels.activate",
  "omnichannel.channels.test"
];

const SAVED_REPLY_PERMISSIONS = [
  "omnichannel.saved_replies.view",
  "omnichannel.saved_replies.create_personal",
  "omnichannel.saved_replies.create_team",
  "omnichannel.saved_replies.create_global",
  "omnichannel.saved_replies.update",
  "omnichannel.saved_replies.delete"
];

const ROLE_ACTIONS = {
  "مالك": ["omni:view", "omni:send", "omni:assign", "omni:admin", "omni:mock", ...CHANNEL_ADMIN_PERMISSIONS],
  "مدير": ["omni:view", "omni:send", "omni:assign", "omni:admin", "omni:mock", ...CHANNEL_ADMIN_PERMISSIONS],
  "محاسب": ["omni:view"],
  "كاشير": ["omni:view", "omni:send", "omni:assign"],
  "مخزن": ["omni:view"],
  "شحن": ["omni:view", "omni:send", "omni:assign"],
  // Backward-compatible role strings from older mojibake data.
  "ظ…ط§ظ„ظƒ": ["omni:view", "omni:send", "omni:assign", "omni:admin", "omni:mock", ...CHANNEL_ADMIN_PERMISSIONS],
  "ظ…ط¯ظٹط±": ["omni:view", "omni:send", "omni:assign", "omni:admin", "omni:mock", ...CHANNEL_ADMIN_PERMISSIONS],
  "ظ…ط­ط§ط³ط¨": ["omni:view"],
  "ظƒط§ط´ظٹط±": ["omni:view", "omni:send", "omni:assign"],
  "ظ…ط®ط²ظ†": ["omni:view"],
  "ط´ط­ظ†": ["omni:view", "omni:send", "omni:assign"]
};

function permissionsForUser(sessionUser = {}) {
  const base = ROLE_ACTIONS[sessionUser.role] || ["omni:view"];
  const adminUsernames = new Set(["owner", "manager"]);
  if (adminUsernames.has(sessionUser.username || sessionUser.id)) {
    return [...new Set([...base, "omni:view", "omni:send", "omni:assign", "omni:admin", "omni:mock", ...CHANNEL_ADMIN_PERMISSIONS, ...SAVED_REPLY_PERMISSIONS])];
  }
  const effective = [...base];
  if (effective.includes("omni:admin")) effective.push(...SAVED_REPLY_PERMISSIONS);
  if (effective.includes("omni:send")) effective.push("omnichannel.saved_replies.view", "omnichannel.saved_replies.create_personal");
  if (effective.includes("omni:view")) effective.push("omnichannel.saved_replies.view");
  return [...new Set(effective)];
}

function verifyBridgeUser(header, signature) {
  if (!header || !signature || !env.sessionBridgeSecret) return null;
  const expected = crypto.createHmac("sha256", env.sessionBridgeSecret).update(header).digest("hex");
  if (Buffer.byteLength(expected) !== Buffer.byteLength(String(signature))) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))) return null;
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

async function fetchExistingSession(token) {
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.sessionBridgeTimeoutMs);
  const response = await fetch(`${env.existingAppBaseUrl.replace(/\/$/, "")}/api/session`, {
    headers: { "X-Session-Token": token },
    signal: controller.signal
  }).catch(() => null);
  clearTimeout(timer);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.user || null;
}

async function auth(req, res, next) {
  try {
    const bridgeUser = verifyBridgeUser(req.headers["x-omni-user"], req.headers["x-omni-signature"]);
    const queryToken = env.allowQuerySessionToken ? req.query.token : null;
    const sessionUser = bridgeUser || await fetchExistingSession(req.headers["x-session-token"] || queryToken);
    if (!sessionUser) return res.status(401).json({ ok: false, message: "Authentication required." });
    req.user = {
      id: sessionUser.id || sessionUser.username,
      username: sessionUser.username || sessionUser.id,
      name: sessionUser.name || sessionUser.username || "Agent",
      role: sessionUser.role || "",
      permissions: permissionsForUser(sessionUser)
    };
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { auth, ROLE_ACTIONS, CHANNEL_ADMIN_PERMISSIONS, SAVED_REPLY_PERMISSIONS, permissionsForUser };
