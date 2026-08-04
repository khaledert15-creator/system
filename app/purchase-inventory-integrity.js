(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PurchaseInventoryIntegrity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ar").replace(/[\u064b-\u065f\u0670\u0640]/g, "").replace(/\s+/g, " ").trim();
  const activeBooks = books => (Array.isArray(books) ? books : []).filter(book => !book.deletedAt);

  function resolvePurchaseLines(books, lines) {
    const available = activeBooks(books);
    return (Array.isArray(lines) ? lines : []).map((line, index) => {
      const reference = String(line?.bookId || line?.productId || line?.barcode || "").trim();
      if (!reference) throw Object.assign(new Error(`Purchase line ${index + 1} has no product reference.`), { code:"PURCHASE_PRODUCT_REQUIRED", lineIndex:index });
      const exactId = available.filter(book => String(book.id) === reference);
      const barcode = available.filter(book => [book.barcode, book.extraBarcode].filter(Boolean).some(value => normalize(value) === normalize(reference)));
      const matches = exactId.length ? exactId : barcode;
      if (matches.length !== 1) throw Object.assign(new Error(matches.length ? `Purchase line ${index + 1} matches multiple products.` : `Purchase line ${index + 1} product was not found.`), { code:matches.length ? "PURCHASE_PRODUCT_AMBIGUOUS" : "PURCHASE_PRODUCT_NOT_FOUND", lineIndex:index, reference });
      return { ...clone(line), bookId:matches[0].id, productId:matches[0].id };
    });
  }

  function productIdentityConflicts(books, candidate, editId = "") {
    const barcodes = [candidate?.barcode, candidate?.extraBarcode].map(normalize).filter(Boolean);
    const name = normalize(candidate?.name), supplierId = String(candidate?.supplierId || "");
    return activeBooks(books).filter(book => String(book.id) !== String(editId || "")).filter(book => {
      const existingCodes = [book.barcode, book.extraBarcode].map(normalize).filter(Boolean);
      const barcodeCollision = barcodes.some(value => existingCodes.includes(value));
      const sameIdentity = name && normalize(book.name) === name && String(book.supplierId || "") === supplierId
        && Number(book.coverPrice ?? book.price ?? 0) === Number(candidate?.coverPrice ?? candidate?.price ?? 0);
      return barcodeCollision || sameIdentity;
    });
  }

  function validatePurchaseEffects(before, after, purchase, { inventoryAffecting = true } = {}) {
    const lines = Array.isArray(purchase?.lines) ? purchase.lines : [];
    const beforeBatchIds = new Set((before?.inventoryBatches || []).map(row => String(row.id || row.batchId || "")));
    const beforeMovementIds = new Set((before?.stockMovements || []).map(row => String(row.id || "")));
    const newBatches = (after?.inventoryBatches || []).filter(row => !beforeBatchIds.has(String(row.id || row.batchId || "")) && row.purchaseInvoiceId === purchase.id);
    const newMovements = (after?.stockMovements || []).filter(row => !beforeMovementIds.has(String(row.id || "")) && (row.documentId === purchase.id || row.documentNo === purchase.id));
    const expected = inventoryAffecting ? lines.length : 0;
    const failures = [];
    if (newBatches.length !== expected) failures.push({ code:"PURCHASE_BATCH_COUNT_MISMATCH", expected, actual:newBatches.length });
    if (newMovements.length !== expected) failures.push({ code:"PURCHASE_MOVEMENT_COUNT_MISMATCH", expected, actual:newMovements.length });
    const productIds = new Set(lines.map(line => String(line.bookId || line.productId || "")));
    for (const productId of productIds) {
      const expectedQty = inventoryAffecting ? lines.filter(line => String(line.bookId || line.productId) === productId).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0) : 0;
      const batchQty = newBatches.filter(row => String(row.bookId || row.productId) === productId).reduce((sum, row) => sum + Number(row.receivedQty || 0), 0);
      const movementQty = newMovements.filter(row => String(row.bookId || row.productId) === productId).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const beforeStock = Number((before?.books || []).find(book => String(book.id) === productId)?.stock || 0);
      const afterStock = Number((after?.books || []).find(book => String(book.id) === productId)?.stock || 0);
      if (batchQty !== expectedQty || movementQty !== expectedQty || afterStock - beforeStock !== expectedQty) failures.push({ code:"PURCHASE_PRODUCT_INVENTORY_MISMATCH", productId, expectedQty, batchQty, movementQty, stockDelta:afterStock-beforeStock });
    }
    if (failures.length) throw Object.assign(new Error("Purchase inventory effects are incomplete; the invoice was blocked."), { code:"PURCHASE_INVENTORY_VALIDATION_FAILED", failures });
    return { valid:true, expectedLines:expected, batchCount:newBatches.length, movementCount:newMovements.length };
  }

  return { normalize, resolvePurchaseLines, productIdentityConflicts, validatePurchaseEffects };
});
