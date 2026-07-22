const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = __dirname;
const APP_ROOT = path.join(ROOT, "app");
const DATA_ROOT = path.join(ROOT, "data");
const BACKUP_ROOT = path.join(DATA_ROOT, "backups");
const DEBUG_ROOT = path.join(ROOT, "debug", "tracking");
const DB_PATH = path.join(DATA_ROOT, "database.json");
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_HOURS = 12;
const EGYPT_POST_TRACKING_URL = "https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/";
const TRACKING_PROVIDER_NAME = "EgyptPostBrowserProvider";
const TRACKING_RPA_ENABLED = String(process.env.TRACKING_RPA_ENABLED || "").toLowerCase() === "true";
const TRACKING_RPA_BASE_URL = String(process.env.TRACKING_RPA_BASE_URL || "").trim();
const TRACKING_RPA_SHARED_SECRET = String(process.env.TRACKING_RPA_SHARED_SECRET || "");
const TRACKING_RPA_TIMEOUT_MS = Number(process.env.TRACKING_RPA_TIMEOUT_MS || 120000);
const sessions = new Map();
let trackingTimer = null;
let trackingRunning = false;
const trackingActiveShipmentIds = new Set();
let trackingRuntime = {
  running: false,
  provider: TRACKING_PROVIDER_NAME,
  providerType: "Browser Automation",
  lastRun: null,
  nextRun: null,
  lastSummary: null,
  lastError: "",
  source: EGYPT_POST_TRACKING_URL
};

