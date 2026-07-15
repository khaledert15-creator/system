class AppError extends Error {
  constructor(message, status = 500, code = "APP_ERROR", details = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function notFound(message = "Not found") {
  return new AppError(message, 404, "NOT_FOUND");
}

function conflict(message = "Conflict", details = {}) {
  return new AppError(message, 409, "CONFLICT", details);
}

function forbidden(message = "Forbidden") {
  return new AppError(message, 403, "FORBIDDEN");
}

function badRequest(message = "Bad request", details = {}) {
  return new AppError(message, 400, "BAD_REQUEST", details);
}

module.exports = { AppError, notFound, conflict, forbidden, badRequest };
