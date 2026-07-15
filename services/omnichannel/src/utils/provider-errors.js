function classifyProviderError(error = {}) {
  const message = String(error.message || error || "").toLowerCase();
  const code = error.code || error.status || error.statusCode || "";
  const retryable = (
    error.retryable === true ||
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("rate limit") ||
    message.includes("unavailable") ||
    String(code).startsWith("5") ||
    String(code) === "429"
  );
  const permanent = (
    error.permanent === true ||
    message.includes("invalid recipient") ||
    message.includes("invalid credentials") ||
    message.includes("unsupported") ||
    message.includes("permission denied") ||
    message.includes("invalid template") ||
    String(code).startsWith("4") && String(code) !== "429"
  );
  return {
    retryable: retryable && !permanent,
    permanent: permanent || !retryable,
    code: String(code || (retryable ? "RETRYABLE" : "PERMANENT"))
  };
}

module.exports = { classifyProviderError };
