function errorHandler(error, req, res, _next) {
  const status = error.status || 500;
  const payload = {
    ok: false,
    code: error.code || "SERVER_ERROR",
    message: status >= 500 ? "Unexpected server error" : error.message,
    requestId: req.requestId
  };
  if (status < 500 && error.details) payload.details = error.details;
  if (status >= 500) console.error(JSON.stringify({ level: "error", requestId: req.requestId, message: error.message, stack: error.stack }));
  res.status(status).json(payload);
}

module.exports = { errorHandler };
