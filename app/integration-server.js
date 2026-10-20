"use strict";

// HTTP side of the Store ↔ System ↔ Chatwood integration (INTEGRATION_DOCS/INTEGRATION_API_SPEC.md §2, §5).
// server-node.js only dispatches to handle() and injects its own helpers; no business rule lives here.
//   HMAC (Store → System):  GET /api/integration/v1/catalog | /events (SSE) | /website-orders/links
//   Staff (X-Session-Token): /api/website-orders..., PUT /api/settings/website-deposit, /api/integration/v1/panel/...,
//                            GET|POST /api/orders/:id/split-shipment (partial shipping, Option B),
//                            PATCH /api/orders/:id/deposit-required, PUT /api/website-orders/:number/deposit
//   Chatwood dashboard app:  GET /integrations/chatwood-panel (frame-ancestors limited to CHATWOOD_ORIGIN)
const fs = require("fs");
const path = require("path");
const IntegrationAuth = require("./integration-auth.js");
const WebsiteOrders = require("./website-orders.js");
const SplitShipment = require("./split-shipment.js");

const BODY_LIMIT_INTEGRATION = 64 * 1024;
const MAX_EVENT_STREAMS = 8;
const NO_STORE = { "Cache-Control":"no-store" };
const JSON_TYPE = "application/json; charset=utf-8";

