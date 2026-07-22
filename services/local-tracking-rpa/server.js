const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 8788;
const HOST = "127.0.0.1";
const AGENT_VERSION = require("./package.json").version;
const SHARED_SECRET = String(process.env.TRACKING_RPA_SHARED_SECRET || "");
const ALLOW_MOCKS = String(process.env.TRACKING_RPA_ALLOW_MOCKS || "").toLowerCase() === "true";
const EGYPT_POST_URL = "https://egyptpost.gov.eg/ar-eg/home/eservices/track-and-trace/";
const SERVICE_ROOT = __dirname;
const DOTCOM_ROOT = path.resolve(SERVICE_ROOT, "..", "..");
const PROFILE_ROOT = path.join(SERVICE_ROOT, ".rpa-profile", "egypt-post");
const DEBUG_ROOT = path.join(DOTCOM_ROOT, "debug", "tracking");
const MAX_CONCURRENT = 1;
const MIN_REPEAT_INTERVAL_MS = Number(process.env.LOCAL_TRACKING_RPA_REPEAT_MS || 6 * 60 * 60 * 1000);
const MIN_DELAY_MS = Number(process.env.LOCAL_TRACKING_RPA_MIN_DELAY_MS || 30 * 1000);
const MAX_DELAY_MS = Number(process.env.LOCAL_TRACKING_RPA_MAX_DELAY_MS || 90 * 1000);
const DEFAULT_TIMEOUT_MS = Number(process.env.LOCAL_TRACKING_RPA_TIMEOUT || 120000);

let activeJobs = 0;
let lastAttemptByTrackingNumber = new Map();
let lastAttempt = null;
let lastSuccessfulRunAt = null;
let lastFailureAt = null;
const rateLimitBuckets = new Map();

function json(res, status, body, requestId = "") {
  const payload = Buffer.from(JSON.stringify(body, null, 2), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Request-ID": requestId
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 16384) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try { resolve(text ? JSON.parse(text) : {}); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!SHARED_SECRET) return false;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(SHARED_SECRET, "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function withinRateLimit(req) {
  const key = req.socket.remoteAddress || "local";
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || [];
  const recent = bucket.filter(stamp => now - stamp < 60000);
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return recent.length <= 30;
}

function browserAvailable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];
  if (candidates.some(file => fs.existsSync(file))) return true;
  try {
    const { chromium } = require("playwright");
    return Boolean(chromium.executablePath() && fs.existsSync(chromium.executablePath()));
  } catch {
    return false;
  }
}

function normalizeTrackingNumber(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function ensureDirs() {
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });
  fs.mkdirSync(DEBUG_ROOT, { recursive: true });
}

function safeName(value = "") {
  return String(value || "tracking").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 90) || "tracking";
}

function debugMeta(trackingNumber, shipmentId) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const base = `${safeName(trackingNumber)}-${safeName(shipmentId || "RPA")}-${stamp}-rpa`;
  return {
    screenshotFile: `${base}.png`,
    htmlFile: `${base}.html`,
    jsonFile: `${base}.json`,
    screenshotPath: path.join(DEBUG_ROOT, `${base}.png`),
    htmlPath: path.join(DEBUG_ROOT, `${base}.html`),
    jsonPath: path.join(DEBUG_ROOT, `${base}.json`)
  };
}

async function saveDiagnostics({ page, trackingNumber, shipmentId, failureCode, failureMessage, diagnostics = {} }) {
  const meta = debugMeta(trackingNumber, shipmentId);
  let html = "";
  try { html = page ? await page.content() : ""; }
  catch (error) { html = `<!-- failed to capture html: ${String(error.message || error).slice(0, 300)} -->`; }
  try {
    if (page) await page.screenshot({ path: meta.screenshotPath, fullPage: true });
    else fs.writeFileSync(meta.screenshotPath, Buffer.alloc(0));
  } catch (error) {
    fs.writeFileSync(meta.screenshotPath, Buffer.alloc(0));
    diagnostics.screenshotCaptureError = error.message || String(error);
  }
  fs.writeFileSync(meta.htmlPath, html, "utf8");
  const body = {
    capturedAt: new Date().toISOString(),
    trackingNumber,
    shipmentId,
    failureCode,
    failureMessage,
    browserMode: "headed_chrome",
    profilePath: PROFILE_ROOT,
    ...diagnostics,
    screenshotFile: meta.screenshotFile,
    htmlFile: meta.htmlFile,
    jsonFile: meta.jsonFile
  };
  fs.writeFileSync(meta.jsonPath, JSON.stringify(body, null, 2), "utf8");
  return body;
}

