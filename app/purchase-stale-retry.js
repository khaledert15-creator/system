"use strict";

(function purchaseStaleRetryModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PurchaseStaleRetry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPurchaseStaleRetry() {
  const clone = value => JSON.parse(JSON.stringify(value));
  const byId = (db, key, id) => (db?.[key] || []).find(item => item?.id === id) || null;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  function analyze({ base, latest, draft }) {
    const conflicts = [];
    const supplierId = String(draft?.supplierId || "");
    if (!same(byId(base, "suppliers", supplierId), byId(latest, "suppliers", supplierId))) {
      conflicts.push({ collection:"suppliers", id:supplierId, reason:"SUPPLIER_CHANGED" });
    }
    const bookIds = [...new Set((draft?.lines || []).map(line => line.bookId).filter(Boolean))];
    for (const id of bookIds) {
      if (!same(byId(base, "books", id), byId(latest, "books", id))) conflicts.push({ collection:"books", id, reason:"PRODUCT_OR_STOCK_CHANGED" });
    }
    const invoiceNumber = String(draft?.supplierInvoiceNumber || "").trim();
    if (invoiceNumber) {
      const existed = new Set((base?.purchases || []).map(item => item.id));
      const duplicate = (latest?.purchases || []).find(item => !existed.has(item.id) && item.supplierId === supplierId && String(item.supplierInvoiceNumber || "").trim() === invoiceNumber);
      if (duplicate) conflicts.push({ collection:"purchases", id:duplicate.id, reason:"SUPPLIER_INVOICE_ALREADY_EXISTS" });
    }
    const existingOperation = draft?.operationKey
      ? (latest?.purchases || []).find(item => item.operationKey === draft.operationKey) || null
      : null;
    return { safe:conflicts.length === 0, conflicts, existingOperation };
  }

  function mergeLatestWithDraft(latest, draft) {
    return { data:clone(latest), draft:clone(draft) };
  }

  return { analyze, mergeLatestWithDraft };
});