function createIntegrationServer(deps) {
  const { config, send, readBody, readJsonBody, readDb, readDbForWrite, writeDb, ensureTrackingDb, dbRevision, sessionUser, canOrderAction, orderRole, liveClients, baseSecurityHeaders, frameAncestorHeaders, appRoot, isInsideDirectory, AuditIds, logger = event => console.log(JSON.stringify({ timestamp:new Date().toISOString(), ...event })) } = deps;
  const nonceCache = IntegrationAuth.createNonceCache();
  const splitShipment = SplitShipment.createSplitShipment(deps);
  const websiteOrders = WebsiteOrders.createWebsiteOrders({ ...deps, splitShipment });
  let eventStreams = 0;

  const fail = (res, status, code, message, extra = {}) => send(res, status, { ok:false, code, message, ...extra }, JSON_TYPE, NO_STORE);
  const disabled = res => fail(res, 503, "INTEGRATION_DISABLED", "التكامل غير مفعّل");
  const storeUnavailable = (res, detail = {}) => fail(res, 502, "STORE_UNAVAILABLE", "تعذر الوصول إلى المتجر الآن؛ لم يتم حفظ أي شيء. حاول مرة أخرى.", detail);
  const errorResponse = (res, error, fallbackCode) => fail(res, error.status, error.code || fallbackCode, error.message, error.details || {});

  // ---- Store client (System → Store, §3). Any network error, timeout or non-JSON reply is STORE_UNAVAILABLE.
  async function storeRequest(method, pathWithQuery, body, timeoutMs = config.storeTimeoutMs) {
    if (!config.storeEnabled) throw Object.assign(new Error("Store integration is not configured"), { code:"INTEGRATION_DISABLED" });
    const raw = body === undefined ? "" : JSON.stringify(body);
    const headers = { Accept:"application/json", ...IntegrationAuth.signedHeaders({ secret:config.signingSecret, keyId:config.keyId, method, pathWithQuery, body:raw }) };
    if (raw) headers["Content-Type"] = "application/json";
    let response;
    try { response = await fetch(`${config.storeBaseUrl}${pathWithQuery}`, { method, headers, body:raw || undefined, redirect:"error", signal:AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw Object.assign(new Error("Store request failed"), { code:"STORE_UNAVAILABLE", reason:error?.name === "TimeoutError" ? "timeout" : "network" }); }
    let parsed = null;
    try { parsed = await response.json(); } catch { throw Object.assign(new Error("Store response is not JSON"), { code:"STORE_UNAVAILABLE", reason:"invalid_response", storeStatus:response.status }); }
    return { status:response.status, body:parsed };
  }

  const logStore = (operationType, details) => logger({ operationType, ...details });

  async function fetchStoreOrder(number) {
    const result = await storeRequest("GET", `/api/integration/v1/orders/${encodeURIComponent(number)}`);
    if (result.status === 404) return { notFound:true };
    if (result.status !== 200 || !result.body?.ok || !result.body.order || result.body.order.orderNumber !== number) {
      logStore("STORE_ORDER_FETCH_FAILED", { orderNumber:number, storeStatus:result.status, code:result.body?.code || "" });
      throw Object.assign(new Error("Unexpected Store response"), { code:"STORE_UNAVAILABLE", storeStatus:result.status });
    }
    return { order:result.body.order };
  }

  async function fetchStoreOrders({ state = "pending", phone = "", conversationId = "", limit = 100 } = {}) {
    const query = new URLSearchParams({ state, limit:String(limit) });
    if (phone) query.set("phone", phone);
    if (conversationId) query.set("conversationId", conversationId);
    const result = await storeRequest("GET", `/api/integration/v1/orders?${query}`);
    if (result.status !== 200 || !result.body?.ok || !Array.isArray(result.body.orders)) {
      logStore("STORE_ORDERS_FETCH_FAILED", { storeStatus:result.status, code:result.body?.code || "" });
      throw Object.assign(new Error("Unexpected Store response"), { code:"STORE_UNAVAILABLE", storeStatus:result.status });
    }
    return result.body.orders.filter(order => order && typeof order.orderNumber === "string" && WebsiteOrders.WEBSITE_ORDER_NUMBER_PATTERN.test(order.orderNumber));
  }

  // Best effort: the Store also reconciles through GET /website-orders/links, so a failure here is not an error.
  async function notifySalesLink(order, user) {
    try {
      const result = await storeRequest("POST", `/api/integration/v1/orders/${encodeURIComponent(order.websiteOrderNumber)}/sales-link`, websiteOrders.salesLinkBody(order, user), config.storeNotifyTimeoutMs);
      const ok = result.status === 200 && result.body?.ok === true;
      if (!ok) logStore("STORE_SALES_LINK_REJECTED", { orderNumber:order.websiteOrderNumber, salesOrderId:order.id, storeStatus:result.status, code:result.body?.code || "" });
      return ok;
    } catch (error) {
      logStore("STORE_SALES_LINK_FAILED", { orderNumber:order.websiteOrderNumber, salesOrderId:order.id, reason:error.reason || error.code || "error" });
      return false;
    }
  }

  // ---- Service authentication for Store → System calls (§1).
  async function verifiedPeer(req, res) {
    if (!config.enabled) { disabled(res); return false; }
    let body = "";
    try { body = await readBody(req, BODY_LIMIT_INTEGRATION); }
    catch (error) { fail(res, error.status || 400, error.code || "INVALID_REQUEST", error.message); return false; }
    const result = IntegrationAuth.verifyRequest({ headers:req.headers, method:req.method, pathWithQuery:req.url, body, secrets:config.secrets, acceptedKeyIds:[config.peerKeyId], nonceCache });
    if (!result.ok) {
      logger({ operationType:"INTEGRATION_AUTH_REJECTED", reason:result.reason, path:String(req.url || "").split("?")[0] });
      fail(res, 401, "INTEGRATION_AUTH_FAILED", "مصادقة التكامل فشلت");
      return false;
    }
    return true;
  }

  function sessionOrFail(res, req) {
    const user = sessionUser(req);
    if (!user) fail(res, 401, "AUTHENTICATION_REQUIRED", "انتهت جلسة الدخول، سجّل الدخول مرة أخرى.");
    return user;
  }

  function readDbSafe() {
    try { return readDb(); } catch { return { settings:{} }; }
  }

  function revisionOf(db) {
    return String(Math.max(0, Number(db?.meta?.dataRevision || 0)));
  }

  function eventStream(req, res) {
    if (eventStreams >= MAX_EVENT_STREAMS) return fail(res, 429, "TOO_MANY_STREAMS", "عدد اتصالات الأحداث كبير.");
    eventStreams += 1;
    res.writeHead(200, { ...baseSecurityHeaders, "Content-Type":"text/event-stream; charset=utf-8", "Cache-Control":"no-store, no-transform", Connection:"keep-alive", "X-Accel-Buffering":"no" });
    res.flushHeaders();
    const write = revision => {
      if (res.destroyed || res.writableEnded) return;
      try { res.write(`event: revision\ndata: ${JSON.stringify({ revision:String(revision ?? dbRevision()) })}\n\n`); } catch {}
    };
    // writeDb publishes to every live client after each successful save, passing the new revision.
    const client = { integration:true, publish:revision => write(revision) };
    liveClients.add(client);
    write(dbRevision());
    const heartbeat = setInterval(() => write(dbRevision()), 15000);
    res.on("close", () => { clearInterval(heartbeat); liveClients.delete(client); eventStreams -= 1; });
  }

  function chatwoodPanel(res) {
    const file = path.join(appRoot, "integrations", "chatwood-panel.html");
    if (!isInsideDirectory(appRoot, file) || !fs.existsSync(file)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const origin = config.chatwoodOrigin.replace(/[&<>"']/g, "");
    const html = fs.readFileSync(file, "utf8").replace("</head>", `  <meta name="chatwood-origin" content="${origin}">\n</head>`);
    return send(res, 200, html, "text/html; charset=utf-8", { ...frameAncestorHeaders([config.chatwoodOrigin]), "Cache-Control":"no-store" });
  }

  async function approve(req, res, number) {
    const user = sessionOrFail(res, req); if (!user) return;
    if (!WebsiteOrders.WEBSITE_ORDER_NUMBER_PATTERN.test(number)) return fail(res, 400, "INVALID_ORDER_NUMBER", "رقم طلب الموقع غير صحيح.");
    const payload = await readJsonBody(req, BODY_LIMIT_INTEGRATION);
    const before = readDb();
    if (!canOrderAction(before, user, "order.website.approve")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية اعتماد طلبات الموقع.");
    if (!config.storeEnabled) return disabled(res);
    // A retry of an approval that already happened succeeds even while the Store is down (and re-notifies it).
    const already = websiteOrders.findWebsiteOrder(before, number);
    if (already) return send(res, 200, { ok:true, order:already, existing:true, revision:revisionOf(before), storeNotified:await notifySalesLink(already, user) }, JSON_TYPE, NO_STORE);
    // 1. The Store order is the source of the preliminary order. Store down → explicit failure, nothing written.
    let fetched;
    try { fetched = await fetchStoreOrder(number); }
    catch (error) { return storeUnavailable(res, error.storeStatus ? { storeStatus:error.storeStatus } : {}); }
    if (fetched.notFound) return fail(res, 404, "WEBSITE_ORDER_NOT_FOUND", "طلب الموقع غير موجود.");
    // 2. One synchronous block: read → validate → mutate → write(expectedRevision). No await in between.
    const { db, revision } = readDbForWrite();
    ensureTrackingDb(db);
    let result;
    try { result = websiteOrders.approve(db, fetched.order, payload, user, new Date()); }
    catch (error) { if (error.status) return errorResponse(res, error, "WEBSITE_ORDER_APPROVAL_FAILED"); throw error; }
    if (result.existing) return send(res, 200, { ok:true, order:result.order, existing:true, revision:String(revision), storeNotified:await notifySalesLink(result.order, user) }, JSON_TYPE, NO_STORE);
    let saved;
    try { saved = writeDb(db, { expectedRevision:revision, operationType:"WEBSITE_ORDER_APPROVED", performedBy:user.username }); }
    catch (error) {
      if (error.code === "DATABASE_WRITE_BLOCKED_STALE_REVISION") return fail(res, 409, "DB_REVISION_CONFLICT", "تغيرت البيانات أثناء الاعتماد؛ أعد المحاولة.", { revision:String(error.currentRevision ?? "") });
      throw error;
    }
    logger({ operationType:"WEBSITE_ORDER_APPROVED", websiteOrderNumber:number, salesOrderId:result.order.id, workflowStage:result.order.workflowStage, splitChildOrderId:result.child?.id || null, performedBy:user.username });
    // 3. Tell the Store (short timeout). The Store's periodic links reconciliation covers a failure.
    const storeNotified = await notifySalesLink(result.order, user);
    return send(res, 201, { ok:true, order:result.order, ...(result.child ? { child:result.child } : {}), revision:String(saved.revision), storeNotified }, JSON_TYPE, { ...NO_STORE, "X-DB-Revision":String(saved.revision) });
  }

  async function websiteDeposit(req, res) {
    const user = sessionOrFail(res, req); if (!user) return;
    // Owner and manager always; any other role only when granted order.deposit.default.
    if (!canOrderAction(readDbSafe(), user, "order.deposit.default")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية تعديل العربون الافتراضي.");
    const payload = await readJsonBody(req, 16 * 1024);
    const expected = payload.expectedRevision ?? req.headers["x-db-revision"] ?? req.headers["if-match"];
    if (expected === undefined || expected === null || expected === "") return fail(res, 428, "PRECONDITION_REQUIRED", "حدّث الصفحة ثم أعد المحاولة: الحفظ يحتاج رقم نسخة البيانات.");
    let amount;
    try { amount = WebsiteOrders.parseDepositDefault(payload.depositDefault ?? payload.amount); } catch (error) { return errorResponse(res, error, "DEPOSIT_DEFAULT_INVALID"); }
    const { db, revision } = readDbForWrite();
    if (String(expected) !== String(revision)) return fail(res, 409, "DB_REVISION_CONFLICT", "تغيرت البيانات من مكان آخر؛ حدّث الصفحة ثم أعد المحاولة.", { revision:String(revision) });
    const previous = WebsiteOrders.depositDefault(db);
    if (previous === amount && db.settings?.websiteOrders?.depositDefault !== undefined) return send(res, 200, { ok:true, unchanged:true, depositDefault:amount, revision:String(revision) }, JSON_TYPE, { ...NO_STORE, "X-DB-Revision":String(revision) });
    const now = new Date().toISOString();
    db.settings = db.settings || {};
    const change = { at:now, by:user.name || user.username, username:user.username, before:previous, after:amount };
    db.settings.websiteOrders = { ...(db.settings.websiteOrders || {}), depositDefault:amount, updatedAt:now, updatedBy:user.username, history:[change, ...((db.settings.websiteOrders || {}).history || [])].slice(0, 50) };
    db.audit = Array.isArray(db.audit) ? db.audit : [];
    AuditIds.appendAuditRecord(db.audit, { date:now, createdAt:now, operationType:"WEBSITE_DEPOSIT_DEFAULT_CHANGED", action:"تعديل العربون الافتراضي لطلبات الموقع", entity:"الإعدادات", entityId:"WEBSITE-DEPOSIT", user:user.name || user.username, username:user.username, role:user.role, before:previous, after:amount, details:`${previous} ← ${amount} (للطلبات الجديدة فقط)` });
    const saved = writeDb(db, { expectedRevision:revision, operationType:"WEBSITE_DEPOSIT_DEFAULT_CHANGED", performedBy:user.username });
    return send(res, 200, { ok:true, depositDefault:amount, previous, revision:String(saved.revision) }, JSON_TYPE, { ...NO_STORE, "X-DB-Revision":String(saved.revision) });
  }

  async function panelCustomer(req, res, url) {
    const user = sessionOrFail(res, req); if (!user) return;
    const db = readDbSafe();
    if (!canOrderAction(db, user, "panel.view")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية عرض بيانات العميل.");
    if (!config.enabled) return disabled(res);
    const rawPhone = url.searchParams.get("phone") || "";
    const phone = websiteOrders.normalizeEgyptPhone(rawPhone);
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (conversationId && !/^\d{1,18}$/.test(conversationId)) return fail(res, 400, "INVALID_CONVERSATION", "رقم المحادثة غير صحيح.");
    // A contact without a usable Egyptian mobile (WhatsApp username, foreign number) is still matched by conversation.
    if (rawPhone && !phone && !conversationId) return fail(res, 400, "INVALID_PHONE", "رقم هاتف العميل غير صالح.");
    if (!phone && !conversationId) return fail(res, 400, "CUSTOMER_NOT_IDENTIFIED", "لا يوجد رقم هاتف أو محادثة للتعرف على العميل.");
    let storeOrders = [], storeAvailable = false;
    if (config.storeEnabled) {
      try { storeOrders = await fetchStoreOrders({ state:"all", phone, conversationId, limit:100 }); storeAvailable = true; } catch {}
    }
    const fresh = readDbSafe();
    return send(res, 200, { ok:true, ...websiteOrders.panelCustomer(fresh, phone, storeOrders, { conversationId, config }), storeAvailable, storeEnabled:Boolean(config.storeEnabled), phoneUsable:Boolean(phone), conversationId:conversationId || null }, JSON_TYPE, NO_STORE);
  }

  async function panelLink(req, res) {
    const user = sessionOrFail(res, req); if (!user) return;
    const payload = await readJsonBody(req, 16 * 1024);
    if (!canOrderAction(readDbSafe(), user, "panel.link")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية ربط المحادثة بطلب.");
    if (!config.storeEnabled) return disabled(res);
    const orderNumber = String(payload.orderNumber || "").trim().toUpperCase();
    const conversationId = String(payload.conversationId ?? "").trim();
    const contactPhone = websiteOrders.normalizeEgyptPhone(payload.contactPhone || "");
    if (!WebsiteOrders.WEBSITE_ORDER_NUMBER_PATTERN.test(orderNumber)) return fail(res, 400, "INVALID_ORDER_NUMBER", "اختر طلب موقع واحدًا لربطه.");
    if (!/^\d{1,18}$/.test(conversationId)) return fail(res, 400, "INVALID_CONVERSATION", "رقم المحادثة غير صحيح.");
    if (!contactPhone) return fail(res, 400, "INVALID_PHONE", "رقم هاتف جهة الاتصال غير صالح.");
    let result;
    try { result = await storeRequest("POST", `/api/integration/v1/orders/${encodeURIComponent(orderNumber)}/conversation`, { conversationId, contactPhone, linkedBy:user.username }); }
    catch { return storeUnavailable(res); }
    if (result.status !== 200 || result.body?.ok !== true) {
      // The Store's own decisions (phone mismatch, already linked, not found) are passed through as-is.
      if ([400, 404, 409].includes(result.status) && result.body?.code) return fail(res, result.status, result.body.code, result.body.message || "رفض المتجر الربط.");
      return storeUnavailable(res, { storeStatus:result.status });
    }
    // Mirror the link on the System order made from this website order (never overwriting a different conversation).
    let systemOrderId = null, systemUpdated = false, systemConflict = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { db, revision } = readDbForWrite();
      const order = websiteOrders.findWebsiteOrder(db, orderNumber);
      if (!order) break;
      systemOrderId = order.id;
      if (String(order.chatwootConversationId || "") === conversationId) break;
      if (order.chatwootConversationId) { systemConflict = true; break; }
      const now = new Date().toISOString();
      Object.assign(order, { chatwootConversationId:conversationId, updatedAt:now });
      deps.appendOrderAudit(db, user, order, "ربط الطلب بمحادثة Chatwood", `${orderNumber} · محادثة ${conversationId}`);
      try { writeDb(db, { expectedRevision:revision, operationType:"ORDER_CONVERSATION_LINKED", performedBy:user.username }); systemUpdated = true; break; }
      catch (error) { if (error.code !== "DATABASE_WRITE_BLOCKED_STALE_REVISION") throw error; }
    }
    return send(res, 200, { ok:true, existing:result.body.existing === true, orderNumber, conversationId, systemOrderId, systemUpdated, systemConflict }, JSON_TYPE, NO_STORE);
  }

  // Suggested fee for the second shipment: what the customer was quoted on the website, else the governorate rate
  // for the books that wait.
  function suggestedSplitFee(db, order, preview) {
    const quoted = Number(order.websiteSplitExtraShippingFee);
    if (order.websiteSplitExtraShippingFee != null && Number.isFinite(quoted) && quoted >= 0) return { amount:quoted, source:"website" };
    if (typeof deps.automaticShippingFee !== "function") return { amount:null, source:"" };
    const lines = splitShipment.partitionLines(order, splitShipment.availableNow(db, order)).later;
    try { return { amount:deps.automaticShippingFee(db, order.governorate || "", lines), source:"governorate" }; } catch { return { amount:null, source:"" }; }
  }

  async function splitShipmentRoute(req, res, id) {
    const user = sessionOrFail(res, req); if (!user) return;
    if (req.method === "GET") {
      const db = readDbSafe();
      const order = (db.onlineOrders || []).find(item => item.id === id && !item.deletedAt);
      if (!order) return fail(res, 404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
      const preview = splitShipment.preview(db, order);
      return send(res, 200, { ok:true, orderId:order.id, workflowStage:order.workflowStage, ...preview, alreadySplit:Boolean(order.splitShipment?.childOrderIds?.length), splitPart:order.splitPart || null,
        suggestedFee:suggestedSplitFee(db, order, preview), websitePreference:order.websiteSplitShipmentPreference || "", canSplit:canOrderAction(db, user, "order.split.shipment"), revision:revisionOf(db) }, JSON_TYPE, NO_STORE);
    }
    const payload = await readJsonBody(req, 16 * 1024);
    const { db, revision } = readDbForWrite();
    ensureTrackingDb(db);
    if (!canOrderAction(db, user, "order.split.shipment")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية تقسيم شحن الطلبات.");
    const order = (db.onlineOrders || []).find(item => item.id === id && !item.deletedAt);
    // A retry after a successful split returns the same parts.
    if (order?.splitShipment?.childOrderIds?.length) {
      const child = (db.onlineOrders || []).find(item => item.id === order.splitShipment.childOrderIds[0]) || null;
      return send(res, 200, { ok:true, existing:true, order, child, revision:String(revision) }, JSON_TYPE, NO_STORE);
    }
    let result;
    try { result = splitShipment.split(db, order, payload, user, new Date()); }
    catch (error) { if (error.status) return errorResponse(res, error, "SPLIT_SHIPMENT_FAILED"); throw error; }
    let saved;
    try { saved = writeDb(db, { expectedRevision:revision, operationType:"ORDER_SPLIT_SHIPMENT", performedBy:user.username }); }
    catch (error) {
      if (error.code === "DATABASE_WRITE_BLOCKED_STALE_REVISION") return fail(res, 409, "DB_REVISION_CONFLICT", "تغيرت البيانات أثناء التقسيم؛ أعد المحاولة.", { revision:String(error.currentRevision ?? "") });
      throw error;
    }
    logger({ operationType:"ORDER_SPLIT_SHIPMENT", orderId:result.order.id, childOrderId:result.child.id, websiteOrderNumber:result.order.websiteOrderNumber || "", performedBy:user.username });
    return send(res, 201, { ok:true, order:result.order, child:result.child, revision:String(saved.revision) }, JSON_TYPE, { ...NO_STORE, "X-DB-Revision":String(saved.revision) });
  }

  // Required deposit of one order, apart from the default and from what was paid. Payments, cash and totals never
  // change here. Website orders before approval live in the Store; after approval the System order is the record.
  function parseRequiredDeposit(payload, total) {
    const amount = Number(String(payload.amount ?? payload.depositRequired ?? "").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    if (payload.amount === "" || payload.amount == null || !Number.isFinite(amount) || amount < 0 || amount > WebsiteOrders.DEPOSIT_MAX) throw Object.assign(new Error(`العربون المطلوب يجب أن يكون رقمًا من 0 إلى ${WebsiteOrders.DEPOSIT_MAX} ج.م.`), { status:400, code:"DEPOSIT_INVALID" });
    const rounded = Math.round(amount * 100) / 100;
    if (Number.isFinite(total) && rounded > total) throw Object.assign(new Error("العربون المطلوب لا يمكن أن يتجاوز إجمالي الطلب."), { status:409, code:"DEPOSIT_EXCEEDS_TOTAL", details:{ total } });
    const reason = String(payload.reason || "").trim().slice(0, 300);
    if (reason.length < 3) throw Object.assign(new Error("اكتب سبب تعديل العربون."), { status:400, code:"DEPOSIT_REASON_REQUIRED" });
    return { amount:rounded, reason };
  }

  async function websiteOrderDeposit(req, res, number) {
    const user = sessionOrFail(res, req); if (!user) return;
    if (!WebsiteOrders.WEBSITE_ORDER_NUMBER_PATTERN.test(number)) return fail(res, 400, "INVALID_ORDER_NUMBER", "رقم طلب الموقع غير صحيح.");
    const payload = await readJsonBody(req, 16 * 1024);
    if (!canOrderAction(readDbSafe(), user, "order.deposit.override")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية تعديل عربون طلب.");
    if (!config.storeEnabled) return disabled(res);
    if (websiteOrders.findWebsiteOrder(readDbSafe(), number)) return fail(res, 409, "WEBSITE_ORDER_APPROVED", "الطلب معتمد بالفعل؛ عدّل العربون من طلب السيستم.");
    let fetched;
    try { fetched = await fetchStoreOrder(number); } catch (error) { return storeUnavailable(res, error.storeStatus ? { storeStatus:error.storeStatus } : {}); }
    if (fetched.notFound) return fail(res, 404, "WEBSITE_ORDER_NOT_FOUND", "طلب الموقع غير موجود.");
    let input;
    try { input = parseRequiredDeposit(payload, Number(fetched.order.total)); } catch (error) { return errorResponse(res, error, "DEPOSIT_INVALID"); }
    let result;
    try { result = await storeRequest("PATCH", `/api/integration/v1/orders/${encodeURIComponent(number)}/deposit-required`, { requiredAmount:input.amount, reason:input.reason, changedBy:user.username }); }
    catch { return storeUnavailable(res); }
    if (result.status !== 200 || result.body?.ok !== true) {
      if ([400, 404, 409, 422].includes(result.status) && result.body?.code) return fail(res, result.status, result.body.code, result.body.message || "رفض المتجر التعديل.");
      return storeUnavailable(res, { storeStatus:result.status });
    }
    // The System keeps who changed it as well (the Store keeps its own audit row with before/after).
    if (!result.body.existing) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { db, revision } = readDbForWrite();
        const now = new Date().toISOString();
        db.audit = Array.isArray(db.audit) ? db.audit : [];
        AuditIds.appendAuditRecord(db.audit, { date:now, createdAt:now, operationType:"WEBSITE_ORDER_DEPOSIT_CHANGED", action:"تعديل العربون المطلوب لطلب موقع", entity:"طلبات الموقع", entityId:number, user:user.name || user.username, username:user.username, role:user.role, before:result.body.previous ?? null, after:input.amount, details:`${result.body.previous ?? "—"} ← ${input.amount} · ${input.reason}` });
        try { writeDb(db, { expectedRevision:revision, operationType:"WEBSITE_ORDER_DEPOSIT_CHANGED", performedBy:user.username }); break; }
        catch (error) { if (error.code !== "DATABASE_WRITE_BLOCKED_STALE_REVISION") throw error; }
      }
    }
    return send(res, 200, { ok:true, existing:result.body.existing === true, previous:result.body.previous ?? null, depositRequired:input.amount, order:result.body.order }, JSON_TYPE, NO_STORE);
  }

  async function systemOrderDeposit(req, res, id) {
    const user = sessionOrFail(res, req); if (!user) return;
    const payload = await readJsonBody(req, 16 * 1024);
    const { db, revision } = readDbForWrite();
    ensureTrackingDb(db);
    if (!canOrderAction(db, user, "order.deposit.override")) return fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية تعديل عربون طلب.");
    const order = (db.onlineOrders || []).find(item => item.id === id && !item.deletedAt);
    if (!order) return fail(res, 404, "ORDER_NOT_FOUND", "الطلب غير موجود.");
    if (["cancelled", "delivered", "returned"].includes(order.workflowStage) || ["ملغي", "تم التسليم"].includes(order.status)) return fail(res, 409, "ORDER_CLOSED", "لا يمكن تعديل عربون طلب ملغي أو مسلّم.");
    let input;
    try { input = parseRequiredDeposit(payload, Number(order.total || 0)); } catch (error) { return errorResponse(res, error, "DEPOSIT_INVALID"); }
    const previous = websiteOrders.depositRequiredOf(order);
    if (previous === input.amount) return send(res, 200, { ok:true, existing:true, order, revision:String(revision) }, JSON_TYPE, NO_STORE);
    const now = new Date().toISOString();
    order.depositRequired = input.amount;
    if (order.deposit && typeof order.deposit === "object") order.deposit.required = input.amount;
    order.depositHistory = [...(Array.isArray(order.depositHistory) ? order.depositHistory : []), { at:now, by:user.name || user.username, username:user.username, before:previous, after:input.amount, reason:input.reason }];
    order.updatedAt = now;
    deps.appendOrderAudit(db, user, order, "تعديل العربون المطلوب", `${previous ?? "—"} ← ${input.amount} ج.م · ${input.reason} (المدفوع بدون تغيير: ${Number(order.paidAmount || 0)} ج.م)`);
    let saved;
    try { saved = writeDb(db, { expectedRevision:revision, operationType:"ORDER_DEPOSIT_REQUIRED_CHANGED", performedBy:user.username }); }
    catch (error) {
      if (error.code === "DATABASE_WRITE_BLOCKED_STALE_REVISION") return fail(res, 409, "DB_REVISION_CONFLICT", "تغيرت البيانات أثناء الحفظ؛ أعد المحاولة.");
      throw error;
    }
    return send(res, 200, { ok:true, order, previous, revision:String(saved.revision) }, JSON_TYPE, { ...NO_STORE, "X-DB-Revision":String(saved.revision) });
  }

  // Returns true when the request was handled here.
  async function handle(req, res, route, url) {
    const method = req.method;
    if (route === "/integrations/chatwood-panel" && method === "GET") { chatwoodPanel(res); return true; }

    if (route.startsWith("/api/integration/v1/panel/")) {
      if (route === "/api/integration/v1/panel/customer" && method === "GET") await panelCustomer(req, res, url);
      else if (route === "/api/integration/v1/panel/link-conversation" && method === "POST") await panelLink(req, res);
      else fail(res, 404, "NOT_FOUND", "API route not found.");
      return true;
    }

    if (route.startsWith("/api/integration/")) {
      if (!(await verifiedPeer(req, res))) return true;
      if (method === "GET" && route === "/api/integration/v1/catalog") {
        const { db, revision } = readDbForWrite();
        send(res, 200, websiteOrders.catalogSnapshot(db, revision), JSON_TYPE, NO_STORE);
      } else if (method === "GET" && route === "/api/integration/v1/events") {
        eventStream(req, res);
      } else if (method === "GET" && route === "/api/integration/v1/website-orders/links") {
        const { db, revision } = readDbForWrite();
        try { send(res, 200, websiteOrders.orderLinks(db, revision, url.searchParams.get("updatedSince") || ""), JSON_TYPE, NO_STORE); }
        catch (error) { if (error.status) errorResponse(res, error, "INVALID_QUERY"); else throw error; }
      } else fail(res, 404, "NOT_FOUND", "API route not found.");
      return true;
    }

    if (route === "/api/settings/website-deposit" && method === "PUT") { await websiteDeposit(req, res); return true; }

    const depositRoute = route.match(/^\/api\/orders\/([^/]+)\/deposit-required$/);
    if (depositRoute && method === "PATCH") { await systemOrderDeposit(req, res, depositRoute[1]); return true; }
    const websiteDepositRoute = route.match(/^\/api\/website-orders\/([^/]+)\/deposit$/);
    if (websiteDepositRoute && method === "PUT") { await websiteOrderDeposit(req, res, websiteDepositRoute[1]); return true; }

    const splitRoute = route.match(/^\/api\/orders\/([^/]+)\/split-shipment$/);
    if (splitRoute && ["GET", "POST"].includes(method)) { await splitShipmentRoute(req, res, splitRoute[1]); return true; }

    if (route === "/api/website-orders" && method === "GET") {
      const user = sessionOrFail(res, req); if (!user) return true;
      if (!canOrderAction(readDbSafe(), user, "order.website.view")) { fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية عرض طلبات الموقع."); return true; }
      if (!config.storeEnabled) { disabled(res); return true; }
      const state = url.searchParams.get("state") === "all" ? "all" : "pending";
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      let orders;
      try { orders = await fetchStoreOrders({ state, limit }); } catch (error) { storeUnavailable(res, error.storeStatus ? { storeStatus:error.storeStatus } : {}); return true; }
      const db = readDbSafe();
      send(res, 200, { ok:true, state, orders:orders.map(order => websiteOrders.listSummary(db, order, config)), depositDefault:WebsiteOrders.depositDefault(db), revision:revisionOf(db) }, JSON_TYPE, NO_STORE);
      return true;
    }

    const detail = route.match(/^\/api\/website-orders\/([^/]+)(\/approve)?$/);
    if (detail && method === "POST" && detail[2]) { await approve(req, res, detail[1]); return true; }
    if (detail && method === "GET" && !detail[2]) {
      const user = sessionOrFail(res, req); if (!user) return true;
      if (!canOrderAction(readDbSafe(), user, "order.website.view")) { fail(res, 403, "PERMISSION_DENIED", "ليس لديك صلاحية عرض طلبات الموقع."); return true; }
      if (!config.storeEnabled) { disabled(res); return true; }
      const number = detail[1];
      if (!WebsiteOrders.WEBSITE_ORDER_NUMBER_PATTERN.test(number)) { fail(res, 400, "INVALID_ORDER_NUMBER", "رقم طلب الموقع غير صحيح."); return true; }
      let fetched;
      try { fetched = await fetchStoreOrder(number); } catch (error) { storeUnavailable(res, error.storeStatus ? { storeStatus:error.storeStatus } : {}); return true; }
      if (fetched.notFound) { fail(res, 404, "WEBSITE_ORDER_NOT_FOUND", "طلب الموقع غير موجود."); return true; }
      const db = readDbSafe();
      const query = { reference:url.searchParams.get("reference") || "", senderPhone:url.searchParams.get("senderPhone") || "", amount:url.searchParams.get("amount") ?? undefined };
      send(res, 200, { ...websiteOrders.approvalPreview(db, fetched.order, { query, user, config }), revision:revisionOf(db) }, JSON_TYPE, NO_STORE);
      return true;
    }
    return false;
  }

  return { handle, websiteOrders, splitShipment, storeRequest, config };
}

module.exports = { createIntegrationServer };