function baseResponse(payload = {}) {
  return {
    success: false,
    provider: "egypt_post",
    confirmedStatus: "",
    timeline: [],
    delivered: false,
    failureCode: "",
    failureMessage: "",
    manualReviewRequired: false,
    diagnostics: {},
    ...payload
  };
}

function mockResponse(provider, trackingNumber, shipmentId) {
  if (provider === "mock_success") {
    const now = new Date().toISOString();
    return baseResponse({
      success: true,
      trackingNumber,
      confirmedStatus: "delivered",
      timeline: [
        { statusText: "تم تسجيل الشحنة", normalizedStatus: "registered", location: "مكتب بريد القاهرة", eventAt: now },
        { statusText: "تم تسليم الشحنة", normalizedStatus: "delivered", location: "القاهرة", eventAt: now }
      ],
      delivered: true,
      diagnostics: { mock: true, shipmentId, browserMode: "mock" }
    });
  }
  if (provider === "mock_site_blocked") {
    return baseResponse({
      trackingNumber,
      failureCode: "SITE_BLOCKED",
      failureMessage: "موقع البريد يمنع التشغيل الآلي",
      manualReviewRequired: true,
      diagnostics: { mock: true, shipmentId, pageTitle: "Attention Required! | Cloudflare" }
    });
  }
  if (provider === "mock_human_verification") {
    return baseResponse({
      trackingNumber,
      failureCode: "HUMAN_VERIFICATION_REQUIRED",
      failureMessage: "ظهرت شاشة تحقق بشري أو CAPTCHA",
      manualReviewRequired: true,
      diagnostics: { mock: true, shipmentId }
    });
  }
  return null;
}

function looksHumanVerification(text = "", title = "", url = "") {
  const haystack = `${title}\n${url}\n${text}`.toLowerCase();
  return /captcha|verify|verification|attention required|cloudflare|human|blocked|تم حظرك|تحقق|كابتشا/.test(haystack);
}

function classifyBlock(text = "", title = "", url = "") {
  const haystack = `${title}\n${url}\n${text}`.toLowerCase();
  if (/cloudflare|attention required|blocked|تم حظرك|security service/.test(haystack)) return "SITE_BLOCKED";
  if (/captcha|verify|verification|human|تحقق|كابتشا/.test(haystack)) return "HUMAN_VERIFICATION_REQUIRED";
  return "";
}

function normalizeStatus(text = "") {
  const lower = String(text || "").toLowerCase();
  if (/برجاء إدخال|ادخل باركود|كيفية الاستخدام|المكان المخصص|please enter|enter tracking/i.test(lower)) return "unknown";
  if (/delivered|تم\s+(?:ال)?تسليم|التسليم والتحصيل|اكتمل|اكتمال/.test(lower)) return "delivered";
  if (/out for delivery|خارج للتسليم|خرج للتوصيل/.test(lower)) return "out_for_delivery";
  if (/transit|نقل|معالجة|في الطريق|الشحن/.test(lower)) return "in_transit";
  if (/registered|accepted|تسجيل|استلام/.test(lower)) return "registered";
  if (/return|مرتجع|رجوع|عودة/.test(lower)) return "returned";
  return "unknown";
}

function isInstructionalText(line = "") {
  return /برجاء إدخال|ادخل باركود|يمكنك إدخال|كيفية الاستخدام|المكان المخصص|مثال|تتبع شحنتك|please enter|enter tracking|how to use/i.test(String(line || ""));
}