const defaultUsers = [
  { id:"U001", username:"owner", name:"مالك النظام", role:"مالك", salt:"s01", passwordHash:"2dbab9e2692dc22862154db758fd08face95e6d15b5fb2390995dad66bd0452c", active:true },
  { id:"U002", username:"manager", name:"مدير النظام", role:"مدير", salt:"s02", passwordHash:"a29c2fcb2de4e5175719cb5dfed4043da44b9baa5a87430eba6d1223e488d563", active:true },
  { id:"U003", username:"accountant", name:"المحاسب", role:"محاسب", salt:"s03", passwordHash:"6b44de984c5a4ce8691a0bef70b679e88135ad7f4d05a11ffef3cc04e8c76a85", active:true },
  { id:"U004", username:"cashier", name:"الكاشير", role:"كاشير", salt:"s04", passwordHash:"440aade91695513e752ac4ce674d1639c3ed697d0c4d2806edc15bd073e0aa61", active:true },
  { id:"U005", username:"warehouse", name:"مسؤول المخزن", role:"مخزن", salt:"s05", passwordHash:"5c37d675c0fffbedd0f6acd3d75d409ee5c3a336574a058b575de03aeda5e9fd", active:true },
  { id:"U006", username:"shipping", name:"مسؤول الشحن", role:"شحن", salt:"s06", passwordHash:"7a53924916afbcba18d1f58c093f7fe110f88539803186401fdb2f280a769000", active:true }
];

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  res.writeHead(status, { "Content-Type": type, "Content-Length": payload.length, ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function passwordHash(salt, password) {
  return crypto.createHash("sha256").update(`${salt}:${password || ""}`, "utf8").digest("hex");
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  const body = JSON.stringify(db, null, 2);
  fs.writeFileSync(`${DB_PATH}.tmp`, body, "utf8");
  fs.renameSync(`${DB_PATH}.tmp`, DB_PATH);
}

function canOverrideNegativeStock(db, user) {
  const roleAliases = { owner:"مالك", manager:"مدير", accountant:"محاسب", cashier:"كاشير", warehouse:"مخزن", shipping:"شحن" };
  const role = roleAliases[user?.role] || user?.role || "";
  if (role === "مالك" || user?.username === "owner") return true;
  const permissions = db.settings?.permissions || {};
  const roleActions = permissions.roles?.[role]?.actions;
  const userActions = permissions.users?.[user?.username]?.actions;
  const actions = Array.isArray(userActions) ? userActions : Array.isArray(roleActions) ? roleActions : [];
  return actions.includes("allow-negative-stock");
}

function validateNegativeStockWrite(currentDb, nextDb, user) {
  const existingSaleIds = new Set((currentDb.sales || []).map(sale => sale.id));
  const requestedByBook = new Map();
  for (const sale of (nextDb.sales || []).filter(item => !item.deletedAt && item.status !== "ملغاة" && !existingSaleIds.has(item.id))) {
    for (const line of sale.lines || []) {
      const bookId = line.bookId || line.productId;
      const quantity = Number(line.qty || line.quantity || 0);
      if (bookId && quantity > 0) requestedByBook.set(bookId, Number(requestedByBook.get(bookId) || 0) + quantity);
    }
  }
  const violations = [];
  for (const [bookId, requested] of requestedByBook) {
    const book = (currentDb.books || []).find(item => item.id === bookId);
    const available = Number(book?.stock || 0);
    if (requested > available) violations.push({ bookId, name:book?.name || bookId, available, requested });
  }
  if (!violations.length) return { ok:true, violations:[] };
  const allowed = nextDb.settings?.allowNegativeStock === true && canOverrideNegativeStock(nextDb, user);
  return { ok:allowed, violations };
}

function appendNegativeStockAudit(db, user, violations) {
  if (!violations.length) return;
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  const now = new Date().toISOString();
  for (const row of violations) {
    const sourceKey = `negative-stock:${now}:${user.username}:${row.bookId}`;
    db.audit.push({ id:`AUD-NEG-${crypto.randomUUID()}`, date:now, createdAt:now, action:"تجاوز المخزون السالب بصلاحية", operationType:"تجاوز المخزون السالب", entity:"المخزون", entityId:row.bookId, documentNo:"", user:user.name || user.username, username:user.username, role:user.role, sourceKey, details:`${row.name}: المتاح ${row.available}، المطلوب ${row.requested}` });
  }
}

function ensureDirs() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  fs.mkdirSync(DEBUG_ROOT, { recursive: true });
}

function createBackup() {
  if (!fs.existsSync(DB_PATH)) return null;
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const file = `database-${stamp}-${Date.now()}.json`;
  const destination = path.join(BACKUP_ROOT, file);
  fs.copyFileSync(DB_PATH, destination);
  fs.readdirSync(BACKUP_ROOT)
    .filter(name => /^database-.*\.json$/i.test(name))
    .map(name => ({ name, file: path.join(BACKUP_ROOT, name), time: fs.statSync(path.join(BACKUP_ROOT, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(30)
    .forEach(item => fs.rmSync(item.file, { force: true }));
  return destination;
}

function nextId(prefix, list = []) {
  const max = list.reduce((acc, item) => {
    const number = Number(String(item.id || "").replace(/\D/g, ""));
    return Math.max(acc, number || 0);
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function normalizeTrackingNumber(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function isValidTrackingNumber(value = "") {
  const normalized = normalizeTrackingNumber(value);
  return /^[A-Z0-9]{8,30}$/.test(normalized);
}

function isCorruptedTrackingText(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return /[\uFFFD]|â|Ã|Â|ë|ï¿½|ط[\u00A0-\u02FF]|ظ[\u00A0-\u02FF]|آ[·]/.test(text);
}

function cleanTrackingText(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "â€”" || text === "—") return "";
  return isCorruptedTrackingText(text) ? "" : text;
}

function isEgyptPostShipment(shipment = {}) {
  const carrier = `${shipment.carrier || ""} ${shipment.company || ""} ${shipment.carrierCode || ""}`.toLowerCase();
  return carrier.includes("egypt") || carrier.includes("post") || carrier.includes("البريد") || carrier.includes("المصري");
}

function defaultTrackingSettings(settings = {}) {
  const tracking = settings.tracking || {};
  return {
    enabled: tracking.enabled !== false,
    providerName: TRACKING_PROVIDER_NAME,
    providerType: "Browser Automation",
    providerEndpoint: EGYPT_POST_TRACKING_URL,
    providerMethod: "BROWSER",
    mode: "Browser Automation",
    cost: "Free",
    subscriptionRequired: false,
    apiKeyRequired: false,
    manualPause: Boolean(tracking.manualPause),
    providerHeaders: tracking.providerHeaders || {},
    carrierCode: tracking.carrierCode || "",
    originCountry: tracking.originCountry || "EG",
    destinationCountry: tracking.destinationCountry || "EG",
    cacheLevel: Number(tracking.cacheLevel ?? 0),
    intervalHours: [1, 3, 6, 12, 24].includes(Number(tracking.intervalHours)) ? Number(tracking.intervalHours) : 6,
    minIntervalHours: [1, 3, 6, 12, 24].includes(Number(tracking.minIntervalHours)) ? Number(tracking.minIntervalHours) : 6,
    maxConcurrent: Math.min(2, Math.max(1, Number(tracking.maxConcurrent || 1))),
    minDelaySeconds: Math.max(5, Number(tracking.minDelaySeconds || 15)),
    activeShipmentMaxAgeDays: Math.max(1, Number(tracking.activeShipmentMaxAgeDays || 45)),
    maxAttempts: Math.max(1, Number(tracking.maxAttempts || 5)),
    timeoutMs: Math.max(45000, Number(tracking.timeoutMs || 45000)),
    retryCount: Number(tracking.retryCount || 1),
    noMovementHours: Number(tracking.noMovementHours || 48),
    complaintNoMovementHours: Number(tracking.complaintNoMovementHours || 72),
    rateLimitMs: Math.max(10000, Number(tracking.rateLimitMs || 15000)),
    slaRules: tracking.slaRules || { defaultDays: 4, byGovernorate: {}, weekends: ["Friday"] },
    statusMapping: tracking.statusMapping || {},
    officialWebsite: EGYPT_POST_TRACKING_URL
  };
}

function ensureTrackingDb(db) {
  db.settings = db.settings || {};
  db.settings.tracking = defaultTrackingSettings(db.settings);
  if (!Array.isArray(db.trackingHistory)) db.trackingHistory = [];
  if (!Array.isArray(db.trackingRuns)) db.trackingRuns = [];
  if (!Array.isArray(db.trackingRunBatches)) db.trackingRunBatches = [];
  if (!Array.isArray(db.notifications)) db.notifications = [];
  if (!Array.isArray(db.complaints)) db.complaints = [];
  if (!Array.isArray(db.shipments)) db.shipments = [];
  const now = new Date().toISOString();
  db.shipments = db.shipments.map(shipment => {
    const trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking || "");
    const carrier = shipment.carrier || shipment.company || "";
    const enabledDefault = isEgyptPostShipment({ ...shipment, carrier }) && Boolean(trackingNumber);
    return {
      shipmentNo: shipment.shipmentNo || shipment.id,
      carrier,
      carrierCode: shipment.carrierCode || (isEgyptPostShipment({ ...shipment, carrier }) ? "EGYPT_POST" : ""),
      trackingNumber,
      trackingEnabled: shipment.trackingEnabled ?? enabledDefault,
      trackingProvider: shipment.trackingProvider || (enabledDefault ? db.settings.tracking.providerName : ""),
      customerName: shipment.customerName || shipment.customer || "",
      customerPhone: shipment.customerPhone || shipment.phone || "",
      currentStatus: shipment.currentStatus || shipment.status || "",
      normalizedStatus: shipment.normalizedStatus || normalizeTrackingStatus(shipment.currentStatus || shipment.status || ""),
      alertLevel: shipment.alertLevel || "info",
      trackingErrorCount: Number(shipment.trackingErrorCount || 0),
      manual_review_required: Boolean(shipment.manual_review_required || shipment.manualInterventionNeeded),
      delayHours: Number(shipment.delayHours || 0),
      delayDays: Number(shipment.delayDays || 0),
      requiresComplaint: Boolean(shipment.requiresComplaint),
      requiresCustomerCall: Boolean(shipment.requiresCustomerCall),
      returnRisk: Boolean(shipment.returnRisk),
      createdAt: shipment.createdAt || now,
      updatedAt: shipment.updatedAt || shipment.updated || now,
      ...shipment,
      trackingNumber,
      tracking: trackingNumber || shipment.tracking || "",
      carrier,
      trackingEnabled: shipment.trackingEnabled ?? enabledDefault
    };
  });
  return db;
}

function normalizeTrackingStatus(text = "", customMap = {}) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(customMap || {})) {
    if (lower.includes(String(key).toLowerCase())) return value;
  }
  const checks = [
    ["returned_to_sender", ["returned to sender", "return to sender", "رجوع للمرسل", "رجعت للمرسل", "عاد للمرسل", "مرتجع فعلي"]],
    ["return_in_transit", ["return in transit", "returning", "في طريق العودة", "جاري الإرجاع"]],
    ["return_initiated", ["return initiated", "بدأ الرجوع", "مرتجع", "عودة"]],
    ["delivered", ["delivered", "تم التسليم", "سلمت", "تم تسليم"]],
    ["address_issue", ["address", "عنوان", "العنوان غير صحيح", "مشكلة عنوان"]],
    ["customer_unavailable", ["unavailable", "not available", "لم يستلم", "غير متواجد", "غير موجود"]],
    ["delivery_attempted", ["attempt", "محاولة تسليم", "تعذر التسليم"]],
    ["out_for_delivery", ["out for delivery", "خارج للتسليم", "خرج للتوصيل"]],
    ["at_sorting_center", ["sorting", "فرز", "مركز"]],
    ["in_transit", ["transit", "في الطريق", "تم التحرك", "مرحلة النقل"]],
    ["accepted_by_carrier", ["accepted", "received", "استلام", "تم الاستلام"]],
    ["held", ["held", "محتجز", "انتظار"]],
    ["delayed", ["delay", "تأخير", "متأخر"]]
  ];
  const hit = checks.find(([, words]) => words.some(word => lower.includes(word)));
  return hit ? hit[0] : "unknown";
}

function eventFingerprint(event = {}) {
  return crypto.createHash("sha1")
    .update(`${event.trackingNumber || ""}|${event.statusText || ""}|${event.normalizedStatus || ""}|${event.location || ""}|${event.eventAt || ""}`, "utf8")
    .digest("hex");
}

function parseProviderEvents(payload, shipment, settings) {
  const source = payload?.events || payload?.history || payload?.trackingHistory || payload?.data?.events || payload?.data?.history || payload?.data || payload;
  const rows = Array.isArray(source) ? source : [source].filter(Boolean);
  return rows.map(row => {
    const statusText = cleanTrackingText(row.statusText || row.status || row.description || row.event || row.state || row.LastStatus || row.Status || "");
    const location = cleanTrackingText(row.location || row.place || row.office || row.branch || row.Location || "");
    const eventAt = row.eventAt || row.date || row.datetime || row.time || row.EventDate || row.Date || new Date().toISOString();
    return {
      trackingNumber: normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking),
      statusText,
      normalizedStatus: normalizeTrackingStatus(statusText, settings.statusMapping),
      location,
      eventAt: new Date(eventAt).toString() === "Invalid Date" ? new Date().toISOString() : new Date(eventAt).toISOString(),
      provider: settings.providerName,
      raw: row
    };
  }).filter(event => event.statusText || event.location);
}

function requestJson(url, options = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.request(url, options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
        try { resolve(JSON.parse(text)); }
        catch { resolve({ statusText: text.slice(0, 500), rawText: text }); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Tracking request timeout.")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function requestJsonDetailed(url, options = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.request(url, options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; }
        catch { payload = { rawText: text }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.payload = payload;
          error.responseText = text;
          return reject(error);
        }
        resolve({ statusCode: res.statusCode, payload, text });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Tracking request timeout.")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function requestTextDetailed(url, options = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.request(url, options, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Local RPA request timeout.")));
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function trackingLog(stage, details = {}) {
  const safe = {
    timestamp: new Date().toISOString(),
    level: details.level || "info",
    service: "tracking",
    stage,
    requestId: details.requestId || "",
    shipmentId: details.shipmentId || "",
    ok: details.ok,
    eventCount: details.eventCount,
    message: details.message || ""
  };
  console.log(JSON.stringify(Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined && value !== ""))));
}

async function requestLocalRpa(pathname, payload = null, timeoutMs = TRACKING_RPA_TIMEOUT_MS, requestId = crypto.randomUUID()) {
  if (!TRACKING_RPA_ENABLED || !TRACKING_RPA_BASE_URL || !TRACKING_RPA_SHARED_SECRET) {
    const error = new Error("خدمة التتبع غير مهيأة على السيرفر.");
    error.code = "TRACKING_AGENT_OFFLINE";
    throw error;
  }
  const target = new URL(pathname, `${TRACKING_RPA_BASE_URL.replace(/\/$/, "")}/`);
  const body = payload ? JSON.stringify(payload) : "";
  let response;
  try {
    response = await requestTextDetailed(target.toString(), {
      method: payload ? "POST" : "GET",
      headers: {
        "Authorization": `Bearer ${TRACKING_RPA_SHARED_SECRET}`,
        "X-Request-ID": requestId,
        ...(payload ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) } : {})
      },
      body
    }, timeoutMs);
  } catch (cause) {
    const error = new Error("خدمة التتبع المحلية غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا.");
    error.code = "TRACKING_AGENT_OFFLINE";
    error.cause = cause;
    throw error;
  }
  let data = {};
  try { data = JSON.parse(response.text || "{}"); }
  catch { throw new Error(`Local RPA returned invalid JSON: ${String(response.text || "").slice(0, 200)}`); }
  if (response.statusCode === 401 || response.statusCode >= 500) {
    const error = new Error(response.statusCode === 401 ? "تعذر توثيق الاتصال بخدمة التتبع." : "خدمة التتبع المحلية غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا.");
    error.code = "TRACKING_AGENT_OFFLINE";
    error.httpStatus = response.statusCode;
    throw error;
  }
  return { statusCode: response.statusCode, data, requestId };
}

function localRpaTimelineToEvents(result = {}, shipment = {}) {
  return (Array.isArray(result.timeline) ? result.timeline : []).map(row => {
    const statusText = cleanTrackingText(row.statusText || row.description || row.status || result.confirmedStatus || "");
    const location = cleanTrackingText(row.location || row.place || "");
    return {
      trackingNumber: normalizeTrackingNumber(result.trackingNumber || shipment.trackingNumber || shipment.tracking),
      statusText,
      normalizedStatus: row.normalizedStatus || normalizeTrackingStatus(statusText),
      location,
      eventAt: new Date(row.eventAt || row.date || Date.now()).toString() === "Invalid Date" ? new Date().toISOString() : new Date(row.eventAt || row.date || Date.now()).toISOString(),
      provider: "LocalTrackingRPA",
      raw: row
    };
  }).filter(event => event.statusText || event.location);
}

async function fetchLocalRpaTracking(db, shipment, settings, trackingNumber, requestId) {
  trackingLog("agent_request", { requestId, shipmentId:shipment.id });
  const { statusCode, data } = await requestLocalRpa("/track", {
    shipmentId: shipment.id,
    trackingNumber,
    provider: "egypt_post",
    requestId
  }, TRACKING_RPA_TIMEOUT_MS, requestId);
  if (!data.success) {
    const error = new Error(data.failureMessage || "تعذر تحديث التتبع عبر خدمة RPA المحلية");
    error.code = data.failureCode || "LOCAL_RPA_FAILED";
    error.httpStatus = statusCode;
    error.manualIntervention = Boolean(data.manualReviewRequired || ["SITE_BLOCKED", "HUMAN_VERIFICATION_REQUIRED", "INPUT_NOT_FOUND", "RESULT_NOT_FOUND", "TIMEOUT", "PARSE_FAILED", "UNKNOWN_ERROR", "PLAYWRIGHT_NOT_INSTALLED"].includes(error.code));
    error.diagnostics = data.diagnostics || {};
    error.debug = data.diagnostics && (data.diagnostics.screenshotFile || data.diagnostics.htmlFile || data.diagnostics.jsonFile) ? {
      screenshotFile: data.diagnostics.screenshotFile || "",
      htmlFile: data.diagnostics.htmlFile || "",
      jsonFile: data.diagnostics.jsonFile || ""
    } : null;
    error.payload = data;
    throw error;
  }
  const events = localRpaTimelineToEvents(data, shipment);
  if (!events.length) {
    const error = new Error("Local RPA لم يرجع Timeline مؤكد.");
    error.code = "PARSE_FAILED";
    error.manualIntervention = true;
    error.diagnostics = data.diagnostics || {};
    error.payload = data;
    throw error;
  }
  trackingLog("agent_result", { requestId, shipmentId:shipment.id, ok:true, eventCount:events.length });
  return {
    payload: data,
    events,
    source: TRACKING_RPA_BASE_URL,
    httpStatus: statusCode,
    carrierCode: "EGYPT_POST",
    acceptedNumber: data.trackingNumber || trackingNumber,
    providerActual: "LocalTrackingRPA",
    eventCount: events.length,
    diagnostics: data.diagnostics || {}
  };
}

async function getLocalRpaHealth() {
  const base = { enabled: TRACKING_RPA_ENABLED, connected: false, status: "offline", browserAvailable: false, activeJob: false, lastSuccessfulRunAt: null, lastFailureAt: null };
  try {
    const { statusCode, data } = await requestLocalRpa("/health", null, 3000);
    const connected = statusCode >= 200 && statusCode < 300 && data.status === "ok";
    return { ...base, ...data, connected, status: connected ? "connected" : "offline" };
  } catch (error) {
    return { ...base, failureCode: "TRACKING_AGENT_OFFLINE", message: "خدمة التتبع المحلية غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا." };
  }
}

function build17TrackRequestItem(trackingNumber, shipment, settings) {
  const item = {
    number: trackingNumber,
    origin_country: settings.originCountry || "EG",
    destination_country: settings.destinationCountry || "EG",
    cacheLevel: Number(settings.cacheLevel ?? 0),
    lang: "ar"
  };
  const carrierCode = Number(settings.carrierCode || shipment.carrierCode17Track || shipment.externalCarrierCode || 0);
  if (Number.isInteger(carrierCode) && carrierCode > 0) item.carrier = carrierCode;
  return item;
}

function normalize17TrackStatus(status = "", subStatus = "", stage = "", description = "", customMap = {}) {
  const combined = `${status || ""} ${subStatus || ""} ${stage || ""} ${description || ""}`;
  const exact = String(status || "").trim();
  const sub = String(subStatus || "").trim();
  const stageKey = String(stage || "").trim();
  if (exact === "Delivered" || sub.startsWith("Delivered") || stageKey === "Delivered") return "delivered";
  if (sub === "Exception_Returned" || stageKey === "Returned") return "returned_to_sender";
  if (sub === "Exception_Returning" || stageKey === "Returning") return "return_in_transit";
  if (exact === "Exception") return "return_initiated";
  if (exact === "OutForDelivery" || stageKey === "OutForDelivery") return "out_for_delivery";
  if (exact === "DeliveryFailure") return sub === "DeliveryFailure_InvalidAddress" ? "address_issue" : "delivery_attempted";
  if (exact === "AvailableForPickup" || stageKey === "AvailableForPickup") return "held";
  if (exact === "InTransit" || stageKey === "PickedUp" || stageKey === "Departure" || stageKey === "Arrival") return "in_transit";
  if (exact === "InfoReceived" || stageKey === "InfoReceived") return "accepted_by_carrier";
  if (exact === "Expired") return "delayed";
  return normalizeTrackingStatus(combined, customMap);
}

function eventTimeFrom17Track(event = {}) {
  const raw = event.time_raw || {};
  const rawDateTime = [raw.date, raw.time].filter(Boolean).join(" ");
  return event.time_utc || event.time_iso || rawDateTime || new Date().toISOString();
}

function locationFrom17Track(event = {}) {
  if (event.location) return String(event.location);
  const address = event.address || {};
  return [address.country, address.state, address.city, address.street].filter(Boolean).join("، ");
}

function parse17TrackEvents(payload, shipment, settings) {
  const trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking);
  if (!isValidTrackingNumber(trackingNumber)) throw new Error("رقم التتبع غير صالح.");
  if (settings.manualPause) {
    const error = new Error("يحتاج تدخل يدوي: التتبع متوقف مؤقتًا من الإعدادات.");
    error.manualIntervention = true;
    throw error;
  }
  const accepted = payload?.data?.accepted || [];
  const item = accepted.find(row => normalizeTrackingNumber(row.number) === trackingNumber) || accepted[0];
  if (!item) return [];
  const latestStatus = item.track_info?.latest_status || {};
  const latestEvent = item.track_info?.latest_event || {};
  const providers = item.track_info?.tracking?.providers || [];
  const rows = [];
  for (const providerBlock of providers) {
    for (const event of (providerBlock.events || [])) {
      const statusText = event.description_translation?.description || event.description || event.stage || event.sub_status || latestStatus.status || "";
      rows.push({
        trackingNumber,
        statusText: String(statusText || "").trim(),
        normalizedStatus: normalize17TrackStatus(latestStatus.status, event.sub_status || latestStatus.sub_status, event.stage, statusText, settings.statusMapping),
        location: locationFrom17Track(event),
        eventAt: new Date(eventTimeFrom17Track(event)).toString() === "Invalid Date" ? new Date().toISOString() : new Date(eventTimeFrom17Track(event)).toISOString(),
        provider: settings.providerName,
        raw: { provider: providerBlock.provider, event }
      });
    }
  }
  if (!rows.length && (latestEvent.description || latestStatus.status)) {
    const statusText = latestEvent.description_translation?.description || latestEvent.description || latestStatus.sub_status || latestStatus.status || "";
    rows.push({
      trackingNumber,
      statusText: String(statusText || "").trim(),
      normalizedStatus: normalize17TrackStatus(latestStatus.status, latestStatus.sub_status, latestEvent.stage, statusText, settings.statusMapping),
      location: locationFrom17Track(latestEvent),
      eventAt: new Date(eventTimeFrom17Track(latestEvent)).toString() === "Invalid Date" ? new Date().toISOString() : new Date(eventTimeFrom17Track(latestEvent)).toISOString(),
      provider: settings.providerName,
      raw: { latest_status: latestStatus, latest_event: latestEvent }
    });
  }
  return rows.filter(event => event.statusText || event.location);
}

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
}

