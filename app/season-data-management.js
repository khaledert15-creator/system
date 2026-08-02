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

  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const idOf = item => String(item?.id || item?.returnNo || item?.shipmentNo || "");
  const rowKey = (item, index) => `${idOf(item) || "ROW"}@@${index}`;
  const lineProductId = line => String(line?.bookId || line?.productId || "");
  const linesOf = item => Array.isArray(item?.lines) ? item.lines : Array.isArray(item?.items) ? item.items : [];
  const active = item => item && !item.deletedAt && !["ملغي", "ملغاة", "cancelled", "canceled", "reversed"].includes(String(item.status || "").toLowerCase());
  const deepClone = value => JSON.parse(JSON.stringify(value));
  const intersects = (values, set) => values.some(value => set.has(String(value || "")));
  const fieldRefs = item => [item?.orderId, item?.onlineOrderId, item?.invoiceId, item?.saleId, item?.shipmentId, item?.paymentId, item?.collectionId, item?.documentId, item?.entityId, item?.sourceId].filter(Boolean).map(String);

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
    const counts = Object.fromEntries(Object.entries(scope).map(([key, ids]) => [key, ids.size]));
    counts.reservations = reservationOrders.length;
    const uniqueBlocks = [...new Map(blockedRecords.map(item => [`${item.collection}:${item.id}:${item.reason}`, item])).values()];
    return {
      dryRun:true,
      approvedProductIds:[...approvedProductIds],
      detectedProductIds:[...demoProducts],
      counts,
      scope:Object.fromEntries(Object.entries(scope).map(([key, ids]) => [key, [...ids]])),
      reservationOrderIds:reservationOrders,
      blockedRecords:uniqueBlocks,
      executable:demoProducts.size > 0 && uniqueBlocks.length === 0
    };
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
    const previousAudit = list(db, "audit").find(item => item.operationKey === operationKey && item.operationType === "حذف البيانات التجريبية");
    if (previousAudit) return { db:deepClone(db), idempotent:true, audit:previousAudit, deleted:previousAudit.recordsDeleted || {} };
    const preview = buildDemoPreview(db, request);
    if (preview.blockedRecords.length) throw Object.assign(new Error("توجد سجلات مختلطة؛ تم منع الحذف."), { code:"MIXED_RECORDS_BLOCKED", blockedRecords:preview.blockedRecords });
    const next = deepClone(db);
    for (const [key, ids] of Object.entries(preview.scope)) {
      if (!Array.isArray(next[key]) || !ids.length) continue;
      const remove = new Set(ids.map(String));
      next[key] = next[key].filter((item, index) => !remove.has(idOf(item)) && !remove.has(rowKey(item, index)));
    }
    const orphans = orphanReport(next);
    if (Object.values(orphans).some(rows => rows.length)) throw Object.assign(new Error("Orphan Guard منع اعتماد العملية."), { code:"ORPHAN_GUARD_FAILED", orphans });
    const now = request.performedAt || new Date().toISOString();
    next.audit = Array.isArray(next.audit) ? next.audit : [];
    const audit = {
      id:`AUD-DEMO-PURGE-${operationKey}`, operationKey, operationType:"حذف البيانات التجريبية", action:"حذف مجموعة بيانات تجريبية مترابطة",
      previewCounts:preview.counts, selectedScope:preview.detectedProductIds, seasonId:request.seasonId || "", performedBy:request.performedBy,
      performedAt:now, createdAt:now, backupReference:request.backup.reference, recordsDeleted:preview.counts,
      recordsArchived:{}, recordsPreserved:{ customers:list(next,"customers").length, suppliers:list(next,"suppliers").length, users:list(next,"users").length, settings:1 }, result:"success", failureReason:""
    };
    next.audit.push(audit);
    return { db:next, idempotent:false, preview, deleted:preview.counts, audit, orphans };
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

  return { DEMO_PRODUCT_IDS, SEASON_LINKED_COLLECTIONS, buildDemoPreview, purgeDemoDataset, orphanReport, runtimeSeasons, activeSeason, openOperations, createSeason, closeSeason, linkNewRecordsToActiveSeason, assertBackupGuard };
});
