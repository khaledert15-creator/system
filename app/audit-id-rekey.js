"use strict";

const crypto = require("crypto");

const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const BUSINESS_KEYS = Object.freeze(["books","purchases","suppliers","onlineOrders","orders","sales","shipments","payments","orderPayments","cash","cashMovements","expenses","otherIncome","inventoryBatches","stockMovements","customers","users","settings"]);

function duplicateGroups(db = {}) {
  const groups = new Map();
  (Array.isArray(db.audit) ? db.audit : []).forEach((row, index) => {
    const id = String(row?.id || "");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ index, row });
  });
  return [...groups.entries()].filter(([id, rows]) => id && rows.length > 1).map(([id, rows]) => ({ id, rows }));
}

function auditSummary(index, row = {}) {
  const relatedIds = Object.fromEntries(Object.entries(row).filter(([key, value]) => /Id$/.test(key) && key !== "id" && value != null && value !== ""));
  return { index, id:String(row.id || ""), operationType:row.operationType || row.action || "", performedBy:row.performedBy || row.employeeName || row.user || row.username || "", performedAt:row.performedAt || row.createdAt || row.date || "", result:row.result || "", relatedIds };
}

function buildRekeyPreview(db = {}, { dateTag = new Date().toISOString().slice(0,10).replace(/-/g, "") } = {}) {
  const source = clone(db), candidate = clone(db), groups = duplicateGroups(source);
  const used = new Set((source.audit || []).map(row => String(row?.id || "")).filter(Boolean));
  const changes = [];
  let sequence = 1;
  for (const group of groups) {
    for (const entry of group.rows.slice(1)) {
      let nextId;
      do nextId = `AUD-REKEY-${dateTag}-${String(sequence++).padStart(4, "0")}`;
      while (used.has(nextId));
      used.add(nextId);
      candidate.audit[entry.index].id = nextId;
      changes.push({ index:entry.index, oldId:group.id, newId:nextId });
    }
  }
  const candidateDuplicates = duplicateGroups(candidate);
  const sourceWithoutAuditIds = clone(source), candidateWithoutAuditIds = clone(candidate);
  sourceWithoutAuditIds.audit = (sourceWithoutAuditIds.audit || []).map(({ id, ...row }) => row);
  candidateWithoutAuditIds.audit = (candidateWithoutAuditIds.audit || []).map(({ id, ...row }) => row);
  const businessDiff = Object.fromEntries(BUSINESS_KEYS.map(key => [key, sha256(source[key] ?? null) === sha256(candidate[key] ?? null) ? "UNCHANGED" : "CHANGED"]));
  const validation = {
    jsonValid:true,
    sourceAuditCount:(source.audit || []).length,
    candidateAuditCount:(candidate.audit || []).length,
    auditCountUnchanged:(source.audit || []).length === (candidate.audit || []).length,
    duplicateAuditIdsBefore:groups.map(group => ({ id:group.id, count:group.rows.length })),
    duplicateAuditIdsAfter:candidateDuplicates.map(group => ({ id:group.id, count:group.rows.length })),
    auditContentExceptIdUnchanged:sha256(sourceWithoutAuditIds.audit) === sha256(candidateWithoutAuditIds.audit),
    businessDiff,
    businessDataUnchanged:Object.values(businessDiff).every(value => value === "UNCHANGED"),
    semanticDiffAuditIdOnly:sha256(sourceWithoutAuditIds) === sha256(candidateWithoutAuditIds)
  };
  validation.valid = validation.auditCountUnchanged && !candidateDuplicates.length && validation.auditContentExceptIdUnchanged && validation.businessDataUnchanged && validation.semanticDiffAuditIdOnly;
  return {
    report:{ generatedAt:new Date().toISOString(), duplicates:groups.map(group => ({ id:group.id, count:group.rows.length, records:group.rows.map(entry => auditSummary(entry.index, entry.row)) })) },
    plan:{ strategy:"KEEP_FIRST_REKEY_REMAINDER", changes },
    candidate,
    validation
  };
}

module.exports = { BUSINESS_KEYS, duplicateGroups, auditSummary, buildRekeyPreview };