function findChromeExecutable() {
  return chromeCandidates().find(file => fs.existsSync(file)) || "";
}

function httpJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Chrome DevTools timeout.")));
    req.on("error", reject);
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function debugSafeName(value = "") {
  return String(value || "tracking").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "tracking";
}

function trackingDebugMeta(fileBase) {
  return {
    screenshotFile: `${fileBase}.png`,
    htmlFile: `${fileBase}.html`,
    jsonFile: `${fileBase}.json`,
    screenshotPath: path.join(DEBUG_ROOT, `${fileBase}.png`),
    htmlPath: path.join(DEBUG_ROOT, `${fileBase}.html`),
    jsonPath: path.join(DEBUG_ROOT, `${fileBase}.json`)
  };
}

function createTrackingReadError(code, message, diagnostics = {}) {
  const error = new Error(message);
  error.code = code;
  error.manualIntervention = true;
  error.diagnostics = diagnostics;
  return error;
}

async function cdpEvaluate(cdp, expression, timeoutMs = 30000) {
  return cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs
  });
}

async function captureTrackingDebug(cdp, trackingNumber, shipmentId, reason, diagnostics = {}) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const fileBase = `${debugSafeName(trackingNumber)}-${debugSafeName(shipmentId || "TEST")}-${stamp}`;
  const meta = trackingDebugMeta(fileBase);
  let html = "";
  try {
    const htmlResult = await cdpEvaluate(cdp, "document.documentElement ? document.documentElement.outerHTML : ''", 10000);
    html = String(htmlResult.result?.value || "");
  } catch (error) {
    html = `<!-- Failed to capture HTML snapshot: ${String(error.message || error).slice(0, 300)} -->`;
  }
  try {
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    if (shot?.data) fs.writeFileSync(meta.screenshotPath, Buffer.from(shot.data, "base64"));
  } catch (error) {
    fs.writeFileSync(meta.screenshotPath, Buffer.alloc(0));
    diagnostics.screenshotCaptureError = error.message || String(error);
  }
  fs.writeFileSync(meta.htmlPath, html, "utf8");
  const safeDiagnostics = {
    capturedAt: new Date().toISOString(),
    trackingNumber,
    shipmentId: shipmentId || "",
    reason: reason?.message || String(reason || ""),
    code: reason?.code || "",
    ...diagnostics
  };
  fs.writeFileSync(meta.jsonPath, JSON.stringify(safeDiagnostics, null, 2), "utf8");
  return {
    ...safeDiagnostics,
    screenshotFile: meta.screenshotFile,
    htmlFile: meta.htmlFile,
    jsonFile: meta.jsonFile
  };
}

function encodeWsFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const header = [];
  header.push(0x81);
  if (payload.length < 126) header.push(0x80 | payload.length);
  else if (payload.length < 65536) header.push(0x80 | 126, (payload.length >> 8) & 255, payload.length & 255);
  else throw new Error("WebSocket frame too large.");
  const mask = crypto.randomBytes(4);
  const out = Buffer.alloc(header.length + 4 + payload.length);
  Buffer.from(header).copy(out, 0);
  mask.copy(out, header.length);
  for (let i = 0; i < payload.length; i++) out[header.length + 4 + i] = payload[i] ^ mask[i % 4];
  return out;
}

function parseWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset++];
    const second = buffer[offset++];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    if (length === 126) {
      if (offset + 2 > buffer.length) break;
      length = buffer.readUInt16BE(offset); offset += 2;
    } else if (length === 127) {
      if (offset + 8 > buffer.length) break;
      const bigLength = buffer.readBigUInt64BE(offset);
      offset += 8;
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Large WebSocket frame is too large.");
      length = Number(bigLength);
    }
    let mask = null;
    if (masked) {
      if (offset + 4 > buffer.length) break;
      mask = buffer.slice(offset, offset + 4); offset += 4;
    }
    if (offset + length > buffer.length) break;
    const payload = Buffer.from(buffer.slice(offset, offset + length)); offset += length;
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 1) frames.push(payload.toString("utf8"));
  }
  return { frames, rest: buffer.slice(offset) };
}

function connectCdp(wsUrl) {
  let nextMessageId = 1;
  const pending = new Map();
  const thisSocket = new WebSocket(wsUrl);
  const ready = new Promise((resolve, reject) => {
    thisSocket.addEventListener("open", resolve, { once: true });
    thisSocket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket refused connection.")), { once: true });
  });
  thisSocket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data || "{}"));
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || "CDP error"));
      else item.resolve(message.result);
    }
  });
  thisSocket.addEventListener("error", () => {
    const error = new Error("Chrome DevTools WebSocket connection failed.");
    pending.forEach(item => item.reject(error));
    pending.clear();
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextMessageId++;
      thisSocket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 30000);
      });
    },
    close() { try { thisSocket.close(); } catch {} }
  };
}

async function launchChromeForTracking(settings) {
  const chrome = findChromeExecutable();
  if (!chrome) {
    const error = new Error("يحتاج تدخل يدوي: لم يتم العثور على Chrome أو Edge لتشغيل بوت التتبع المحلي.");
    error.manualIntervention = true;
    throw error;
  }
  const port = 9222 + Math.floor(Math.random() * 1000);
  const profile = path.join(os.tmpdir(), `dotcom-egyptpost-tracking-${Date.now()}`);
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions", "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1365,900", "about:blank"
  ];
  const proc = spawn(chrome, args, { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 30; i++) {
    try {
      const list = await httpJson(`http://127.0.0.1:${port}/json/list`, 1000);
      const target = list.find(item => item.type === "page" && item.webSocketDebuggerUrl) || list[0];
      if (target?.webSocketDebuggerUrl) return { proc, profile, port, wsUrl: target.webSocketDebuggerUrl };
    } catch {}
    await wait(350);
  }
  try { proc.kill(); } catch {}
  const error = new Error("تعذر فتح موقع البريد المصري: لم يبدأ Chrome DevTools.");
  error.manualIntervention = true;
  throw error;
}