function extractTimelineFromText(text = "", trackingNumber = "") {
  const lines = String(text || "")
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line !== trackingNumber);
  const meaningful = lines
    .filter(line => !isInstructionalText(line))
    .filter(line => /(تسجيل|الشحن|نقل|معالجة|تسليم|اكتمل|delivered|transit|registered|accepted|arrival|departure)/i.test(line));
  const baseTime = Date.now();
  const timeline = meaningful.slice(0, 20).map((line, index) => ({
    statusText: line,
    normalizedStatus: normalizeStatus(line),
    location: "",
    eventAt: new Date(baseTime + index * 1000).toISOString(),
    sourceIndex: index
  }));
  return timeline.filter(item => item.normalizedStatus !== "unknown");
}

async function findInput(page) {
  const selectors = [
    "textarea:visible",
    "input[type='text']:visible",
    "input:not([type]):visible",
    "input[placeholder*='تتبع']:visible",
    "input[placeholder*='tracking' i]:visible",
    "[role='textbox']:visible"
  ];
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (await loc.count().catch(() => 0)) return loc;
  }
  return null;
}

async function findSubmitButton(page) {
  const candidates = [
    page.getByRole("button", { name: /تتبع|track|بحث|search/i }).first(),
    page.locator("button:visible, input[type='button']:visible, input[type='submit']:visible, a:visible, [role='button']:visible").filter({ hasText: /تتبع|track|بحث|search/i }).first(),
    page.locator("input[type='submit']:visible").first(),
    page.getByText(/تتبع شحنتك|Track/i).last()
  ];
  for (const loc of candidates) {
    if (await loc.count().catch(() => 0)) return loc;
  }
  return null;
}

