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

  const productIdOf = row => String(row?.productId || row?.bookId || "");
  const batchIdOf = row => String(row?.batchId || row?.id || "");

  function inventoryConsistency(db, productIds = []) {
    const scope = new Set((productIds.length ? productIds : (db?.books || []).map(book => book.id)).map(String));
    return (db?.books || []).filter(book => scope.has(String(book.id)) && !book.deletedAt).map(book => {
      const stock = Number(book.stock || 0);
      const batchRemaining = (db?.inventoryBatches || []).filter(batch => !batch.deletedAt && productIdOf(batch) === String(book.id)).reduce((sum, batch) => sum + Number(batch.remainingQty ?? batch.remaining ?? 0), 0);
      return { productId:String(book.id), stock, batchRemaining:Number(batchRemaining.toFixed(6)), difference:Number((batchRemaining-stock).toFixed(6)), valid:Math.abs(batchRemaining-stock)<1e-6 };
    });
  }

  function assertInventoryConsistency(db, productIds = []) {
    const mismatches = inventoryConsistency(db, productIds).filter(row => !row.valid);
    if (mismatches.length) throw Object.assign(new Error("Inventory batch totals do not match product stock."), { code:"INVENTORY_BATCH_STOCK_MISMATCH", mismatches });
    return { valid:true, products:inventoryConsistency(db, productIds) };
  }

  function consumeBatchesFIFO(db, productId, quantity) {
    let remaining = Number(quantity || 0), costOfGoodsSold = 0, costIncomplete = false;
    const allocations = [], batches = (db?.inventoryBatches || []).filter(batch => !batch.deletedAt && productIdOf(batch) === String(productId) && Number(batch.remainingQty || 0) > 0).sort((a,b)=>String(a.purchaseDate||a.createdAt||"").localeCompare(String(b.purchaseDate||b.createdAt||""))||batchIdOf(a).localeCompare(batchIdOf(b)));
    const available=batches.reduce((sum,batch)=>sum+Number(batch.remainingQty||0),0);
    if(available+1e-6<remaining)throw Object.assign(new Error("Insufficient batch quantity for inventory operation."),{code:"INSUFFICIENT_BATCH_STOCK",productId,requested:Number(quantity||0),unallocatedQty:Number((remaining-available).toFixed(6))});
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take=Math.min(remaining,Number(batch.remainingQty||0));
      batch.remainingQty=Number((Number(batch.remainingQty||0)-take).toFixed(6));
      if (!Number(batch.unitCost||0)) costIncomplete=true;
      costOfGoodsSold+=take*Number(batch.unitCost||0);
      allocations.push({batchId:batchIdOf(batch),qty:take,unitCost:Number(batch.unitCost||0)});
      remaining=Number((remaining-take).toFixed(6));
    }
    if(remaining>0)throw Object.assign(new Error("Insufficient batch quantity for inventory operation."),{code:"INSUFFICIENT_BATCH_STOCK",productId,requested:Number(quantity||0),unallocatedQty:remaining});
    return {allocations,costOfGoodsSold:Number(costOfGoodsSold.toFixed(2)),costIncomplete,unallocatedQty:0};
  }

  function restoreBatchAllocations(db, allocations = []) {
    const resolved=allocations.map(allocation=>{const batch=(db?.inventoryBatches||[]).find(row=>batchIdOf(row)===String(allocation.batchId));if(!batch)throw Object.assign(new Error("Original inventory batch was not found."),{code:"BATCH_NOT_FOUND",batchId:allocation.batchId});return{allocation,batch};});
    for (const {allocation,batch} of resolved) {
      batch.remainingQty=Number((Number(batch.remainingQty||0)+Number(allocation.qty||0)).toFixed(6));
    }
    return {restored:Number(allocations.reduce((sum,row)=>sum+Number(row.qty||0),0).toFixed(6))};
  }

  function consumePurchaseBatches(db, purchase, requestedLines = purchase?.lines || []) {
    const resolved=[];
    for(const requested of requestedLines){
      const sourceLine=(purchase?.lines||[])[Number(requested.lineIndex)] || (purchase?.lines||[]).find(line=>String(line.bookId||line.productId)===String(requested.bookId||requested.productId)&&line.batchId);
      const batch=(db?.inventoryBatches||[]).find(row=>batchIdOf(row)===String(sourceLine?.batchId||requested.batchId||""));
      const qty=Number(requested.qty??requested.quantity??sourceLine?.qty??sourceLine?.quantity??0);
      if(!batch||Number(batch.remainingQty||0)<qty)throw Object.assign(new Error("Purchase batch does not contain the quantity required for cancellation/return."),{code:"PURCHASE_BATCH_QUANTITY_UNAVAILABLE",purchaseId:purchase?.id,productId:String(requested.bookId||requested.productId||sourceLine?.bookId||""),batchId:sourceLine?.batchId||"",requiredQty:qty,remainingQty:Number(batch?.remainingQty||0)});
      resolved.push({batch,qty});
    }
    return resolved.map(({batch,qty})=>{const before=Number(batch.remainingQty||0);batch.remainingQty=Number((before-qty).toFixed(6));return{batchId:batchIdOf(batch),productId:productIdOf(batch),before,after:batch.remainingQty,quantity:qty};});
  }

  function buildCancelledPurchaseBatchRepairCandidate(db, productIds = []) {
    const next=clone(db), scope=new Set(productIds.map(String)), changes=[];
    const cancelled=new Set((next.purchases||[]).filter(row=>["ملغاة","ملغي","cancelled","canceled"].includes(String(row.status||"").toLowerCase())).map(row=>String(row.id)));
    const cancelledBatchIds=new Set((next.purchases||[]).filter(row=>cancelled.has(String(row.id))).flatMap(row=>(row.lines||[]).map(line=>String(line.batchId||""))));
    for(const batch of next.inventoryBatches||[]){if((!scope.size||scope.has(productIdOf(batch)))&&cancelledBatchIds.has(batchIdOf(batch))&&Number(batch.remainingQty||0)>0){changes.push({batchId:batchIdOf(batch),productId:productIdOf(batch),before:Number(batch.remainingQty),after:0});batch.remainingQty=0;}}
    return {candidate:next,changes,validation:inventoryConsistency(next,productIds)};
  }

  return { normalize, resolvePurchaseLines, productIdentityConflicts, validatePurchaseEffects, inventoryConsistency, assertInventoryConsistency, consumeBatchesFIFO, restoreBatchAllocations, consumePurchaseBatches, buildCancelledPurchaseBatchRepairCandidate };
});