function extractEgyptPostResult(text, trackingNumber, settings) {
  const clean = String(text || "").replace(/\r/g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (!clean) {
    const error = new Error("تعذر قراءة نتيجة التتبع، قد يكون تصميم الصفحة تغير");
    error.manualIntervention = true;
    throw error;
  }
  if (/captcha|recaptcha|i am not a robot|أنا لست روبوت|كابتشا/i.test(clean)) {
    const error = new Error("يتطلب تدخل يدوي بسبب CAPTCHA");
    error.manualIntervention = true;
    throw error;
  }
  const lines = clean.split("\n").map(line => line.trim()).filter(line => line.length > 2);
  const noResult = lines.some(line => /not found|no result|لا توجد|لم يتم العثور|غير موجود/i.test(line));
  if (noResult) {
    const error = new Error("لم يتم العثور على نتيجة لهذا الرقم");
    error.manualIntervention = true;
    throw error;
  }
  const statusLine = lines.find(line => /(تم التسليم|في الطريق|استلام|تسليم|وصل|فرز|مكتب|محاولة|مرتجع|delivered|transit|accepted|sorting|delivery|returned)/i.test(line) && !line.includes("Facebook")) || "";
  if (!statusLine) {
    const error = new Error("تعذر قراءة نتيجة التتبع، قد يكون تصميم الصفحة تغير");
    error.manualIntervention = true;
    throw error;
  }
  const locationLine = lines.find(line => /(مكتب|فرع|مركز|القاهرة|الجيزة|الإسكندرية|office|center|branch)/i.test(line)) || "";
  const dateLine = lines.find(line => /\b(20\d{2}|19\d{2})[-/]\d{1,2}[-/]\d{1,2}\b|\d{1,2}[-/]\d{1,2}[-/](20\d{2}|19\d{2})/.test(line)) || "";
  let eventAt = new Date().toISOString();
  const dateMatch = dateLine.match(/\b(20\d{2}|19\d{2})[-/]\d{1,2}[-/]\d{1,2}\b|\d{1,2}[-/]\d{1,2}[-/](20\d{2}|19\d{2})/);
  if (dateMatch && new Date(dateMatch[0]).toString() !== "Invalid Date") eventAt = new Date(dateMatch[0]).toISOString();
  return [{
    trackingNumber,
    provider: TRACKING_PROVIDER_NAME,
    statusText: statusLine,
    normalizedStatus: normalizeTrackingStatus(statusLine, settings.statusMapping),
    location: locationLine,
    eventAt,
    raw: { visibleTextSample: clean.slice(0, 3000) }
  }];
}

function extractEgyptPostResultV2(text, trackingNumber, settings, diagnostics = {}) {
  const clean = String(text || "").replace(/\r/g, "\n").replace(/\n{2,}/g, "\n").trim();
  diagnostics.trackingResultTextCaptured = Boolean(clean);
  if (!clean) throw createTrackingReadError("RESULT_TEXT_EMPTY", "النتيجة لم تظهر: لا يوجد نص مقروء من منطقة النتيجة.", diagnostics);
  if (/captcha|recaptcha|i am not a robot|robot check|أنا لست روبوت|كابتشا/i.test(clean)) {
    diagnostics.captchaFound = true;
    throw createTrackingReadError("CAPTCHA_FOUND", "ظهرت CAPTCHA وتحتاج تدخل يدوي.", diagnostics);
  }
  const lines = clean.split("\n").map(line => line.trim()).filter(line => line.length > 2);
  diagnostics.resultLines = lines.slice(0, 80);
  const noResult = lines.some(line => /not found|no result|no data|لا توجد|لا يوجد|لم يتم العثور|غير موجود|بيانات غير متاحة/i.test(line));
  if (noResult) {
    diagnostics.noDataMessageFound = true;
    throw createTrackingReadError("NO_TRACKING_DATA", "ظهرت رسالة لا توجد بيانات لهذا الرقم.", diagnostics);
  }
  const statusPatterns = [
    /تم\s*التسليم/i, /قيد\s*التسليم/i, /خرج\s*للتوصيل/i, /في\s*الطريق/i,
    /استلام|استلم|مستلم/i, /تسليم/i, /وصل/i, /فرز/i, /مكتب/i,
    /محاولة/i, /مرتجع|عودة|راجع/i, /delivered|transit|accepted|sorting|delivery|returned|out for delivery|attempt/i
  ];
  const noisy = /facebook|twitter|instagram|youtube|copyright|privacy|menu|الرئيسية|تواصل معنا/i;
  const statusLine = lines.find(line => statusPatterns.some(pattern => pattern.test(line)) && !noisy.test(line)) || "";
  diagnostics.parsedConfirmedStatus = Boolean(statusLine);
  if (!statusLine) throw createTrackingReadError("STATUS_NOT_READABLE", "تعذر قراءة الحالة من نتيجة التتبع.", diagnostics);
  const locationLine = lines.find(line => /(مكتب|فرع|مركز|القاهرة|الجيزة|الإسكندرية|office|center|branch)/i.test(line) && !noisy.test(line)) || "";
  const dateLine = lines.find(line => /\b(20\d{2}|19\d{2})[-/]\d{1,2}[-/]\d{1,2}\b|\d{1,2}[-/]\d{1,2}[-/](20\d{2}|19\d{2})/.test(line)) || "";
  diagnostics.parsedLocation = Boolean(locationLine);
  diagnostics.parsedDate = Boolean(dateLine);
  diagnostics.statusText = statusLine;
  diagnostics.location = locationLine;
  diagnostics.dateText = dateLine;
  let eventAt = new Date().toISOString();
  const dateMatch = dateLine.match(/\b(20\d{2}|19\d{2})[-/]\d{1,2}[-/]\d{1,2}\b|\d{1,2}[-/]\d{1,2}[-/](20\d{2}|19\d{2})/);
  if (dateMatch && new Date(dateMatch[0]).toString() !== "Invalid Date") eventAt = new Date(dateMatch[0]).toISOString();
  return [{
    trackingNumber,
    provider: TRACKING_PROVIDER_NAME,
    statusText: statusLine,
    normalizedStatus: normalizeTrackingStatus(statusLine, settings.statusMapping),
    location: locationLine,
    eventAt,
    raw: { visibleTextSample: clean.slice(0, 3000), diagnostics }
  }];
}

async function fetchEgyptPostBrowserTracking(db, shipment, settings, trackingNumber) {
  const started = Date.now();
  let chrome = null;
  let cdp = null;
  try {
    chrome = await launchChromeForTracking(settings);
    cdp = connectCdp(chrome.wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: EGYPT_POST_TRACKING_URL });
    await wait(6000);
    const smartScript = `
      (async () => {
        const trackingNumber = ${JSON.stringify(trackingNumber)};
        const timeoutMs = ${Math.max(30000, Number(settings.timeoutMs || 45000))};
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const visible = el => {
          if (!el) return false;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const textOf = el => (el && (el.innerText || el.textContent || el.value || el.title || el.getAttribute("aria-label")) || "").trim();
        const attrText = el => [el?.id, el?.name, el?.placeholder, el?.title, el?.getAttribute?.("aria-label"), el?.className].join(" ");
        const waitUntil = async (predicate, limit = timeoutMs, step = 350) => {
          const end = Date.now() + limit;
          while (Date.now() < end) {
            const value = predicate();
            if (value) return value;
            await sleep(step);
          }
          return null;
        };
        const diagnostics = {
          pageOpened:false, trackingInputFound:false, trackingNumberEntered:false,
          submitButtonFound:false, submitClicked:false, resultContainerFound:false,
          trackingResultTextCaptured:false, parsedConfirmedStatus:false, parsedLocation:false,
          parsedDate:false, captchaFound:false, noDataMessageFound:false,
          pageTitle:"", pageUrl:"", inputSelector:"", buttonText:"", resultSelector:"",
          bodyTextSample:"", resultText:""
        };
        await waitUntil(() => document.readyState === "complete" || document.body, 15000, 250);
        diagnostics.pageOpened = Boolean(document.body);
        diagnostics.pageTitle = document.title;
        diagnostics.pageUrl = location.href;
        if (!diagnostics.pageOpened) return { ...diagnostics, failureCode:"SITE_NOT_OPENED", failureMessage:"الموقع لم يفتح" };
        const initialBodyText = (document.body.innerText || "").trim();
        if (/you have been blocked|cloudflare|security service|access denied|تم حظرك|تم منعك|غير مسموح/i.test(initialBodyText)) {
          return { ...diagnostics, bodyTextSample:initialBodyText.slice(0, 4000), failureCode:"SITE_BLOCKED", failureMessage:"الموقع لم يفتح صفحة التتبع وتم منع الوصول بواسطة حماية الموقع" };
        }
        const inputSelectors = [
          "input[name*='track' i]", "input[id*='track' i]", "input[name*='trace' i]", "input[id*='trace' i]",
          "input[name*='barcode' i]", "input[id*='barcode' i]", "input[name*='item' i]", "input[id*='item' i]",
          "input[type='search']", "input[type='text']", "textarea"
        ];
        const inputs = [...new Set(inputSelectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
          .filter(el => visible(el) && !/hidden|submit|button|checkbox|radio/i.test(el.type || ""));
        const input = inputs.find(el => /track|trace|barcode|shipment|item|رقم|تتبع|الشحنة|باركود/i.test(attrText(el))) || inputs[0];
        if (!input) return { ...diagnostics, bodyTextSample:(document.body.innerText || "").slice(0, 4000), failureCode:"TRACKING_INPUT_NOT_FOUND", failureMessage:"خانة رقم التتبع غير موجودة" };
        diagnostics.trackingInputFound = true;
        diagnostics.inputSelector = input.id ? "#" + input.id : (input.name ? "[name='" + input.name + "']" : input.tagName);
        input.scrollIntoView({ block:"center", inline:"center" });
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(input, trackingNumber); else input.value = trackingNumber;
        input.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:trackingNumber }));
        input.dispatchEvent(new Event("change", { bubbles:true }));
        diagnostics.trackingNumberEntered = input.value.replace(/\\s+/g, "").toUpperCase() === trackingNumber;
        const beforeText = (document.body.innerText || "").trim();
        const controls = [...document.querySelectorAll("button,input[type=submit],input[type=button],a,[role=button]")].filter(visible);
        const button = controls.find(el => /track|trace|search|بحث|تتبع|استعلام|استفسار|إرسال|اظهار|عرض/i.test(textOf(el) + " " + attrText(el))) ||
          input.closest("form")?.querySelector("button,input[type=submit]") ||
          controls.find(el => !/facebook|twitter|instagram|youtube|login|menu/i.test(textOf(el)));
        if (!button && !input.closest("form")) return { ...diagnostics, bodyTextSample:beforeText.slice(0, 4000), failureCode:"TRACKING_BUTTON_NOT_FOUND", failureMessage:"زر التتبع غير موجود" };
        diagnostics.submitButtonFound = Boolean(button || input.closest("form"));
        diagnostics.buttonText = button ? textOf(button).slice(0, 120) : "form.submit";
        if (button) button.click(); else input.closest("form").requestSubmit?.();
        diagnostics.submitClicked = true;
        await waitUntil(() => {
          const entries = performance.getEntriesByType("resource").length;
          if (!window.__dotcomLastResourceCount) window.__dotcomLastResourceCount = entries;
          const stable = window.__dotcomLastResourceCount === entries;
          window.__dotcomLastResourceCount = entries;
          return stable && document.readyState === "complete";
        }, 5000, 500);
        const resultSelectors = [
          "[id*='result' i]", "[class*='result' i]", "[id*='track' i]", "[class*='track' i]",
          "[id*='trace' i]", "[class*='trace' i]", "[id*='shipment' i]", "[class*='shipment' i]",
          "table", ".card", ".container", "main", "section"
        ];
        const result = await waitUntil(() => {
          const bodyText = (document.body.innerText || "").trim();
          const captcha = /captcha|recaptcha|i am not a robot|أنا لست روبوت|كابتشا/i.test(bodyText);
          const noData = /not found|no result|no data|لا توجد|لا يوجد|لم يتم العثور|غير موجود|بيانات غير متاحة/i.test(bodyText);
          const changed = bodyText.length > beforeText.length + 20 || bodyText !== beforeText;
          const candidate = [...new Set(resultSelectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
            .filter(visible)
            .map(el => ({ el, text:textOf(el) }))
            .filter(row => row.text.length > 20)
            .sort((a, b) => {
              const as = Number(a.text.includes(trackingNumber)) * 100 + Number(/delivered|transit|accepted|returned|تم|استلام|تسليم|فرز|مكتب|مرتجع/i.test(a.text)) * 60 + a.text.length / 1000;
              const bs = Number(b.text.includes(trackingNumber)) * 100 + Number(/delivered|transit|accepted|returned|تم|استلام|تسليم|فرز|مكتب|مرتجع/i.test(b.text)) * 60 + b.text.length / 1000;
              return bs - as;
            })[0];
          if (captcha || noData || candidate || changed) return { bodyText, captcha, noData, candidate };
          return null;
        }, timeoutMs, 500);
        const bodyText = (result?.bodyText || document.body.innerText || "").trim();
        diagnostics.bodyTextSample = bodyText.slice(0, 4000);
        diagnostics.captchaFound = Boolean(result?.captcha || /captcha|recaptcha|i am not a robot|أنا لست روبوت|كابتشا/i.test(bodyText));
        diagnostics.noDataMessageFound = Boolean(result?.noData || /not found|no result|no data|لا توجد|لا يوجد|لم يتم العثور|غير موجود|بيانات غير متاحة/i.test(bodyText));
        diagnostics.resultContainerFound = Boolean(result?.candidate);
        diagnostics.resultSelector = result?.candidate?.el?.id ? "#" + result.candidate.el.id : (result?.candidate?.el?.className ? "." + String(result.candidate.el.className).split(/\\s+/).slice(0, 3).join(".") : "");
        diagnostics.resultText = (result?.candidate?.text || bodyText).slice(0, 8000);
        diagnostics.trackingResultTextCaptured = Boolean(diagnostics.resultText.trim());
        if (!result) return { ...diagnostics, failureCode:"RESULT_NOT_APPEARED", failureMessage:"النتيجة لم تظهر خلال المهلة المحددة" };
        return diagnostics;
      })();
    `;
    const smartResult = await cdpEvaluate(cdp, smartScript, Math.max(35000, Number(settings.timeoutMs || 45000)) + 5000);
    const smartValue = smartResult.result?.value || {};
    if (smartValue.failureCode) throw createTrackingReadError(smartValue.failureCode, smartValue.failureMessage || "تعذر قراءة نتيجة التتبع.", smartValue);
    const smartEvents = extractEgyptPostResultV2(smartValue.resultText || smartValue.bodyTextSample || "", trackingNumber, settings, smartValue);
    return {
      payload: { title: smartValue.pageTitle, url: smartValue.pageUrl, elapsedMs: Date.now() - started, diagnostics: smartValue },
      events: smartEvents,
      source: EGYPT_POST_TRACKING_URL,
      httpStatus: "browser",
      acceptedNumber: trackingNumber,
      providerActual: TRACKING_PROVIDER_NAME,
      eventCount: smartEvents.length,
      realBrowserTracking: true,
      diagnostics: smartValue
    };
    const script = `
      (async () => {
        const trackingNumber = ${JSON.stringify(trackingNumber)};
        const visible = el => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        };
        const inputs = [...document.querySelectorAll("input,textarea")].filter(el => visible(el) && !/hidden|submit|button/i.test(el.type || ""));
        const input = inputs.find(el => /track|trace|barcode|shipment|رقم|تتبع|الشحنة/i.test([el.id, el.name, el.placeholder, el.getAttribute("aria-label")].join(" "))) || inputs[0];
        if (!input) return { inputFound:false, buttonFound:false, text:document.body.innerText };
        input.focus();
        input.value = trackingNumber;
        input.dispatchEvent(new Event("input", { bubbles:true }));
        input.dispatchEvent(new Event("change", { bubbles:true }));
        const controls = [...document.querySelectorAll("button,input[type=submit],a")].filter(visible);
        const button = controls.find(el => /track|trace|search|بحث|تتبع|استعلام/i.test((el.innerText || el.value || el.title || "").trim())) || controls[0];
        if (button) button.click();
        await new Promise(resolve => setTimeout(resolve, 9000));
        return { inputFound:true, buttonFound:Boolean(button), title:document.title, url:location.href, text:document.body.innerText };
      })();
    `;
    const result = await cdp.send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true });
    const value = result.result?.value || {};
    if (!value.inputFound) {
      const error = new Error("تعذر قراءة نتيجة التتبع، قد يكون تصميم الصفحة تغير");
      error.manualIntervention = true;
      throw error;
    }
    const events = extractEgyptPostResult(value.text || "", trackingNumber, settings);
    return {
      payload: { title: value.title, url: value.url, elapsedMs: Date.now() - started },
      events,
      source: EGYPT_POST_TRACKING_URL,
      httpStatus: "browser",
      acceptedNumber: trackingNumber,
      providerActual: TRACKING_PROVIDER_NAME,
      eventCount: events.length,
      realBrowserTracking: true
    };
  } catch (error) {
    if (!error.manualIntervention && /timeout|ECONN|ENOTFOUND|ERR_/i.test(error.message || "")) {
      error.message = "تعذر فتح موقع البريد المصري";
    }
    if (cdp) {
      try {
        error.debug = await captureTrackingDebug(cdp, trackingNumber, shipment.id, error, error.diagnostics || {});
        error.manualIntervention = true;
      } catch (debugError) {
        error.debugCaptureError = debugError.message || String(debugError);
      }
    }
    throw error;
  } finally {
    if (cdp) cdp.close();
    if (chrome?.proc) { try { chrome.proc.kill(); } catch {} }
    if (chrome?.profile) { try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch {} }
  }
}

