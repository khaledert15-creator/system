(function (root, factory) {
  const api = factory(typeof require === "function" ? require("crypto") : root.crypto);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AuditIds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (cryptoApi) {
  "use strict";

  const MAX_GENERATION_ATTEMPTS = 5;

  function secureUuid() {
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues !== "function") {
      throw Object.assign(new Error("Secure randomness is unavailable for audit ID generation."), { code:"AUDIT_ID_RANDOM_UNAVAILABLE" });
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function generateAuditId() {
    return `AUD-${secureUuid()}`;
  }

  function assignUniqueAuditId(records = [], record = {}, options = {}) {
    const generate = options.generate || generateAuditId;
    const attempts = Math.min(MAX_GENERATION_ATTEMPTS, Math.max(1, Number(options.maxAttempts || MAX_GENERATION_ATTEMPTS)));
    const existing = new Set(records.map(row => String(row?.id || "")).filter(Boolean));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = String(generate());
      if (!candidate.startsWith("AUD-") || /^AUD-\d+(?:\.\d+)?e[+-]\d+$/i.test(candidate)) continue;
      if (!existing.has(candidate)) return { ...record, id:candidate };
    }
    throw Object.assign(new Error("Could not allocate a unique audit ID after 5 attempts."), { code:"AUDIT_ID_COLLISION_BLOCKED" });
  }

  function appendAuditRecord(records, record = {}, options = {}) {
    if (!Array.isArray(records)) throw new TypeError("Audit records must be an array.");
    const next = assignUniqueAuditId(records, record, options);
    records.push(next);
    return next;
  }

  function reconcileClientAudit(currentRecords = [], incomingRecords = []) {
    if (!Array.isArray(currentRecords) || !Array.isArray(incomingRecords)) {
      throw Object.assign(new Error("Audit history must be an array."), { code:"AUDIT_HISTORY_INVALID" });
    }
    if (incomingRecords.length < currentRecords.length) {
      throw Object.assign(new Error("Existing audit history cannot be removed."), { code:"AUDIT_HISTORY_IMMUTABLE" });
    }
    for (let index = 0; index < currentRecords.length; index += 1) {
      if (JSON.stringify(currentRecords[index]) !== JSON.stringify(incomingRecords[index])) {
        throw Object.assign(new Error("Existing audit history cannot be changed."), { code:"AUDIT_HISTORY_IMMUTABLE", index });
      }
    }
    const reconciled = currentRecords.map(row => ({ ...row }));
    const uuidPattern = /^AUD-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const row of incomingRecords.slice(currentRecords.length)) {
      const incomingId = String(row?.id || "");
      const collision = reconciled.some(existing => String(existing?.id || "") === incomingId);
      if (uuidPattern.test(incomingId) && !collision) reconciled.push({ ...row });
      else appendAuditRecord(reconciled, { ...row });
    }
    return reconciled;
  }

  return { MAX_GENERATION_ATTEMPTS, secureUuid, generateAuditId, assignUniqueAuditId, appendAuditRecord, reconcileClientAudit };
});
