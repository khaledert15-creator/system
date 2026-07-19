const { env } = require("../config/env");

function requireHttps(req, res, next) {
  if (!env.forceHttps) return next();
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  if (String(proto).split(",")[0].trim() === "https") return next();
  if (["GET", "HEAD"].includes(req.method)) {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  return res.status(400).json({ ok: false, code: "HTTPS_REQUIRED", message: "HTTPS is required", requestId: req.requestId });
}

function blockMockInProduction(req, res, next) {
  if (env.allowMockEndpoints) return next();
  return res.status(403).json({ ok: false, code: "MOCK_DISABLED", message: "Mock endpoints are disabled", requestId: req.requestId });
}

module.exports = { requireHttps, blockMockInProduction };