async function fetch17TrackTracking(db, shipment, settings, trackingNumber) {
  const apiKey = process.env.TRACKING_API_KEY || "";
  if (!apiKey) throw new Error("تعذر تحديث التتبع: مفتاح 17TRACK غير مضبوط في TRACKING_API_KEY.");
  const endpoint = settings.providerEndpoint || TRACKING_17TRACK_ENDPOINT;
  const requestItem = build17TrackRequestItem(trackingNumber, shipment, settings);
  const response = await requestJsonDetailed(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "17token": apiKey
    },
    body: JSON.stringify([requestItem])
  }, Math.max(30000, settings.timeoutMs || 15000));
  const payload = response.payload || {};
  if (payload.code !== 0) {
    const message = payload?.data?.errors?.[0]?.message || payload.message || `17TRACK returned code ${payload.code}`;
    const error = new Error(`تعذر تحديث التتبع: ${message}`);
    error.httpStatus = response.statusCode;
    error.payload = payload;
    throw error;
  }
  const rejectedItem = (payload?.data?.rejected || []).find(row => normalizeTrackingNumber(row.number) === trackingNumber);
  if (rejectedItem) {
    const code = rejectedItem.error?.code ? ` (${rejectedItem.error.code})` : "";
    const error = new Error(`تعذر تحديث التتبع: ${rejectedItem.error?.message || "رفض مزود التتبع الرقم"}${code}`);
    error.httpStatus = response.statusCode;
    error.payload = payload;
    throw error;
  }
  const accepted = payload?.data?.accepted || [];
  const acceptedItem = accepted.find(row => normalizeTrackingNumber(row.number) === trackingNumber) || accepted[0];
  if (!acceptedItem) {
    const error = new Error("تعذر تحديث التتبع: لم يقبل 17TRACK رقم التتبع.");
    error.httpStatus = response.statusCode;
    error.payload = payload;
    throw error;
  }
  const events = parse17TrackEvents(payload, { ...shipment, trackingNumber }, settings);
  if (!events.length) {
    const error = new Error("تم استلام Response حقيقي من 17TRACK لكنه لا يحتوي على أحداث تتبع قابلة للحفظ.");
    error.httpStatus = response.statusCode;
    error.payload = payload;
    throw error;
  }
  return {
    payload,
    events,
    source: endpoint,
    httpStatus: response.statusCode,
    carrierCode: acceptedItem.carrier || requestItem.carrier || "",
    acceptedNumber: acceptedItem.number || trackingNumber,
    providerActual: acceptedItem.track_info?.tracking?.providers?.[0]?.provider?.name || settings.providerName,
    eventCount: events.length
  };
}

async function fetchTrackingFromProvider(db, shipment, requestId) {
  const settings = defaultTrackingSettings(db.settings || {});
  const trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking);
  if (!isValidTrackingNumber(trackingNumber)) throw new Error("رقم التتبع غير صالح.");
  if (settings.manualPause) {
    const error = new Error("يحتاج تدخل يدوي: التتبع متوقف مؤقتًا من الإعدادات.");
    error.manualIntervention = true;
    throw error;
  }
  if (TRACKING_RPA_ENABLED) {
    return fetchLocalRpaTracking(db, shipment, settings, trackingNumber, requestId);
  }
  return fetchEgyptPostBrowserTracking(db, shipment, settings, trackingNumber);
  if (!isValidTrackingNumber(trackingNumber)) throw new Error("رقم التتبع غير صالح.");
  if (/17track/i.test(settings.providerName || "") || /api\.17track\.net/i.test(settings.providerEndpoint || "")) {
    return fetch17TrackTracking(db, shipment, settings, trackingNumber);
  }
  if (!settings.providerEndpoint) {
    throw new Error("مصدر بيانات التتبع غير مضبوط. لم يتم العثور على API رسمي مستقر للبريد المصري داخل النظام.");
  }
  const method = String(settings.providerMethod || "GET").toUpperCase();
  const headers = { "Accept": "application/json", ...settings.providerHeaders };
  let url = settings.providerEndpoint.replace("{trackingNumber}", encodeURIComponent(trackingNumber));
  const options = { method, headers };
  if (method === "GET" && !settings.providerEndpoint.includes("{trackingNumber}")) {
    url += `${url.includes("?") ? "&" : "?"}trackingNumber=${encodeURIComponent(trackingNumber)}`;
  }
  if (method !== "GET") {
    options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
    options.body = JSON.stringify({ trackingNumber });
  }
  const payload = await requestJson(url, options, settings.timeoutMs);
  const events = parseProviderEvents(payload, { ...shipment, trackingNumber }, settings);
  if (!events.length) throw new Error("تم استلام Response حقيقي لكنه لا يحتوي على أحداث تتبع قابلة للقراءة.");
  return { payload, events, source: settings.providerEndpoint };
}