async function realTrack(payload) {
  const trackingNumber = normalizeTrackingNumber(payload.trackingNumber);
  const shipmentId = payload.shipmentId || "";
  const startedAt = Date.now();
  let playwright;
  try {
    playwright = require("playwright");
  } catch (error) {
    const diagnostics = await saveDiagnostics({
      trackingNumber,
      shipmentId,
      failureCode: "PLAYWRIGHT_NOT_INSTALLED",
      failureMessage: "Playwright غير مثبت داخل خدمة RPA",
      diagnostics: { browserMode: "headed_chrome", profilePath: PROFILE_ROOT }
    });
    return baseResponse({ trackingNumber, failureCode: "PLAYWRIGHT_NOT_INSTALLED", failureMessage: "Playwright غير مثبت داخل خدمة RPA. شغّل npm install ثم npm run install:browsers.", manualReviewRequired: true, diagnostics });
  }

  let context;
  let page;
  try {
    ensureDirs();
    context = await playwright.chromium.launchPersistentContext(PROFILE_ROOT, {
      headless: false,
      channel: process.env.LOCAL_TRACKING_RPA_CHANNEL || "chrome",
      viewport: { width: 1366, height: 900 },
      slowMo: Number(process.env.LOCAL_TRACKING_RPA_SLOWMO || 250),
      timeout: DEFAULT_TIMEOUT_MS
    }).catch(() => playwright.chromium.launchPersistentContext(PROFILE_ROOT, {
      headless: false,
      viewport: { width: 1366, height: 900 },
      slowMo: Number(process.env.LOCAL_TRACKING_RPA_SLOWMO || 250),
      timeout: DEFAULT_TIMEOUT_MS
    }));
    page = context.pages()[0] || await context.newPage();
    await page.goto(EGYPT_POST_URL, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);

    let title = await page.title().catch(() => "");
    let bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    let failureCode = classifyBlock(bodyText, title, page.url());
    if (failureCode) {
      if (failureCode === "HUMAN_VERIFICATION_REQUIRED") await page.waitForTimeout(Number(process.env.LOCAL_TRACKING_RPA_HUMAN_WAIT_MS || 60000));
      title = await page.title().catch(() => title);
      bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
      failureCode = classifyBlock(bodyText, title, page.url()) || failureCode;
      if (looksHumanVerification(bodyText, title, page.url())) {
        const diagnostics = await saveDiagnostics({
          page,
          trackingNumber,
          shipmentId,
          failureCode,
          failureMessage: failureCode === "SITE_BLOCKED" ? "موقع البريد يمنع التشغيل الآلي" : "ظهرت شاشة تحقق بشري أو CAPTCHA",
          diagnostics: { pageOpened: true, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt }
        });
        return baseResponse({ trackingNumber, failureCode, failureMessage: diagnostics.failureMessage, manualReviewRequired: true, diagnostics });
      }
    }

    const input = await findInput(page);
    if (!input) {
      const diagnostics = await saveDiagnostics({
        page,
        trackingNumber,
        shipmentId,
        failureCode: "INPUT_NOT_FOUND",
        failureMessage: "خانة رقم التتبع غير موجودة",
        diagnostics: { pageOpened: true, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt }
      });
      return baseResponse({ trackingNumber, failureCode: "INPUT_NOT_FOUND", failureMessage: "خانة رقم التتبع غير موجودة", manualReviewRequired: true, diagnostics });
    }

    await input.click();
    await input.fill("");
    await input.type(trackingNumber, { delay: 80 });
    let submitMethod = "";
    await input.press("Enter").then(() => { submitMethod = "enter"; }).catch(() => {});
    await page.waitForTimeout(1000);
    const button = await findSubmitButton(page);
    if (button) {
      await button.click();
      submitMethod = "button";
    }
    if (!submitMethod) await input.press("Enter").then(() => { submitMethod = "enter"; }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    title = await page.title().catch(() => "");
    bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    failureCode = classifyBlock(bodyText, title, page.url());
    if (failureCode) {
      const diagnostics = await saveDiagnostics({
        page,
        trackingNumber,
        shipmentId,
        failureCode,
        failureMessage: failureCode === "SITE_BLOCKED" ? "موقع البريد يمنع التشغيل الآلي" : "ظهرت شاشة تحقق بشري أو CAPTCHA",
        diagnostics: { pageOpened: true, trackingInputFound: true, submitClicked: Boolean(submitMethod), submitMethod, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt }
      });
      return baseResponse({ trackingNumber, failureCode, failureMessage: diagnostics.failureMessage, manualReviewRequired: true, diagnostics });
    }

    const timeline = extractTimelineFromText(bodyText, trackingNumber);
    if (!timeline.length) {
      const diagnostics = await saveDiagnostics({
        page,
        trackingNumber,
        shipmentId,
        failureCode: "RESULT_NOT_FOUND",
        failureMessage: "لم تظهر نتيجة تتبع مؤكدة",
        diagnostics: { pageOpened: true, trackingInputFound: true, submitClicked: Boolean(submitMethod), submitMethod, bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt }
      });
      return baseResponse({ trackingNumber, failureCode: "RESULT_NOT_FOUND", failureMessage: "لم تظهر نتيجة تتبع مؤكدة", manualReviewRequired: true, diagnostics });
    }

    const latest = timeline[timeline.length - 1] || {};
    const delivered = timeline.some(item => item.normalizedStatus === "delivered");
    const diagnostics = await saveDiagnostics({
      page,
      trackingNumber,
      shipmentId,
      failureCode: "",
      failureMessage: "",
      diagnostics: { pageOpened: true, trackingInputFound: true, submitClicked: Boolean(submitMethod), submitMethod, resultContainerFound: true, trackingResultTextCaptured: true, parsedConfirmedStatus: true, durationMs: Date.now() - startedAt, bodyTextSample: bodyText.slice(0, 4000) }
    });
    return baseResponse({
      success: true,
      trackingNumber,
      confirmedStatus: delivered ? "delivered" : (latest.normalizedStatus || "unknown"),
      timeline,
      delivered,
      diagnostics
    });
  } catch (error) {
    const diagnostics = await saveDiagnostics({
      page,
      trackingNumber,
      shipmentId,
      failureCode: error.name === "TimeoutError" ? "TIMEOUT" : "UNKNOWN_ERROR",
      failureMessage: error.message || "حدث خطأ غير معروف",
      diagnostics: { durationMs: Date.now() - startedAt }
    });
    return baseResponse({ trackingNumber, failureCode: diagnostics.failureCode, failureMessage: diagnostics.failureMessage, manualReviewRequired: true, diagnostics });
  } finally {
    if (context && process.env.LOCAL_TRACKING_RPA_KEEP_OPEN !== "true") await context.close().catch(() => {});
  }
}

async function track(payload = {}) {
  const trackingNumber = normalizeTrackingNumber(payload.trackingNumber);
  if (!/^[A-Z0-9]{8,30}$/.test(trackingNumber)) {
    return baseResponse({ trackingNumber, failureCode: "INVALID_TRACKING_NUMBER", failureMessage: "رقم التتبع غير صالح", manualReviewRequired: true });
  }
  const mock = ALLOW_MOCKS ? mockResponse(payload.provider, trackingNumber, payload.shipmentId) : null;
  if (mock) {
    if (mock.success) lastSuccessfulRunAt = new Date().toISOString();
    else lastFailureAt = new Date().toISOString();
    return mock;
  }
  const now = Date.now();
  const previous = lastAttemptByTrackingNumber.get(trackingNumber);
  if (!payload.force && previous && now - previous < MIN_REPEAT_INTERVAL_MS) {
    return baseResponse({
      trackingNumber,
      failureCode: "RATE_LIMITED",
      failureMessage: "تم تتبع نفس الكود خلال آخر 6 ساعات",
      manualReviewRequired: false,
      diagnostics: { lastAttemptAt: new Date(previous).toISOString() }
    });
  }
  if (activeJobs >= MAX_CONCURRENT) {
    return baseResponse({ trackingNumber, failureCode: "BUSY", failureMessage: "خدمة RPA مشغولة الآن", manualReviewRequired: false });
  }
  activeJobs += 1;
  try {
    if (lastAttempt) {
      const elapsed = now - lastAttempt;
      const minDelay = Math.floor(MIN_DELAY_MS + Math.random() * Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS));
      if (elapsed < minDelay) await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
    }
    lastAttemptByTrackingNumber.set(trackingNumber, Date.now());
    lastAttempt = Date.now();
    const result = await realTrack({ ...payload, trackingNumber });
    if (result.success) lastSuccessfulRunAt = new Date().toISOString();
    else lastFailureAt = new Date().toISOString();
    return result;
  } catch (error) {
    lastFailureAt = new Date().toISOString();
    throw error;
  } finally {
    activeJobs -= 1;
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 128);
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (!authorized(req)) return json(res, 401, { status: "unauthorized", requestId }, requestId);
    if (!withinRateLimit(req)) return json(res, 429, { status: "rate_limited", requestId }, requestId);
    if (url.pathname === "/health" && req.method === "GET") {
      return json(res, 200, {
        status: "ok",
        agentVersion: AGENT_VERSION,
        browserAvailable: browserAvailable(),
        activeJob: activeJobs > 0,
        lastSuccessfulRunAt,
        lastFailureAt
      }, requestId);
    }
    if (url.pathname === "/track" && req.method === "POST") {
      const payload = await readBody(req);
      const result = await track(payload);
      console.log(JSON.stringify({ event: "tracking_attempt", requestId, success: Boolean(result.success), failureCode: result.failureCode || "" }));
      return json(res, 200, { ...result, requestId }, requestId);
    }
    return json(res, 404, { status: "not_found", requestId }, requestId);
  } catch (error) {
    lastFailureAt = new Date().toISOString();
    return json(res, error.statusCode || 500, { ...baseResponse({ failureCode: "UNKNOWN_ERROR", failureMessage: error.message || String(error), manualReviewRequired: true }), requestId }, requestId);
  }
});

server.listen(PORT, HOST, () => {
  ensureDirs();
  if (!SHARED_SECRET) {
    console.error("TRACKING_RPA_SHARED_SECRET is required. The agent will reject every request until it is configured.");
  }
  console.log(`Tracking Agent ${AGENT_VERSION} listening on http://${HOST}:${PORT}`);
});
