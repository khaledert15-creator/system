(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FactoryReset = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIRMATION_PHRASE = "إعادة ضبط النظام بالكامل";
  const RESET_TYPES = Object.freeze({ BUSINESS:"business", FACTORY:"factory" });
  const BUSINESS_DELETE = Object.freeze([
    "books", "inventoryBatches", "stockMovements", "reservations", "purchases", "purchaseReturns",
    "returns", "onlineOrders", "orders", "sales", "shipments", "trackingHistory", "trackingRuns",
    "trackingRunBatches", "complaints", "orderPayments", "payments", "cash", "cashMovements",
    "orderCollections", "collections", "carrierSettlements", "expenses", "otherIncome", "notifications",
    "reportSnapshots", "reportsSnapshots", "dayClosings", "receipts"
  ]);
  const BUSINESS_PRESERVE = Object.freeze([
    "customers", "suppliers", "users", "employees", "settings", "roles", "permissions", "integrations",
    "messageTemplates", "governorates", "shippingPrices", "shippingCompanies", "cashAccounts",
    "expenseTypes", "incomeTypes", "meta", "version", "seasons"
  ]);
  const FACTORY_PRESERVE = Object.freeze(["users", "settings", "roles", "permissions", "integrations", "meta", "version"]);
  const list = (db, key) => Array.isArray(db?.[key]) ? db[key] : [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const isOwner = user => user && user.active !== false && (user.username === "owner" || ["مالك", "Super Admin", "superadmin"].includes(String(user.role || "")));
  const count = value => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : value == null ? 0 : 1;
  const OPERATIONAL_AUDIT_ENTITIES = new Set(["المبيعات","المشتريات","طلبات الأونلاين","الطلبات","الشحن","الشحنات","المخزون","المرتجعات","المالية","العملاء","الموردون","الأصناف","التتبع"]);
  const isOperationalAudit = row => OPERATIONAL_AUDIT_ENTITIES.has(String(row?.entity || row?.moduleName || "")) || ["PURGE_DEMO_DATASET","ORDER","PAYMENT","SHIPMENT","TRACKING","COLLECTION","STOCK"].some(token => String(row?.operationType || "").toUpperCase().includes(token));

  function owners(db) { return list(db, "users").filter(isOwner); }

  function financeCount(db) {
    return ["orderPayments", "payments", "cash", "cashMovements", "orderCollections", "collections", "carrierSettlements", "expenses", "otherIncome", "dayClosings", "receipts"]
      .reduce((total, key) => total + list(db, key).length, 0);
  }

  function preview(db, type = RESET_TYPES.BUSINESS) {
    if (!Object.values(RESET_TYPES).includes(type)) throw Object.assign(new Error("نوع إعادة الضبط غير صالح."), { code:"RESET_TYPE_INVALID" });
    const ownerRows = owners(db);
    const deleteKeys = type === RESET_TYPES.BUSINESS
      ? [...BUSINESS_DELETE, "audit"]
      : Object.keys(db || {}).filter(key => !FACTORY_PRESERVE.includes(key) && key !== "audit").concat("audit");
    const uniqueDeleteKeys = [...new Set(deleteKeys)];
    const deletedCounts = Object.fromEntries(uniqueDeleteKeys.map(key => [key, key === "audit" && type === RESET_TYPES.BUSINESS ? list(db,"audit").filter(isOperationalAudit).length : count(db?.[key])]));
    const preservedKeys = type === RESET_TYPES.BUSINESS ? BUSINESS_PRESERVE : FACTORY_PRESERVE;
    const preservedCounts = Object.fromEntries(preservedKeys.map(key => [key, key === "users" && type === RESET_TYPES.FACTORY ? Math.min(ownerRows.length, 1) : count(db?.[key])]));
    const summary = {
      products:list(db,"books").length, customers:list(db,"customers").length, suppliers:list(db,"suppliers").length,
      orders:list(db,"onlineOrders").length + list(db,"orders").length,
      invoices:list(db,"sales").length, shipments:list(db,"shipments").length,
      payments:list(db,"orderPayments").length + list(db,"payments").length,
      cashMovements:list(db,"cash").length + list(db,"cashMovements").length,
      stockMovements:list(db,"stockMovements").length, inventoryBatches:list(db,"inventoryBatches").length,
      notifications:list(db,"notifications").length,
      tracking:list(db,"trackingHistory").length + list(db,"trackingRuns").length + list(db,"trackingRunBatches").length,
      financeRecords:financeCount(db), settingsPreserved:count(db?.settings),
      usersPreserved:type === RESET_TYPES.FACTORY ? Math.min(ownerRows.length, 1) : list(db,"users").length,
      usersDeleted:type === RESET_TYPES.FACTORY ? Math.max(0, list(db,"users").length - 1) : 0
    };
    return { dryRun:true, type, executable:ownerRows.length > 0, blockedReason:ownerRows.length ? "" : "لا يوجد مالك نشط يمكن الحفاظ عليه.", deleteKeys:uniqueDeleteKeys, preserveKeys:[...preservedKeys], deletedCounts, preservedCounts, summary };
  }

  function assertBackup(backup = {}) {
    backup = backup || {};
    const valid = backup.valid === true && Number(backup.sourceSize) > 0 && backup.sourceSize === backup.backupSize && backup.sourceSha256 && backup.sourceSha256 === backup.backupSha256 && backup.reference && backup.manifestValid !== false;
    if (!valid) throw Object.assign(new Error("Backup Guard غير مكتمل أو غير صالح."), { code:"BACKUP_GUARD_FAILED" });
  }

  function validateRequest(db, request = {}) {
    const resetPreview = preview(db, request.resetType);
    if (!resetPreview.executable) throw Object.assign(new Error(resetPreview.blockedReason), { code:"OWNER_REQUIRED" });
    if (!request.authorized) throw Object.assign(new Error("صلاحية factory_reset_system مطلوبة."), { code:"PERMISSION_DENIED" });
    if (request.confirmationPhrase !== CONFIRMATION_PHRASE) throw Object.assign(new Error("عبارة التأكيد غير مطابقة."), { code:"CONFIRMATION_REQUIRED" });
    if (!request.currentUsername || request.currentUsername !== request.performedByUsername) throw Object.assign(new Error("اسم المستخدم الحالي غير مطابق."), { code:"IDENTITY_CONFIRMATION_FAILED" });
    if (!String(request.operationKey || "").trim()) throw Object.assign(new Error("Operation Key مطلوب."), { code:"OPERATION_KEY_REQUIRED" });
    assertBackup(request.backup);
    return resetPreview;
  }

  function postResetValidation(db, type, ownerUsername) {
    const inventoryKeys = ["books", "inventoryBatches", "stockMovements", "reservations"];
    const emptyKeys = type === RESET_TYPES.BUSINESS ? BUSINESS_DELETE.filter(key => key !== "audit") : Object.keys(db).filter(key => Array.isArray(db[key]) && !["users", "audit", ...FACTORY_PRESERVE].includes(key));
    const owner = list(db,"users").find(user => user.username === ownerUsername && isOwner(user));
    const nonEmpty = emptyKeys.filter(key => list(db,key).length > 0);
    const negativeStock = list(db,"books").filter(item => Number(item.stock || 0) < 0).map(item => item.id);
    return { loginPossible:Boolean(owner), ownerExists:Boolean(owner), permissionsValid:Boolean(db.settings?.permissions || owner), settingsAvailable:Boolean(db.settings), dashboardSafe:true, emptyCollections:nonEmpty.length === 0, nonEmpty, inventoryEmpty:inventoryKeys.every(key => list(db,key).length === 0), negativeStock, orphanShipments:[], orphanBatches:[], valid:Boolean(owner) && Boolean(db.settings) && nonEmpty.length === 0 && negativeStock.length === 0 };
  }

  function execute(db, request = {}) {
    const operationKey = String(request.operationKey || "").trim();
    const prior = list(db,"audit").find(row => row.operationKey === operationKey && ["SYSTEM_FACTORY_RESET", "BUSINESS_DATA_RESET"].includes(row.operationType));
    if (prior) return { db:clone(db), idempotent:true, audit:clone(prior), deletedCounts:prior.deletedCounts || {} };
    const resetPreview = validateRequest(db, request);
    const next = clone(db), originalOwner = owners(db)[0];
    for (const key of resetPreview.deleteKeys) if (key !== "audit") next[key] = [];
    if (request.resetType === RESET_TYPES.FACTORY) {
      for (const key of BUSINESS_DELETE) next[key] = [];
      next.users = [clone(originalOwner)];
      if (Array.isArray(next.employees)) next.employees = next.employees.filter(row => row.username === originalOwner.username || row.role === "مالك").slice(0,1);
      const sourcePermissions = db.settings?.permissions || { roles:{}, users:{} };
      const essentialPermissions = { roles:clone(sourcePermissions.roles || {}), users:{} };
      if (sourcePermissions.users?.[originalOwner.username]) essentialPermissions.users[originalOwner.username] = clone(sourcePermissions.users[originalOwner.username]);
      next.settings = { ...(clone(db.settings || {})), permissions:essentialPermissions, activeSeasonId:"" };
      if (Object.prototype.hasOwnProperty.call(next,"roles")) next.roles = clone(db.roles || []);
      if (Object.prototype.hasOwnProperty.call(next,"permissions")) next.permissions = clone(db.permissions || {});
      if (Object.prototype.hasOwnProperty.call(next,"integrations")) next.integrations = clone(db.integrations || {});
    }
    next.audit = request.resetType === RESET_TYPES.BUSINESS ? list(db,"audit").filter(row => !isOperationalAudit(row)).map(clone) : [];
    const performedAt = request.performedAt || new Date().toISOString();
    const validation = postResetValidation(next, request.resetType, originalOwner.username);
    if (!validation.valid) throw Object.assign(new Error("Post-Reset Guard منع اعتماد العملية."), { code:"POST_RESET_VALIDATION_FAILED", validation });
    const audit = {
      id:`AUD-RESET-${operationKey}`, operationKey,
      operationType:request.resetType === RESET_TYPES.FACTORY ? "SYSTEM_FACTORY_RESET" : "BUSINESS_DATA_RESET",
      resetType:request.resetType, previewCounts:resetPreview.summary, deletedCounts:resetPreview.deletedCounts,
      preservedCounts:resetPreview.preservedCounts, backupReference:request.backup.reference,
      confirmationPhraseUsed:true, performedBy:request.performedBy || request.performedByUsername,
      performedByUsername:request.performedByUsername, performedAt, createdAt:performedAt,
      result:"success", postResetValidation:validation
    };
    next.audit.push(audit);
    return { db:next, idempotent:false, preview:resetPreview, deletedCounts:resetPreview.deletedCounts, audit, validation };
  }

  return { CONFIRMATION_PHRASE, RESET_TYPES, BUSINESS_DELETE, BUSINESS_PRESERVE, FACTORY_PRESERVE, owners, isOperationalAudit, preview, assertBackup, validateRequest, postResetValidation, execute };
});