function addNotification(db, alert = {}) {
  db.notifications = db.notifications || [];
  const key = alert.key || `${alert.shipmentId || ""}:${alert.type || ""}`;
  const existing = db.notifications.find(item => item.key === key && item.status !== "closed");
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    existing.message = alert.message || existing.message;
    return existing;
  }
  const item = {
    id: nextId("NTF-", db.notifications),
    key,
    status: "open",
    channel: "in-app",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...alert
  };
  db.notifications.push(item);
  return item;
}

function applyTrackingAlerts(db, shipment) {
  const settings = defaultTrackingSettings(db.settings || {});
  const now = Date.now();
  const lastMovementAt = shipment.lastMovementAt || shipment.shippedAt || shipment.createdAt;
  const noMovementHours = lastMovementAt ? (now - new Date(lastMovementAt).getTime()) / 3600000 : 0;
  shipment.delayHours = shipment.expectedDeliveryAt && !["delivered", "returned_to_sender"].includes(shipment.normalizedStatus)
    ? Math.max(0, (now - new Date(shipment.expectedDeliveryAt).getTime()) / 3600000)
    : 0;
  shipment.delayDays = Math.floor(shipment.delayHours / 24);
  shipment.alertLevel = shipment.delayHours > 0 ? "high" : "info";
  if (noMovementHours >= settings.noMovementHours && !["delivered", "returned_to_sender"].includes(shipment.normalizedStatus)) {
    shipment.alertLevel = "warning";
    addNotification(db, {
      key: `shipment-no-movement:${shipment.id}`,
      type: "no_movement",
      priority: "warning",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: `الشحنة بدون حركة منذ أكثر من ${settings.noMovementHours} ساعة`,
      action: "متابعة الشحنة"
    });
  }
  if (shipment.delayHours > 0) {
    shipment.alertLevel = "high";
    addNotification(db, {
      key: `shipment-delayed:${shipment.id}`,
      type: "delayed",
      priority: "high",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "الشحنة متأخرة عن الموعد المتوقع",
      action: "مراجعة شركة الشحن"
    });
  }
  if (shipment.delayHours > 0 && noMovementHours >= settings.complaintNoMovementHours) {
    shipment.requiresComplaint = true;
    addNotification(db, {
      key: `shipment-complaint:${shipment.id}`,
      type: "complaint_required",
      priority: "high",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "الشحنة مرشحة لتقديم شكوى",
      action: "تجهيز شكوى"
    });
  }
  if (["delivery_attempted", "customer_unavailable", "address_issue"].includes(shipment.normalizedStatus)) {
    shipment.requiresCustomerCall = true;
    addNotification(db, {
      key: `shipment-customer-call:${shipment.id}`,
      type: "customer_call",
      priority: "high",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "يرجى الاتصال بالعميل ومراجعة سبب عدم الاستلام",
      action: "اتصال بالعميل"
    });
  }
  if (["return_initiated", "return_in_transit"].includes(shipment.normalizedStatus)) {
    shipment.returnRisk = true;
    addNotification(db, {
      key: `shipment-return-risk:${shipment.id}`,
      type: "return_risk",
      priority: "high",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "الشحنة في مسار مرتجع أو معرضة للعودة",
      action: "متابعة المرتجع"
    });
  }
  if (shipment.normalizedStatus === "returned_to_sender") {
    shipment.status = "مرتجع";
    shipment.currentStatus = "مرتجع";
    shipment.returnedAt = shipment.returnedAt || new Date().toISOString();
    shipment.alertLevel = "critical";
    addNotification(db, {
      key: `shipment-returned:${shipment.id}`,
      type: "returned",
      priority: "critical",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "تم رصد رجوع الشحنة للمرسل",
      action: "تسجيل مرتجع"
    });
  }
  if (shipment.normalizedStatus === "delivered") {
    shipment.status = "تم التسليم";
    shipment.currentStatus = "تم التسليم";
    shipment.deliveredAt = shipment.deliveredAt || new Date().toISOString();
    shipment.alertLevel = "info";
    addNotification(db, {
      key: `shipment-delivered:${shipment.id}`,
      type: "delivered",
      priority: "info",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: "تم تسليم الشحنة بنجاح",
      action: "إغلاق المتابعة"
    });
  }
}

function syncLinkedOrder(db, shipment) {
  const order = db.onlineOrders?.find(item => item.id === shipment.onlineOrderId);
  if (!order) return;
  if (shipment.normalizedStatus === "delivered") order.status = "تم التسليم";
  if (["return_initiated", "return_in_transit"].includes(shipment.normalizedStatus)) order.status = "مرتجع قيد الطريق";
  if (shipment.normalizedStatus === "returned_to_sender") order.status = "مرتجع";
  if (["delivery_attempted", "customer_unavailable", "address_issue"].includes(shipment.normalizedStatus)) order.requiresCustomerFollowUp = true;
  order.updatedAt = new Date().toISOString();
}

function businessShipmentStatus(normalizedStatus, currentStatus = "") {
  const map = {
    accepted_by_carrier:"تم التسليم للشركة",
    at_sorting_center:"في الطريق",
    in_transit:"في الطريق",
    out_for_delivery:"خرج للتوصيل",
    delivery_attempted:"في الطريق",
    customer_unavailable:"في الطريق",
    address_issue:"في الطريق",
    delayed:"في الطريق",
    held:"في الطريق",
    return_initiated:"مرتجع",
    return_in_transit:"مرتجع",
    returned_to_sender:"مرتجع",
    delivered:"تم التسليم"
  };
  return map[normalizedStatus] || currentStatus;
}

async function trackShipment(db, shipment, { manual = false, requestId = crypto.randomUUID() } = {}) {
  if (trackingActiveShipmentIds.has(shipment.id)) {
    return { ok: false, changed: false, duplicate: true, failureCode: "TRACKING_JOB_ALREADY_RUNNING", error: "يتم تتبع هذه الشحنة حاليًا." };
  }
  trackingActiveShipmentIds.add(shipment.id);
  const settings = defaultTrackingSettings(db.settings || {});
  const started = new Date().toISOString();
  shipment.trackingNumber = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking);
  shipment.tracking = shipment.trackingNumber;
  shipment.lastTrackingAt = started;
  shipment.trackingProvider = settings.providerName;
  trackingLog("backend_received", { requestId, shipmentId:shipment.id });
  try {
    const result = await fetchTrackingFromProvider(db, shipment, requestId);
    shipment.lastTrackingSource = result.source || settings.providerEndpoint || "";
    shipment.lastTrackingHttpStatus = result.httpStatus || "";
    shipment.lastTrackingResponseAt = started;
    shipment.lastTrackingEventCount = Number(result.eventCount || result.events?.length || 0);
    shipment.externalCarrierCode = result.carrierCode || shipment.externalCarrierCode || "";
    shipment.trackingAcceptedNumber = result.acceptedNumber || shipment.trackingAcceptedNumber || shipment.trackingNumber;
    shipment.trackingProviderActual = result.providerActual || shipment.trackingProviderActual || settings.providerName;
    shipment.manualInterventionNeeded = false;
    shipment.manual_review_required = false;
    if (result.diagnostics) {
      shipment.trackingDiagnostics = result.diagnostics;
      if (result.diagnostics.screenshotFile || result.diagnostics.htmlFile || result.diagnostics.jsonFile) {
        shipment.trackingDebug = {
          screenshotFile: result.diagnostics.screenshotFile || "",
          htmlFile: result.diagnostics.htmlFile || "",
          jsonFile: result.diagnostics.jsonFile || ""
        };
        shipment.lastTrackingDebugAt = new Date().toISOString();
      }
    }
    let changed = false;
    db.trackingHistory = db.trackingHistory || [];
    const confirmedEvents = (result.events || []).map(event => ({
      ...event,
      statusText: cleanTrackingText(event.statusText),
      location: cleanTrackingText(event.location)
    })).filter(event => event.statusText || event.location);
    shipment.lastTrackingEventCount = confirmedEvents.length;
    const newHistoryFingerprints = [];
    for (const event of confirmedEvents) {
      const entry = {
        id: nextId("TRK-", db.trackingHistory),
        shipmentId: shipment.id,
        fetchedAt: started,
        ...event
      };
      entry.eventFingerprint = eventFingerprint(entry);
      if (!db.trackingHistory.some(old => old.eventFingerprint === entry.eventFingerprint)) {
        db.trackingHistory.push(entry);
        newHistoryFingerprints.push(entry.eventFingerprint);
        changed = true;
      }
    }
    const latest = confirmedEvents.slice().sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt))[0];
    if (latest) {
      shipment.lastStatusText = latest.statusText;
      shipment.normalizedStatus = latest.normalizedStatus;
      shipment.currentLocation = latest.location;
      shipment.currentStatus = latest.statusText;
      shipment.status = businessShipmentStatus(latest.normalizedStatus, shipment.status);
      shipment.trackingStatus = latest.normalizedStatus;
      shipment.trackingMessage = latest.statusText;
      shipment.lastEvent = latest;
      shipment.lastTrackedAt = started;
      if (latest.normalizedStatus === "delivered") shipment.deliveredAt = shipment.deliveredAt || latest.eventAt || started;
      if (changed) shipment.lastMovementAt = latest.eventAt;
    }
    trackingLog("history_updated", { requestId, shipmentId:shipment.id, ok:true, eventCount:newHistoryFingerprints.length });
    shipment.trackingError = "";
    shipment.trackingErrorCount = 0;
    shipment.trackingRetryPending = false;
    shipment.trackingFailureCode = "";
    shipment.nextTrackingAt = new Date(Date.now() + settings.intervalHours * 3600000).toISOString();
    applyTrackingAlerts(db, shipment);
    syncLinkedOrder(db, shipment);
    shipment.updatedAt = new Date().toISOString();
    shipment.updated = shipment.updatedAt.slice(0, 10);
    trackingLog("shipment_updated", { requestId, shipmentId:shipment.id, ok:true, eventCount:confirmedEvents.length });
    return {
      ok: true,
      changed,
      source: result.source,
      httpStatus: result.httpStatus || "",
      carrierCode: result.carrierCode || "",
      acceptedNumber: result.acceptedNumber || shipment.trackingNumber,
      providerActual: result.providerActual || settings.providerName,
      eventCount: Number(confirmedEvents.length || result.eventCount || 0),
      events: confirmedEvents,
      requestId,
      newHistoryFingerprints,
      rawResult: result.payload || null,
      parsedResult: {
        confirmedStatus: latest?.statusText || "",
        statusCode: latest?.normalizedStatus || "",
        statusLabel: latest?.statusText || "",
        timeline: confirmedEvents,
        events: confirmedEvents,
        normalizedStatus: latest?.normalizedStatus || "",
        lastEvent: latest || null,
        deliveredAt: latest?.normalizedStatus === "delivered" ? (shipment.deliveredAt || latest?.eventAt || "") : "",
        delivered: latest?.normalizedStatus === "delivered",
        lastEventAt: latest?.eventAt || ""
      },
      diagnostics: result.diagnostics || result.payload?.diagnostics || null
    };
  } catch (error) {
    trackingLog("tracking_failed", { requestId, shipmentId:shipment.id, ok:false, level:"error", message:error.code || "TRACKING_FAILED" });
    const offline = error.code === "TRACKING_AGENT_OFFLINE" || ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(error.code);
    shipment.trackingError = offline ? "خدمة التتبع المحلية غير متصلة حاليًا، وسيتم إعادة المحاولة تلقائيًا." : (error.message || "تعذر تحديث التتبع");
    if (!shipment.trackingError || /طھط¹ط°ط±|Tracking request/i.test(shipment.trackingError)) shipment.trackingError = error.message || "تعذر تحديث التتبع";
    shipment.lastTrackingHttpStatus = error.httpStatus || error.statusCode || "";
    shipment.manualInterventionNeeded = Boolean(error.manualIntervention);
    shipment.manual_review_required = Boolean(error.manualIntervention);
    if (error.debug) {
      shipment.trackingDebug = error.debug;
      shipment.lastTrackingDebugAt = new Date().toISOString();
    }
    if (error.diagnostics) shipment.trackingDiagnostics = error.diagnostics;
    shipment.trackingErrorCount = offline ? Number(shipment.trackingErrorCount || 0) : Number(shipment.trackingErrorCount || 0) + 1;
    const retryHours = offline ? settings.intervalHours : Math.min(24, settings.intervalHours * Math.pow(2, Math.min(4, shipment.trackingErrorCount)));
    shipment.nextTrackingAt = new Date(Date.now() + retryHours * 3600000).toISOString();
    shipment.trackingRetryPending = offline;
    shipment.trackingFailureCode = offline ? "TRACKING_AGENT_OFFLINE" : (error.code || error.failureCode || "");
    shipment.updatedAt = new Date().toISOString();
    addNotification(db, {
      key: `${error.manualIntervention ? "shipment-tracking-manual" : "shipment-tracking-error"}:${shipment.id}`,
      type: error.manualIntervention ? "manual_intervention" : "tracking_error",
      priority: error.manualIntervention ? "high" : "warning",
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      message: offline ? "خدمة التتبع غير متصلة؛ ستتم إعادة المحاولة تلقائيًا" : "تعذر تحديث التتبع من المصدر الفعلي",
      action: "اختبار الاتصال"
    });
    return {
      ok: false,
      changed: false,
      error: shipment.trackingError,
      failureCode: offline ? "TRACKING_AGENT_OFFLINE" : (error.code || error.failureCode || ""),
      manualIntervention: Boolean(error.manualIntervention),
      debug: error.debug || null,
      diagnostics: error.diagnostics || null,
      rawResult: error.payload || error.responseText || null,
      parsedResult: null
    };
  } finally {
    trackingActiveShipmentIds.delete(shipment.id);
  }
}

