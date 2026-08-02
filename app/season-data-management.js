(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SeasonDataManagement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEMO_PRODUCT_IDS = Object.freeze(["B001", "B002", "B003", "B004", "B005"]);
  const SEASON_LINKED_COLLECTIONS = Object.freeze([
    "books", "inventoryBatches", "purchases", "onlineOrders", "sales", "shipments",
    "orderPayments", "orderCollections", "stockMovements", "complaints", "notifications"
  ]);
  const OPEN_ORDER_STATUSES = new Set(["جديد", "قيد التأكيد", "تم التأكيد", "قيد التجهيز", "تم التجهيز", "جاهز للشحن", "تم إنشاء الفاتورة"]);
  const CLOSED_SHIPMENT_STATUSES = new Set(["تم التسليم", "مرتجع", "ملغي", "ملغاة", "delivered", "returned", "cancelled"]);
  const KNOWN_B004_EXCEPTION = Object.freeze({ productId:"B004", stock:-1, reservedStock:0, batchCount:0, batchRemaining:0, movementId:"MOV-003", movementQuantity:-1, movementBefore:0, movementAfter:-1, orderId:"ORD-002", invoiceId:"INV-1050", shipmentId:"SH-210" });
  const APPROVED_SEED_SHIPMENT = Object.freeze({ id:"SH-207", orderId:"INV-1043", invoiceId:"INV-1043", customerName:"محمد علي", carrier:"Mylerz", trackingCode:"MY-551209", status:"delivered", shippingCost:65, trackingEnabled:false });

  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const idOf = item => String(item?.id || item?.returnNo || item?.shipmentNo || "");
  const rowKey = (item, index) => `${idOf(item) || "ROW"}@@${index}`;
  const lineProductId = line => String(line?.bookId || line?.productId || "");
  const linesOf = item => Array.isArray(item?.lines) ? item.lines : Array.isArray(item?.items) ? item.items : [];
  const active = item => item && !item.deletedAt && !["ملغي", "ملغاة", "cancelled", "canceled", "reversed"].includes(String(item.status || "").toLowerCase());
  const deepClone = value => JSON.parse(JSON.stringify(value));
  const intersects = (values, set) => values.some(value => set.has(String(value || "")));
  const fieldRefs = item => [item?.orderId, item?.onlineOrderId, item?.invoiceId, item?.saleId, item?.shipmentId, item?.paymentId, item?.collectionId, item?.documentId, item?.entityId, item?.sourceId].filter(Boolean).map(String);

  function inventoryReconciliation(db) {
    const batches = list(db, "inventoryBatches").filter(active), products = list(db, "books").filter(active);
    const productIds = new Set(products.map(idOf)), seen = new Set(), duplicateBatches = [], orphanBatches = [], totals = new Map();
    for (const batch of batches) {
      const batchId = String(batch.id || batch.batchId || ""), productId = String(batch.productId || batch.bookId || "");
      if (seen.has(batchId)) duplicateBatches.push(batchId); else seen.add(batchId);
      if (!productIds.has(productId)) orphanBatches.push(batchId);
      totals.set(productId, Number(((totals.get(productId) || 0) + Number(batch.remainingQty ?? batch.remaining ?? 0)).toFixed(6)));
    }
    const productsReconciliation = products.map(product => { const stock=Number(product.stock || 0), batchRemaining=Number(totals.get(idOf(product)) || 0); return { productId:idOf(product), stock, batchRemaining, difference:Number((batchRemaining-stock).toFixed(6)), batchCount:batches.filter(batch => String(batch.productId || batch.bookId || "") === idOf(product)).length }; });
    const mismatches = productsReconciliation.filter(row => row.difference !== 0);
    const negativeProducts = productsReconciliation.filter(row => row.stock < 0).map(row => row.productId);
    const negativeReservations = products.filter(product => Number(product.reservedStock || 0) < 0).map(idOf);
    const movementProducts = new Set(products.map(idOf));
    const unexplainedStockMovements = list(db, "stockMovements").filter(active).filter(row => !movementProducts.has(String(row.bookId || row.productId || ""))).map(idOf);
    return { productsReconciliation, mismatches, negativeProducts, duplicateBatches, orphanBatches, negativeReservations, unexplainedStockMovements, valid:mismatches.length===0 && negativeProducts.length===0 && duplicateBatches.length===0 && orphanBatches.length===0 && negativeReservations.length===0 && unexplainedStockMovements.length===0 };
  }

  function demoContainedInventoryGuard(db, preview) {
    const expected = KNOWN_B004_EXCEPTION, reasons = [], product = list(db,"books").find(x => idOf(x) === expected.productId);
    const batches = list(db,"inventoryBatches").filter(active).filter(x => String(x.productId || x.bookId || "") === expected.productId);
    const movements = list(db,"stockMovements").filter(active).filter(x => String(x.productId || x.bookId || "") === expected.productId);
    const movement = movements[0], batchRemaining = batches.reduce((sum,x) => sum + Number(x.remainingQty ?? x.remaining ?? 0), 0);
    const exact = (actual, wanted, label) => { if (actual !== wanted) reasons.push(`${label}: expected ${wanted}, got ${actual}`); };
    if (!product) reasons.push("B004 product missing");
    else { exact(Number(product.stock || 0), expected.stock, "B004 stock"); exact(Number(product.reservedStock || 0), expected.reservedStock, "B004 reservedStock"); }
    exact(batches.length, expected.batchCount, "B004 batchCount"); exact(Number(batchRemaining), expected.batchRemaining, "B004 batchRemaining");
    exact(movements.length, 1, "B004 movementCount");
    if (movement) { exact(idOf(movement), expected.movementId, "movementId"); exact(Number(movement.quantity), expected.movementQuantity, "movement quantity"); exact(Number(movement.before), expected.movementBefore, "movement before"); exact(Number(movement.after), expected.movementAfter, "movement after"); }
    for (const [key,id] of [["onlineOrders",expected.orderId],["sales",expected.invoiceId],["shipments",expected.shipmentId],["stockMovements",expected.movementId]]) if (!preview.scope[key].some(value => String(value).split("@@")[0] === id)) reasons.push(`${key}:${id} خارج Demo Scope`);
    const linkedPurchases = list(db,"purchases").filter(active).filter(item => linesOf(item).some(line => lineProductId(line) === expected.productId));
    const linkedReturns = list(db,"returns").filter(active).filter(item => linesOf(item).some(line => lineProductId(line) === expected.productId));
    if (linkedPurchases.length) reasons.push("B004 مرتبط بمشتريات؛ Marker الاستثناء ممنوع");
    if (linkedReturns.length) reasons.push("B004 مرتبط بمرتجعات؛ Marker الاستثناء ممنوع");
    const reconciliation = inventoryReconciliation(db), unexpected = reconciliation.mismatches.filter(row => row.productId !== expected.productId);
    if (unexpected.length) reasons.push(`inventory mismatches خارج B004: ${unexpected.map(x=>x.productId).join(",")}`);
    const negativeOutsideDemo = reconciliation.negativeProducts.filter(id => !preview.detectedProductIds.includes(id));
    if (negativeOutsideDemo.length) reasons.push(`negative products خارج Demo Scope: ${negativeOutsideDemo.join(",")}`);
    const realSettlement = [...list(db,"carrierSettlements"), ...list(db,"orderCollections")].filter(active).some(item => fieldRefs(item).some(ref => [expected.orderId,expected.invoiceId,expected.shipmentId].includes(ref)));
    if (realSettlement) reasons.push("B004 مرتبط بتسوية مالية");
    if (preview.blockedRecords.length) reasons.push("يوجد سجل Demo/Real مختلط");
    const accepted = reasons.length === 0;
    return { code:"DEMO_CONTAINED_INVENTORY_EXCEPTION", productId:expected.productId, status:accepted ? "CONTAINED AND REMOVED BY PURGE" : "BLOCKED", accepted, fingerprint:{ productId:expected.productId, stock:product ? Number(product.stock||0) : null, reservedStock:product ? Number(product.reservedStock||0) : null, batchCount:batches.length, batchRemaining:Number(batchRemaining), movementId:movement ? idOf(movement) : "", movementQuantity:movement ? Number(movement.quantity) : null, movementBefore:movement ? Number(movement.before) : null, movementAfter:movement ? Number(movement.after) : null, orderId:expected.orderId, invoiceId:expected.invoiceId, shipmentId:expected.shipmentId }, reasons };
  }

  function explicitSeedShipmentGuard(db) {
    const expected = APPROVED_SEED_SHIPMENT, shipment = list(db,"shipments").find(x => idOf(x) === expected.id), reasons = [];
    const exact = (actual,wanted,label) => { if (actual !== wanted) reasons.push(`${label}: expected ${wanted}, got ${actual}`); };
    if (!shipment) reasons.push("SH-207 shipment missing");
    else {
      exact(String(shipment.orderId||""),expected.orderId,"orderId"); exact(String(shipment.invoiceId||""),expected.invoiceId,"invoiceId"); exact(String(shipment.onlineOrderId||""),"","onlineOrderId");
      exact(String(shipment.customerId||""),"","customerId"); exact(String(shipment.customerName||shipment.customer||""),expected.customerName,"customerName"); exact(String(shipment.customerPhone||shipment.phone||""),"","phone");
      exact(String(shipment.carrier||shipment.company||""),expected.carrier,"carrier"); exact(String(shipment.trackingNumber||shipment.tracking||""),expected.trackingCode,"trackingCode");
      const status=String(shipment.normalizedStatus||shipment.shippingStatus||shipment.currentStatus||shipment.status||""); if(!["delivered","تم التسليم"].includes(status)) reasons.push(`status: expected delivered, got ${status}`);
      exact(Number(shipment.cost??shipment.shippingCost??0),expected.shippingCost,"shippingCost"); exact(Boolean(shipment.trackingEnabled),expected.trackingEnabled,"trackingEnabled");
    }
    const tokens=[expected.id,expected.invoiceId,expected.trackingCode], related={};
    for(const key of ["orderPayments","cash","orderCollections","carrierSettlements","expenses","complaints","trackingHistory","trackingRuns","stockMovements"]){ related[key]=list(db,key).filter(row=>tokens.some(token=>JSON.stringify(row).includes(token))); if(related[key].length) reasons.push(`${key}: ${related[key].length} linked record(s)`); }
    const accepted=reasons.length===0;
    return { code:"EXPLICIT_APPROVED_SEED_RECORD", recordType:"shipment", id:expected.id, status:accepted?"APPROVED SEED RECORD — REMOVED BY PURGE":"BLOCKED", accepted, classification:"Seed Referential Integrity Defect", fingerprint:shipment?{ id:idOf(shipment), orderId:String(shipment.orderId||""), invoiceId:String(shipment.invoiceId||""), onlineOrderId:String(shipment.onlineOrderId||""), customerId:String(shipment.customerId||""), customerName:String(shipment.customerName||shipment.customer||""), phone:String(shipment.customerPhone||shipment.phone||""), carrier:String(shipment.carrier||shipment.company||""), trackingCode:String(shipment.trackingNumber||shipment.tracking||""), status:String(shipment.normalizedStatus||shipment.shippingStatus||shipment.currentStatus||shipment.status||""), shippingCost:Number(shipment.cost??shipment.shippingCost??0), trackingEnabled:Boolean(shipment.trackingEnabled), linkedCounts:Object.fromEntries(Object.entries(related).map(([key,rows])=>[key,rows.length])) }:null, reasons };
  }

  function deploymentReadiness(db, preview = buildDemoPreview(db)) {
    const reconciliation = inventoryReconciliation(db), known = preview.inventoryExceptions?.[0];
    const otherMismatches = reconciliation.mismatches.filter(row => row.productId !== KNOWN_B004_EXCEPTION.productId);
    const otherNegatives = reconciliation.negativeProducts.filter(id => id !== KNOWN_B004_EXCEPTION.productId);
    const generalPass = otherMismatches.length === 0 && otherNegatives.length === 0 && reconciliation.duplicateBatches.length === 0 && reconciliation.orphanBatches.length === 0 && reconciliation.negativeReservations.length === 0 && reconciliation.unexplainedStockMovements.length === 0;
    return { inventoryGeneralGuard:generalPass ? "PASS" : "FAIL", knownDemoExceptionB004:known?.accepted ? "PRESENT AND UNCHANGED" : "CHANGED OR MISSING", codeDeploymentAllowed:Boolean(generalPass && known?.accepted), dataCleanupRequired:Boolean(known?.accepted), otherMismatches, otherNegatives };
  }

  function classifyProductLines(item, demoProducts) {
    const ids = linesOf(item).map(lineProductId).filter(Boolean);
    return {
      ids,
      demo: ids.filter(id => demoProducts.has(id)),
      other: ids.filter(id => !demoProducts.has(id))
    };
  }

  function buildDemoPreview(db, options = {}) {
    const approvedProductIds = new Set((options.productIds || DEMO_PRODUCT_IDS).map(String));
    const existingProductIds = new Set(list(db, "books").map(item => String(item.id)));
    const demoProducts = new Set([...approvedProductIds].filter(id => existingProductIds.has(id)));
    const blockedRecords = [];
    const scope = Object.fromEntries([
      "books", "onlineOrders", "sales", "purchases", "shipments", "orderPayments", "orderCollections", "cash",
      "stockMovements", "inventoryBatches", "returns", "complaints", "notifications", "trackingHistory", "trackingRuns", "audit"
    ].map(key => [key, new Set()]));
    demoProducts.forEach(id => scope.books.add(id));

    for (const key of ["onlineOrders", "sales", "purchases", "returns"]) {
      for (const item of list(db, key).filter(active)) {
        const classification = classifyProductLines(item, demoProducts);
        if (!classification.demo.length) continue;
        if (classification.other.length) {
          blockedRecords.push({ collection:key, id:idOf(item), reason:"سجل مختلط يجمع أصنافًا تجريبية وحقيقية", demoProductIds:classification.demo, realProductIds:classification.other });
        } else scope[key].add(idOf(item));
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      const demoOrderIds = scope.onlineOrders;
      const demoInvoiceIds = scope.sales;
      for (const sale of list(db, "sales").filter(active)) {
        if ((demoOrderIds.has(String(sale.onlineOrderId || "")) || demoOrderIds.has(String(sale.orderId || ""))) && !scope.sales.has(idOf(sale))) {
          const c = classifyProductLines(sale, demoProducts);
          if (c.other.length) blockedRecords.push({ collection:"sales", id:idOf(sale), reason:"فاتورة مختلطة مرتبطة بطلب تجريبي", realProductIds:c.other });
          else { scope.sales.add(idOf(sale)); changed = true; }
        }
      }
      for (const order of list(db, "onlineOrders").filter(active)) {
        if (demoInvoiceIds.has(String(order.saleId || "")) && !scope.onlineOrders.has(idOf(order))) {
          const c = classifyProductLines(order, demoProducts);
          if (c.other.length) blockedRecords.push({ collection:"onlineOrders", id:idOf(order), reason:"طلب مختلط مرتبط بفاتورة تجريبية", realProductIds:c.other });
          else { scope.onlineOrders.add(idOf(order)); changed = true; }
        }
      }
    }

    const linkedIds = () => new Set([...scope.onlineOrders, ...scope.sales, ...scope.purchases, ...scope.returns]);
    for (const shipment of list(db, "shipments").filter(active)) {
      if (intersects(fieldRefs(shipment), linkedIds())) scope.shipments.add(idOf(shipment));
    }
    const trackingNumbers = new Set(list(db, "shipments").filter(x => scope.shipments.has(idOf(x))).flatMap(x => [x.trackingNumber, x.tracking]).filter(Boolean).map(String));
    const selectedRowIds = key => [...scope[key]].map(value => String(value).split("@@")[0]).filter(Boolean);
    const allPrimaryIds = () => new Set([...demoProducts, ...linkedIds(), ...scope.shipments, ...selectedRowIds("orderPayments"), ...selectedRowIds("orderCollections"), ...selectedRowIds("complaints")]);

    for (const key of ["orderPayments", "orderCollections", "cash", "complaints", "notifications", "trackingHistory", "trackingRuns", "audit"]) {
      list(db, key).forEach((item, index) => {
        const refs = fieldRefs(item);
        const direct = intersects(refs, allPrimaryIds());
        const tracking = trackingNumbers.has(String(item.trackingNumber || item.tracking || ""));
        const source = String(item.sourceKey || item.reference || item.documentNo || "");
        const embedded = [...allPrimaryIds()].some(id => id && source.includes(id));
        if (direct || tracking || embedded) scope[key].add(rowKey(item, index));
      });
    }
    list(db, "stockMovements").forEach((movement, index) => { if (demoProducts.has(String(movement.bookId || movement.productId || ""))) scope.stockMovements.add(rowKey(movement, index)); });
    list(db, "inventoryBatches").forEach((batch, index) => { if (demoProducts.has(String(batch.bookId || batch.productId || ""))) scope.inventoryBatches.add(rowKey(batch, index)); });

    const reservationOrders = list(db, "onlineOrders").filter(order => scope.onlineOrders.has(idOf(order)) && order.inventoryReservation).map(order => idOf(order));
    const seedShipment = explicitSeedShipmentGuard(db);
    if (seedShipment.accepted) scope.shipments.add(seedShipment.id);
    const counts = Object.fromEntries(Object.entries(scope).map(([key, ids]) => [key, ids.size]));
    counts.reservations = reservationOrders.length;
    const uniqueBlocks = [...new Map(blockedRecords.map(item => [`${item.collection}:${item.id}:${item.reason}`, item])).values()];
    const basePreview = {
      dryRun:true,
      approvedProductIds:[...approvedProductIds],
      detectedProductIds:[...demoProducts],
      counts,
      scope:Object.fromEntries(Object.entries(scope).map(([key, ids]) => [key, [...ids]])),
      reservationOrderIds:reservationOrders,
      blockedRecords:uniqueBlocks
    };
    const inventoryException = demoContainedInventoryGuard(db, basePreview);
    const result = { ...basePreview, inventoryExceptions:[inventoryException], explicitSeedRecords:[seedShipment], inventoryGuard:{ general:inventoryReconciliation(db), knownDemoException:inventoryException }, executable:demoProducts.size > 0 && uniqueBlocks.length === 0 && inventoryException.accepted && seedShipment.accepted };
    result.deploymentReadiness = deploymentReadiness(db, result);
    return result;
  }

  function orphanReport(db) {
    const products = new Set(list(db, "books").map(idOf));
    const orders = new Set(list(db, "onlineOrders").map(idOf));
    const sales = new Set(list(db, "sales").map(idOf));
    const shipments = new Set(list(db, "shipments").map(idOf));
    return {
      stockMovements:list(db, "stockMovements").filter(item => !products.has(String(item.bookId || item.productId || ""))).map(idOf),
      inventoryBatches:list(db, "inventoryBatches").filter(item => !products.has(String(item.bookId || item.productId || ""))).map(idOf),
      invoices:list(db, "sales").filter(item => item.onlineOrderId && !orders.has(String(item.onlineOrderId))).map(idOf),
      shipments:list(db, "shipments").filter(item => item.invoiceId && !sales.has(String(item.invoiceId))).map(idOf),
      complaints:list(db, "complaints").filter(item => item.shipmentId && !shipments.has(String(item.shipmentId))).map(idOf)
    };
  }

  function assertBackupGuard(backup = {}) {
    const valid = backup.valid === true && Number(backup.sourceSize) > 0 && backup.sourceSize === backup.backupSize && backup.sourceSha256 && backup.sourceSha256 === backup.backupSha256 && backup.reference;
    if (!valid) throw Object.assign(new Error("Backup Guard غير مكتمل أو غير صالح."), { code:"BACKUP_GUARD_FAILED" });
  }

  function purgeDemoDataset(db, request = {}) {
    assertBackupGuard(request.backup);
    if (request.confirmation !== "حذف البيانات التجريبية") throw Object.assign(new Error("عبارة التأكيد غير مطابقة."), { code:"CONFIRMATION_REQUIRED" });
    if (!request.performedBy) throw Object.assign(new Error("هوية المنفذ مطلوبة."), { code:"IDENTITY_REQUIRED" });
    const operationKey = String(request.operationKey || "");
    if (!operationKey) throw Object.assign(new Error("Operation Key مطلوب لمنع تكرار التنفيذ."), { code:"IDEMPOTENCY_KEY_REQUIRED" });
    const previousAudit = list(db, "audit").find(item => item.operationKey === operationKey && ["PURGE_DEMO_DATASET", "حذف البيانات التجريبية"].includes(item.operationType));
    if (previousAudit) return { db:deepClone(db), idempotent:true, audit:previousAudit, deleted:previousAudit.recordsDeleted || {} };
    const preview = buildDemoPreview(db, request);
    if (preview.blockedRecords.length) throw Object.assign(new Error("توجد سجلات مختلطة؛ تم منع الحذف."), { code:"MIXED_RECORDS_BLOCKED", blockedRecords:preview.blockedRecords });
    if (!preview.executable) throw Object.assign(new Error("Demo Scope Fingerprint غير مطابق؛ تم منع الحذف."), { code:"DEMO_FINGERPRINT_BLOCKED", inventoryExceptions:preview.inventoryExceptions });
    const preExistingOrphans = orphanReport(db), next = deepClone(db);
    for (const [key, ids] of Object.entries(preview.scope)) {
      if (!Array.isArray(next[key]) || !ids.length) continue;
      const remove = new Set(ids.map(String));
      next[key] = next[key].filter((item, index) => !remove.has(idOf(item)) && !remove.has(rowKey(item, index)));
    }
    const orphans = orphanReport(next), newOrphans = Object.fromEntries(Object.entries(orphans).map(([key,rows]) => [key, rows.filter(id => !(preExistingOrphans[key] || []).includes(id))])), postPurgeInventoryResult = inventoryReconciliation(next);
    if (Object.values(orphans).some(rows => rows.length)) throw Object.assign(new Error("Orphan Guard منع اعتماد العملية."), { code:"ORPHAN_GUARD_FAILED", orphans, preExistingOrphans, newOrphans });
    if (!postPurgeInventoryResult.valid) throw Object.assign(new Error("Post-Purge Inventory Guard منع اعتماد العملية."), { code:"POST_PURGE_INVENTORY_BLOCKED", postPurgeInventoryResult });
    const scopedIds = key => new Set((preview.scope[key] || []).map(value=>String(value).split("@@")[0]));
    const remainingScoped = key => list(next,key).filter(row=>scopedIds(key).has(idOf(row))).length;
    const financeKeys=["orderPayments","cash","orderCollections","carrierSettlements","expenses"];
    const realFinanceRecordsChanged=financeKeys.reduce((total,key)=>{ const scoped=scopedIds(key), before=list(db,key).filter(row=>!scoped.has(idOf(row))), after=list(next,key); return total + (JSON.stringify(before)===JSON.stringify(after)?0:1); },0);
    const postPurgeFinanceResult={ demoPaymentsRemaining:remainingScoped("orderPayments"), demoCashMovementsRemaining:remainingScoped("cash"), realFinanceRecordsChanged, valid:remainingScoped("orderPayments")===0&&remainingScoped("cash")===0&&realFinanceRecordsChanged===0 };
    if(!postPurgeFinanceResult.valid) throw Object.assign(new Error("Post-Purge Finance Guard منع اعتماد العملية."),{code:"POST_PURGE_FINANCE_BLOCKED",postPurgeFinanceResult});
    const now = request.performedAt || new Date().toISOString();
    next.audit = Array.isArray(next.audit) ? next.audit : [];
    const audit = {
      id:`AUD-DEMO-PURGE-${operationKey}`, operationKey, operationType:"PURGE_DEMO_DATASET", action:"حذف مجموعة بيانات تجريبية مترابطة",
      approvedScope:preview.detectedProductIds, approvedProductIds:preview.detectedProductIds, approvedOrderIds:preview.scope.onlineOrders.map(x=>String(x).split("@@")[0]), approvedInvoiceIds:preview.scope.sales.map(x=>String(x).split("@@")[0]), approvedShipmentIds:preview.scope.shipments.map(x=>String(x).split("@@")[0]), seedClassifications:preview.explicitSeedRecords, previewCounts:preview.counts, containedInventoryExceptions:preview.inventoryExceptions, selectedScope:preview.detectedProductIds, seasonId:request.seasonId || "", performedBy:request.performedBy,
      performedAt:now, createdAt:now, backupReference:request.backup.reference, recordsDeleted:preview.counts,
      deletedCounts:preview.counts, preservedCounts:{ customers:list(next,"customers").length, suppliers:list(next,"suppliers").length, users:list(next,"users").length, shippingCompanies:list(next,"shippingCompanies").length, cashAccounts:list(next,"cashAccounts").length }, postPurgeOrphanResult:{preExistingOrphans,remainingOrphans:orphans,newOrphans}, postPurgeInventoryResult, postPurgeFinanceResult,
      recordsArchived:{}, recordsPreserved:{ customers:list(next,"customers").length, suppliers:list(next,"suppliers").length, users:list(next,"users").length, settings:1 }, result:"success", failureReason:""
    };
    next.audit.push(audit);
    return { db:next, idempotent:false, preview, deleted:preview.counts, audit, orphans, preExistingOrphans, newOrphans, postPurgeInventoryResult, postPurgeFinanceResult };
  }

  function runtimeSeasons(db, now = new Date().toISOString()) {
    if (Array.isArray(db?.seasons) && db.seasons.length) return db.seasons.map(deepClone);
    return [{ id:"LEGACY-RUNTIME", name:"البيانات السابقة", academicYear:"Legacy", status:"legacy", startsAt:"", endsAt:"", createdAt:now, runtimeOnly:true }];
  }

  function activeSeason(db) {
    const seasons = Array.isArray(db?.seasons) ? db.seasons : [];
    const configured = db?.settings?.activeSeasonId;
    return seasons.find(item => item.id === configured && item.status === "active") || seasons.find(item => item.status === "active") || null;
  }

  function openOperations(db, seasonId = "") {
    const inSeason = item => !seasonId || item.seasonId === seasonId;
    const orders = list(db, "onlineOrders").filter(item => active(item) && inSeason(item) && OPEN_ORDER_STATUSES.has(String(item.workflowStage || item.status || "")));
    const shipments = list(db, "shipments").filter(item => active(item) && inSeason(item) && !CLOSED_SHIPMENT_STATUSES.has(String(item.normalizedStatus || item.shippingStatus || item.status || item.currentStatus || "")));
    const collections = list(db, "orderCollections").filter(item => active(item) && inSeason(item) && !["settled", "reversed", "تمت التسوية"].includes(String(item.status || "")));
    const returns = list(db, "returns").filter(item => active(item) && inSeason(item) && !["مغلق", "مكتمل", "closed", "completed"].includes(String(item.status || "")));
    const unresolvedFinance = list(db, "carrierSettlements").filter(item => active(item) && inSeason(item) && !["settled", "تمت التسوية", "closed"].includes(String(item.status || "")));
    return { orders:orders.map(idOf), shipments:shipments.map(idOf), collections:collections.map(idOf), returns:returns.map(idOf), finance:unresolvedFinance.map(idOf), total:orders.length + shipments.length + collections.length + returns.length + unresolvedFinance.length };
  }

  function createSeason(db, input = {}, actor = {}) {
    const name = String(input.name || "").trim(), academicYear = String(input.academicYear || "").trim(), startsAt = String(input.startsAt || "").trim();
    if (!name || !academicYear || !startsAt) throw Object.assign(new Error("اسم الموسم والسنة الدراسية وتاريخ البداية مطلوبة."), { code:"SEASON_FIELDS_REQUIRED" });
    const next = deepClone(db), now = input.createdAt || new Date().toISOString();
    next.seasons = Array.isArray(next.seasons) ? next.seasons : [];
    if (next.seasons.some(item => item.status === "active")) throw Object.assign(new Error("يوجد موسم نشط بالفعل؛ أغلقه قبل بدء موسم جديد."), { code:"ACTIVE_SEASON_EXISTS" });
    const season = { id:input.id || `SEA-${academicYear.replace(/\D/g, "") || Date.now()}`, name, academicYear, status:"active", startsAt, endsAt:"", createdAt:now, createdBy:actor.name || actor.username || "", closedAt:"", closedBy:"", notes:String(input.notes || "") };
    if (next.seasons.some(item => item.id === season.id)) throw Object.assign(new Error("معرف الموسم مستخدم من قبل."), { code:"DUPLICATE_SEASON" });
    next.seasons.push(season);
    next.settings = { ...(next.settings || {}), activeSeasonId:season.id };
    next.audit = Array.isArray(next.audit) ? next.audit : [];
    next.audit.push({ id:`AUD-SEASON-${season.id}`, operationType:"بدء موسم جديد", action:"إنشاء موسم نشط", entity:"المواسم", entityId:season.id, seasonId:season.id, selectedScope:input.preserve || {}, performedBy:season.createdBy, performedAt:now, createdAt:now, recordsPreserved:input.preserve || {}, result:"success" });
    return { db:next, season };
  }

  function closeSeason(db, seasonId, input = {}, actor = {}) {
    const next = deepClone(db), season = list(next, "seasons").find(item => item.id === seasonId);
    if (!season) throw Object.assign(new Error("الموسم غير موجود."), { code:"SEASON_NOT_FOUND" });
    if (season.status !== "active") throw Object.assign(new Error("الموسم ليس نشطًا."), { code:"SEASON_NOT_ACTIVE" });
    const open = openOperations(next, seasonId);
    if (open.total && !(input.administrativeOverride && String(input.reason || "").trim())) throw Object.assign(new Error("توجد عمليات مفتوحة تمنع إغلاق الموسم."), { code:"OPEN_OPERATIONS", openOperations:open });
    const now = input.closedAt || new Date().toISOString();
    Object.assign(season, { status:input.archive ? "archived" : "closed", endsAt:input.endsAt || now.slice(0, 10), closedAt:now, closedBy:actor.name || actor.username || "", closeReason:String(input.reason || "") });
    if (next.settings?.activeSeasonId === season.id) next.settings.activeSeasonId = "";
    next.audit = Array.isArray(next.audit) ? next.audit : [];
    next.audit.push({ id:`AUD-SEASON-CLOSE-${season.id}-${Date.now()}`, operationType:"إغلاق موسم", action:input.administrativeOverride ? "إغلاق إداري لموسم" : "إغلاق موسم", entity:"المواسم", entityId:season.id, seasonId:season.id, performedBy:season.closedBy, performedAt:now, createdAt:now, openOperations:open, reason:String(input.reason || ""), result:"success" });
    return { db:next, season, openOperations:open };
  }

  function linkNewRecordsToActiveSeason(currentDb, nextDb) {
    const season = activeSeason(nextDb) || activeSeason(currentDb);
    if (!season) return nextDb;
    for (const key of SEASON_LINKED_COLLECTIONS) {
      if (!Array.isArray(nextDb[key])) continue;
      const previous = new Set(list(currentDb, key).map(idOf));
      for (const item of nextDb[key]) if (!previous.has(idOf(item)) && !item.seasonId) item.seasonId = season.id;
    }
    return nextDb;
  }

  return { DEMO_PRODUCT_IDS, SEASON_LINKED_COLLECTIONS, KNOWN_B004_EXCEPTION, APPROVED_SEED_SHIPMENT, buildDemoPreview, demoContainedInventoryGuard, explicitSeedShipmentGuard, deploymentReadiness, inventoryReconciliation, purgeDemoDataset, orphanReport, runtimeSeasons, activeSeason, openOperations, createSeason, closeSeason, linkNewRecordsToActiveSeason, assertBackupGuard };
});
