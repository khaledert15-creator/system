const { env } = require("../config/env");

function corsOptions(req, callback) {
  const origin = req.header("Origin");
  if (!origin) return callback(null, { origin: false, credentials: true });
  const allowed = env.allowedOrigins.includes(origin);
  if (allowed) return callback(null, { origin, credentials: true });
  return callback(null, { origin: false, credentials: true });
}

module.exports = { corsOptions };