function activeTrackableShipments(db, { manual = false } = {}) {
  const settings = defaultTrackingSettings(db.settings || {});
  const now = Date.now();
  const maxAgeMs = settings.activeShipmentMaxAgeDays * 24 * 3600000;
  return (db.shipments || []).filter(shipment =>
    !shipment.deletedAt &&
    shipment.trackingEnabled !== false &&
    isEgyptPostShipment(shipment) &&
    isValidTrackingNumber(shipment.trackingNumber || shipment.tracking) &&
    !["delivered", "returned_to_sender", "cancelled"].includes(shipment.normalizedStatus) &&
    (manual || !shipment.manualInterventionNeeded) &&
    (manual || !shipment.manual_review_required) &&
    (manual || Number(shipment.trackingErrorCount || 0) < settings.maxAttempts) &&
    (manual || !shipment.nextTrackingAt || new Date(shipment.nextTrackingAt).getTime() <= now) &&
    (manual || !shipment.lastTrackingAt || (now - new Date(shipment.lastTrackingAt).getTime()) >= settings.minIntervalHours * 3600000) &&
    (manual || !shipment.createdAt || Number.isNaN(new Date(shipment.createdAt).getTime()) || (now - new Date(shipment.createdAt).getTime()) <= maxAgeMs) &&
    !["تم التسليم", "مرتجع", "ملغاة", "delivered", "returned", "cancelled"].includes(shipment.status)
  );
}

function buildTrackingRunRecord(settings, shipment, startedAt, result) {
  const finishedAt = new Date().toISOString();
  const debug = result.debug || (!result.ok ? shipment.trackingDebug : {}) || {};
  const diagnostics = result.diagnostics || {};
  return {
    provider: settings.providerName,
    providerType: settings.providerType,
    trackingNumber: normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking),
    shipmentId: shipment.id,
    startedAt,
    finishedAt,
    status: result.ok ? "success" : (result.manualIntervention ? "manual_review_required" : "failed"),
    success: Boolean(result.ok),
    failureCode: result.ok ? "" : (result.failureCode || shipment.trackingDiagnostics?.failureCode || ""),
    failureMessage: result.ok ? "" : (result.error || shipment.trackingError || ""),
    screenshotPath: debug.screenshotFile || diagnostics.screenshotFile || "",
    htmlSnapshotPath: debug.htmlFile || diagnostics.htmlFile || "",
    diagnosticsPath: debug.jsonFile || diagnostics.jsonFile || "",
    rawResult: result.rawResult || null,
    parsedResult: result.parsedResult || null,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
  };
}

