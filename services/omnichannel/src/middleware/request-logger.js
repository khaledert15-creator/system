const { log } = require("../utils/logger");

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    log(res.statusCode >= 500 ? "error" : "info", "http_request", {
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      userId: req.user?.id,
      conversationId: req.params?.conversationId || req.params?.id,
      channelAccountId: req.body?.channelAccountId
    });
  });
  next();
}

module.exports = { requestLogger };
