(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InventoryMarkerReconciliation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  const MARKER_PATH = "meta.inventoryBatchMigration";
  const clone = value => JSON.parse(JSON.stringify(value));
  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const idOfBatch = batch => String(batch?.id || batch?.batchId || "").trim();
  const productOfBatch = batch => String(batch?.productId || batch?.bookId || "").trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const rounded = value => Number(number(value).toFixed(6));

  function inspect(db) {
    const books = list(db, "books").filter(item => !item.deletedAt);
    const batches = list(db, "inventoryBatches").filter(item => !item.deletedAt);
    const products = new Map(books.map(book => [String(book.id), book]));
    const seenIds = new Map();
    const duplicateBatches = [];
    const orphanBatches = [];
    const byProduct = new Map();

    for (const batch of batches) {
      const id = idOfBatch(batch), productId = productOfBatch(batch);
      if (id) {
        if (seenIds.has(id)) duplicateBatches.push({ id, productIds:[seenIds.get(id), productId] });
        else seenIds.set(id, productId);
      }
      if (!productId || !products.has(productId)) orphanBatches.push({ id, productId });
      if (productId) {
        const row = byProduct.get(productId) || { count:0, remaining:0, ids:[] };
        row.count += 1;
        row.remaining += number(batch.remainingQty ?? batch.remaining);
        row.ids.push(id);
        byProduct.set(productId, row);
      }
    }

    const productsReconciliation = books.map(book => {
      const productId = String(book.id), aggregate = byProduct.get(productId) || { count:0, remaining:0, ids:[] };
      const stock = rounded(book.stock), batchRemaining = rounded(aggregate.remaining);
      return { productId, stock, batchRemaining, difference:rounded(batchRemaining - stock), batchCount:aggregate.count, batchIds:aggregate.ids };
    });
    const mismatches = productsReconciliation.filter(row => row.difference !== 0);
    const marker = db?.meta?.inventoryBatchMigration;
    return {
      markerExists:Boolean(marker), markerPath:MARKER_PATH, marker:marker ? clone(marker) : null,
      productCount:books.length, batchCount:batches.length, productsReconciliation, mismatches,
      duplicateBatches, orphanBatches,
      validForMarkerOnly:!marker && mismatches.length === 0 && duplicateBatches.length === 0 && orphanBatches.length === 0
    };
  }

  function markerOnlyPreview(db, input = {}) {
    const report = inspect(db);
    if (report.markerExists) return { status:"NO_ACTION_REQUIRED", executable:false, idempotent:true, report, changes:[] };
    if (!report.validForMarkerOnly) return { status:"BLOCKED", executable:false, idempotent:false, report, changes:[] };
    const operationKey = String(input.operationKey || "").trim();
    if (!operationKey) throw Object.assign(new Error("Operation Key مطلوب."), { code:"OPERATION_KEY_REQUIRED" });
    return {
      status:"MARKER-ONLY RECONCILIATION", executable:true, idempotent:false, report,
      changes:[{ operation:"add", path:MARKER_PATH }],
      marker:{ version:1, migratedAt:String(input.performedAt || new Date().toISOString()), normalizedProducts:0, openingBatchesCreated:0, incompleteCostWarnings:0, reconciliation:"marker-only", operationKey, verifiedProducts:report.productCount, verifiedBatches:report.batchCount }
    };
  }

  function applyMarkerOnly(db, input = {}) {
    const preview = markerOnlyPreview(db, input);
    if (preview.status === "NO_ACTION_REQUIRED") return { db:clone(db), preview, idempotent:true, changed:false };
    if (!preview.executable) throw Object.assign(new Error("Batch reconciliation غير سليمة؛ ممنوع إضافة Marker فقط."), { code:"BATCH_RECONCILIATION_BLOCKED", report:preview.report });
    const next = clone(db);
    next.meta = next.meta || {};
    next.meta.inventoryBatchMigration = preview.marker;
    return { db:next, preview, idempotent:false, changed:true };
  }

  return { MARKER_PATH, inspect, markerOnlyPreview, applyMarkerOnly };
});