async function runTrackingCycle({ manual = false, shipmentId = "", shipmentIds = [], requestId = crypto.randomUUID() } = {}) {
  if (trackingRunning) return { ok: false, message: "Tracking worker is already running." };
  trackingRunning = true;
  const startedAt = new Date().toISOString();
  const batchId = `TRB-${Date.now()}`;
  const summary = { ok: true, requestId, batchId, checked: 0, successful: 0, failed: 0, manualIntervention: 0, changed: 0, unchanged: 0, startedAt, finishedAt: null, errors: [] };
  try {
    if (!fs.existsSync(DB_PATH)) return { ...summary, ok: false, message: "Database not initialized." };
    const db = ensureTrackingDb(readDb());
    const settings = defaultTrackingSettings(db.settings || {});
    trackingRuntime.provider = settings.providerName;
    trackingRuntime.providerType = settings.providerType;
    trackingRuntime.source = settings.providerEndpoint || "Not Available";
    const selected = [shipmentId, ...(Array.isArray(shipmentIds) ? shipmentIds : [])].filter(Boolean);
    const list = selected.length ? db.shipments.filter(item => selected.includes(item.id)) : activeTrackableShipments(db, { manual });
    if (selected.length && list.length !== new Set(selected).size) {
      summary.ok = false;
      summary.finishedAt = new Date().toISOString();
      summary.message = "لم يتم العثور على الشحنة المطلوبة للحفظ.";
      trackingLog("shipment_not_found", { requestId, ok:false, level:"error", message:"SHIPMENT_NOT_FOUND" });
      return summary;
    }
    const persistenceExpectations = [];
    for (const shipment of list) {
      summary.checked += 1;
      const shipmentRunStartedAt = new Date().toISOString();
      const result = await trackShipment(db, shipment, { manual, requestId });
      const runRecord = buildTrackingRunRecord(settings, shipment, shipmentRunStartedAt, result);
      db.trackingRuns = db.trackingRuns || [];
      const run = { id: nextId("TRUN-", db.trackingRuns), batchId: summary.batchId, requestId, manual: Boolean(manual), ...runRecord };
      db.trackingRuns.push(run);
      persistenceExpectations.push({ shipmentId:shipment.id, runId:run.id, successful:result.ok, fingerprints:result.newHistoryFingerprints || [], lastTrackedAt:shipment.lastTrackedAt || "" });
      if (result.ok) summary.successful += 1;
      else {
        summary.failed += 1;
        if (result.manualIntervention) summary.manualIntervention += 1;
        summary.errors.push({ shipmentId: shipment.id, error: result.error });
      }
      if (result.changed) summary.changed += 1;
      else summary.unchanged += 1;
      const delayMs = Math.max(settings.rateLimitMs || 0, settings.minDelaySeconds * 1000);
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    summary.finishedAt = new Date().toISOString();
    db.trackingRuns = db.trackingRuns || [];
    db.trackingRuns = db.trackingRuns.slice(-500);
    db.trackingRunBatches = db.trackingRunBatches || [];
    db.trackingRunBatches.push({ id: summary.batchId, ...summary, manual, provider: settings.providerName });
    db.trackingRunBatches = db.trackingRunBatches.slice(-100);
    writeDb(db);
    const persisted = ensureTrackingDb(readDb());
    for (const expected of persistenceExpectations) {
      const savedShipment = persisted.shipments.find(item => item.id === expected.shipmentId);
      const savedRun = persisted.trackingRuns.some(item => item.id === expected.runId && item.requestId === requestId);
      const savedHistory = expected.fingerprints.every(fingerprint => persisted.trackingHistory.some(item => item.eventFingerprint === fingerprint));
      const savedStatus = !expected.successful || Boolean(savedShipment?.lastTrackedAt && savedShipment?.trackingStatus && savedShipment?.trackingMessage);
      if (!savedShipment || !savedRun || !savedHistory || !savedStatus) {
        summary.ok = false;
        summary.persistenceFailed = true;
        summary.message = "وصلت نتيجة التتبع ولكن تعذر حفظها بالكامل.";
        summary.errors.push({ shipmentId:expected.shipmentId, error:summary.message });
        trackingLog("persistence_failed", { requestId, shipmentId:expected.shipmentId, ok:false, level:"error", message:"PERSISTENCE_VERIFICATION_FAILED" });
      } else {
        trackingLog("persistence_verified", { requestId, shipmentId:expected.shipmentId, ok:true, eventCount:expected.fingerprints.length });
      }
    }
    trackingRuntime.lastRun = summary.finishedAt;
    trackingRuntime.lastSummary = summary;
    trackingRuntime.lastError = summary.errors[0]?.error || "";
    trackingRuntime.nextRun = new Date(Date.now() + settings.intervalHours * 3600000).toISOString();
    return summary;
  } catch (error) {
    summary.ok = false;
    summary.finishedAt = new Date().toISOString();
    summary.errors.push({ error: error.message });
    trackingRuntime.lastError = error.message;
    return summary;
  } finally {
    trackingRunning = false;
  }
}

function scheduleTrackingWorker() {
  if (trackingTimer) clearTimeout(trackingTimer);
  let intervalHours = 6;
  try {
    if (fs.existsSync(DB_PATH)) intervalHours = defaultTrackingSettings(readDb().settings || {}).intervalHours;
  } catch {}
  trackingRuntime.running = true;
  trackingRuntime.nextRun = new Date(Date.now() + intervalHours * 3600000).toISOString();
  trackingTimer = setTimeout(async () => {
    await runTrackingCycle({ manual: false });
    scheduleTrackingWorker();
  }, Math.max(1, intervalHours) * 3600000);
}

function users() {
  try {
    const db = readDb();
    return Array.isArray(db.users) && db.users.length ? db.users : defaultUsers;
  } catch {
    return defaultUsers;
  }
}

function dbRevision() {
  try {
    const stat = fs.statSync(DB_PATH);
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return "0";
  }
}

function safeUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

function sessionUser(req) {
  const token = req.headers["x-session-token"];
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  return session.user;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    ".html":"text/html; charset=utf-8",
    ".js":"application/javascript; charset=utf-8",
    ".css":"text/css; charset=utf-8",
    ".json":"application/json; charset=utf-8",
    ".png":"image/png",
    ".jpg":"image/jpeg",
    ".jpeg":"image/jpeg",
    ".svg":"image/svg+xml",
    ".ico":"image/x-icon"
  }[ext] || "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = decodeURIComponent(url.pathname);

    if (route === "/api/health" && req.method === "GET") {
      return send(res, 200, { ok:true, database: fs.existsSync(DB_PATH), time: new Date().toISOString() });
    }

    if (route === "/api/login" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const user = users().find(item => item.username === payload.username && item.active !== false);
      if (!user || passwordHash(user.salt || "", payload.password) !== user.passwordHash) {
        return send(res, 401, { ok:false, message:"Invalid username or password." });
      }
      const token = crypto.randomUUID().replace(/-/g, "");
      const publicUser = safeUser(user);
      sessions.set(token, { user: publicUser, expires: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
      return send(res, 200, { ok:true, token, user: publicUser });
    }

    if (route === "/api/session" && req.method === "GET") {
      const user = sessionUser(req);
      return send(res, user ? 200 : 401, user ? { ok:true, user } : { ok:false });
    }

    if (route === "/api/logout" && req.method === "POST") {
      const token = req.headers["x-session-token"];
      if (token) sessions.delete(token);
      return send(res, 200, { ok:true });
    }

    if (route === "/api/db" && req.method === "GET") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      if (!fs.existsSync(DB_PATH)) return send(res, 404, { ok:false, message:"Database has not been initialized." });
      return send(res, 200, fs.readFileSync(DB_PATH), "application/json; charset=utf-8", { "X-DB-Revision": dbRevision() });
    }

    if (route === "/api/db" && req.method === "PUT") {
      const user = sessionUser(req);
      if (!user) return send(res, 401, { ok:false, message:"Authentication required." });
      const expected = req.headers["if-match"];
      const current = dbRevision();
      if (expected && expected !== current) return send(res, 409, { ok:false, message:"Data was modified in another window. Reload before saving.", revision: current });
      const body = await readBody(req);
      const parsed = ensureTrackingDb(JSON.parse(body));
      if (!parsed.books || !parsed.sales || !parsed.settings) return send(res, 400, { ok:false, message:"Invalid database structure." });
      const currentDb = fs.existsSync(DB_PATH) ? ensureTrackingDb(readDb()) : { books:[], sales:[], settings:{} };
      const stockValidation = validateNegativeStockWrite(currentDb, parsed, user);
      if (!stockValidation.ok) {
        const row = stockValidation.violations[0];
        return send(res, 403, { ok:false, code:"NEGATIVE_STOCK_FORBIDDEN", message:`لا يمكن إتمام البيع. الرصيد المتاح من «${row.name}» هو ${row.available} والكمية المطلوبة ${row.requested}.`, violations:stockValidation.violations });
      }
      appendNegativeStockAudit(parsed, user, stockValidation.violations);
      writeDb(parsed);
      return send(res, 200, { ok:true, revision: dbRevision() }, "application/json; charset=utf-8", { "X-DB-Revision": dbRevision() });
    }

    if (route.startsWith("/api/tracking/debug/") && req.method === "GET") {
      const user = sessionUser(req);
      if (!user) return send(res, 401, { ok:false, message:"Authentication required." });
      if (!["مالك", "مدير"].includes(user.role) && user.username !== "owner") return send(res, 403, { ok:false, message:"ليس لديك صلاحية لعرض بيانات التشخيص." });
      const fileName = path.basename(decodeURIComponent(route.split("/").pop() || ""));
      const file = path.join(DEBUG_ROOT, fileName);
      if (!fileName || !file.startsWith(DEBUG_ROOT) || !fs.existsSync(file)) return send(res, 404, { ok:false, message:"Debug file not found." });
      return send(res, 200, fs.readFileSync(file), contentType(file));
    }

    if (route === "/api/tracking/status" && req.method === "GET") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      let settings = {};
      let queue = { eligible: 0, pending: 0, manualReview: 0, failed: 0, delivered: 0, updatedToday: 0 };
      const localRpa = await getLocalRpaHealth();
      try {
        if (fs.existsSync(DB_PATH)) {
          const db = ensureTrackingDb(readDb());
          settings = defaultTrackingSettings(db.settings || {});
          const todayKey = new Date().toISOString().slice(0, 10);
          queue = {
            eligible: activeTrackableShipments(db, { manual: false }).length,
            pending: (db.shipments || []).filter(item => item.trackingRetryPending).length,
            manualReview: (db.shipments || []).filter(item => item.manualInterventionNeeded || item.manual_review_required).length,
            failed: (db.shipments || []).filter(item => item.trackingError).length,
            delivered: (db.shipments || []).filter(item => item.normalizedStatus === "delivered" || item.status === "طھظ… ط§ظ„طھط³ظ„ظٹظ…").length,
            updatedToday: (db.shipments || []).filter(item => String(item.lastTrackingAt || "").slice(0, 10) === todayKey).length
          };
        }
      } catch {}
      return send(res, 200, { ok:true, worker: { ...trackingRuntime, running: true, inProgress: trackingRunning }, queue, settings, localRpa });
    }

    if (route === "/api/tracking/rpa/status" && req.method === "GET") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      return send(res, 200, { ok:true, localRpa: await getLocalRpaHealth() });
    }

    if (route === "/api/tracking/rpa/test" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const localRpa = await getLocalRpaHealth();
      return send(res, localRpa.connected ? 200 : 503, { ok:localRpa.connected, localRpa });
    }

    if (route === "/api/tracking/retry-pending" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const db = ensureTrackingDb(readDb());
      const shipmentIds = (db.shipments || []).filter(item => item.trackingRetryPending).map(item => item.id);
      if (!shipmentIds.length) return send(res, 200, { ok:true, checked:0, message:"لا توجد مهام تتبع معلقة." });
      const result = await runTrackingCycle({ manual: true, shipmentIds, requestId:String(req.headers["x-request-id"] || crypto.randomUUID()) });
      return send(res, result.ok ? 200 : 503, result, "application/json; charset=utf-8", { "X-DB-Revision": dbRevision() });
    }

    if (route === "/api/tracking/run" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      let payload = {};
      try { payload = JSON.parse(await readBody(req) || "{}"); } catch {}
      const result = await runTrackingCycle({ manual: true, shipmentIds: Array.isArray(payload.shipmentIds) ? payload.shipmentIds : [], requestId:String(req.headers["x-request-id"] || crypto.randomUUID()) });
      return send(res, result.ok ? 200 : 500, result, "application/json; charset=utf-8", { "X-DB-Revision": dbRevision() });
    }

    if (route.startsWith("/api/tracking/shipment/") && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const id = route.split("/").pop();
      const result = await runTrackingCycle({ manual: true, shipmentId: id, requestId:String(req.headers["x-request-id"] || crypto.randomUUID()) });
      return send(res, result.ok ? 200 : 500, result, "application/json; charset=utf-8", { "X-DB-Revision": dbRevision() });
    }

    if (route === "/api/tracking/test" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const payload = JSON.parse(await readBody(req) || "{}");
      const db = ensureTrackingDb(readDb());
      const trackingNumber = normalizeTrackingNumber(payload.trackingNumber || "ENO33289190EG");
      const shipment = {
        id: "TEST",
        company: "البريد المصري",
        carrier: "Egypt Post",
        tracking: trackingNumber,
        trackingNumber,
        trackingEnabled: true
      };
      const result = await trackShipment(db, shipment, { manual: true });
      return send(res, result.ok ? 200 : 502, { ok: result.ok, trackingNumber, provider: TRACKING_PROVIDER_NAME, source: EGYPT_POST_TRACKING_URL, integrationType: "Official Website Browser Automation", apiKeyConfigured: false, result, message: result.ok ? "تم تشغيل بوت التتبع على موقع البريد المصري واستلام نتيجة قابلة للحفظ." : result.error });
      return send(res, result.ok ? 200 : 502, { ok: result.ok, trackingNumber, result, message: result.ok ? "تم استلام Response حقيقي من مزود التتبع." : result.error });
    }

    if (route === "/api/backup" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const backup = createBackup();
      if (!backup) return send(res, 404, { ok:false, message:"There is no database to back up." });
      return send(res, 200, { ok:true, file:path.basename(backup) });
    }

    if (route === "/api/backups" && req.method === "GET") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      ensureDirs();
      const backups = fs.readdirSync(BACKUP_ROOT)
        .filter(name => /^database-.*\.json$/i.test(name))
        .map(name => {
          const file = path.join(BACKUP_ROOT, name);
          const stat = fs.statSync(file);
          return { name, date: stat.mtime.toISOString(), size: stat.size };
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 30);
      return send(res, 200, { ok:true, backups });
    }

    if (route === "/api/restore" && req.method === "POST") {
      if (!sessionUser(req)) return send(res, 401, { ok:false, message:"Authentication required." });
      const payload = JSON.parse(await readBody(req) || "{}");
      const fileName = path.basename(String(payload.file || ""));
      const source = path.join(BACKUP_ROOT, fileName);
      if (!fileName || !source.startsWith(BACKUP_ROOT) || !fs.existsSync(source)) return send(res, 404, { ok:false, message:"Backup not found." });
      createBackup();
      fs.copyFileSync(source, DB_PATH);
      return send(res, 200, { ok:true, revision: dbRevision() });
    }

    if (route === "/api/reset" && req.method === "POST") {
      return send(res, 403, { ok:false, message:"Database reset is disabled." });
    }

    if (route.startsWith("/api/")) return send(res, 404, { ok:false, message:"API route not found." });

    const rel = route === "/" ? "index.html" : route.replace(/^\/+/, "");
    const file = path.resolve(APP_ROOT, rel);
    if (!file.startsWith(APP_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 404, "Not found", "text/plain; charset=utf-8");
    }
    return send(res, 200, fs.readFileSync(file), contentType(file));
  } catch (error) {
    return send(res, 500, { ok:false, message: error.message || "Server error." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DotCom Library server running: http://${HOST}:${PORT}/`);
  scheduleTrackingWorker();
});
