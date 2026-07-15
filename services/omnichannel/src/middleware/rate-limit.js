const { env } = require("../config/env");

const buckets = new Map();

function makeRateLimit({ name = "global", max = env.rateLimitMax, windowMs = env.rateLimitWindowMs } = {}) {
  return function rateLimit(req, res, next) {
    const key = `${name}:${req.ip || req.socket.remoteAddress || "local"}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { resetAt: now + windowMs, count: 0 };
    if (bucket.resetAt <= now) {
      bucket.resetAt = now + windowMs;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) return res.status(429).json({ ok: false, code: "RATE_LIMITED", message: "Too many requests", requestId: req.requestId });
    next();
  };
}

function rateLimit(req, res, next) {
  return makeRateLimit()(req, res, next);
}

function clearRateLimitBuckets() {
  buckets.clear();
}

module.exports = {
  rateLimit,
  makeRateLimit,
  clearRateLimitBuckets,
  webhooksRateLimit: makeRateLimit({ name: "webhook", max: env.webhookRateLimitMax }),
  sendRateLimit: makeRateLimit({ name: "send", max: env.sendRateLimitMax }),
  uploadRateLimit: makeRateLimit({ name: "upload", max: env.uploadRateLimitMax })
};
