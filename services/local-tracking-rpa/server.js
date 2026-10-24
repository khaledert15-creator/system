const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseEgyptPostSteps, stepsFromShipmentDetails } = require("./tracking-parser");

const PORT = Number(process.env.LOCAL_TRACKING_RPA_PORT || 8788);
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
// The System decides how often each shipment is checked (every 2 hours when out for delivery); this only stops
// the same code being searched twice in a row.
const MIN_REPEAT_INTERVAL_MS = Number(process.env.LOCAL_TRACKING_RPA_REPEAT_MS || 60 * 60 * 1000);
// The site's track page takes up to 10 barcodes per search.
const MAX_BATCH_SIZE = 10;
const MIN_DELAY_MS = Number(process.env.LOCAL_TRACKING_RPA_MIN_DELAY_MS || 30 * 1000);
const MAX_DELAY_MS = Number(process.env.LOCAL_TRACKING_RPA_MAX_DELAY_MS || 90 * 1000);
const DEFAULT_TIMEOUT_MS = Number(process.env.LOCAL_TRACKING_RPA_TIMEOUT || 120000);

let activeJobs = 0;
let lastAttemptByTrackingNumber = new Map();
let lastAttempt = null;
let lastSuccessfulRunAt = null;
let lastFailureAt = null;
const rateLimitBuckets = new Map();
const KEEP_WINDOW = process.env.LOCAL_TRACKING_RPA_KEEP_OPEN !== "false";
let sharedContext = null;
let sharedPage = null;
let windowMinimized = false;
// The server retries a request with the same X-Request-ID when its connection drops; the retry gets the
// original result (or waits for it) instead of searching the site again or being refused as busy.
const recentRequests = new Map();
const RECENT_REQUEST_TTL_MS = 15 * 60 * 1000;

function trackOnce(requestId, payload, run = track) {
  const now = Date.now();
  for (const [id, entry] of recentRequests) if (now - entry.at > RECENT_REQUEST_TTL_MS) recentRequests.delete(id);
  const existing = requestId && recentRequests.get(requestId);
  if (existing) return { promise: existing.promise, repeated: true, entry: existing };
  const entry = { at: now, result: null };
  entry.promise = run(payload).then(result => {
    entry.result = result;
    console.log(JSON.stringify({ event: "tracking_attempt", requestId, success: Boolean(result.success), failureCode: result.failureCode || "", batchSize: Array.isArray(result.results) ? result.results.length : undefined }));
    return result;
  });
  if (requestId) recentRequests.set(requestId, entry);
  entry.promise.catch(() => recentRequests.delete(requestId));
  return { promise: entry.promise, repeated: false, entry };
}

// Returns the bundle id of the app the user is working in, so focus can be handed back after Chrome opens.
function frontmostBundleId() {
  if (process.platform !== "darwin") return "";
  try {
    const { execFileSync } = require("child_process");
    const asn = execFileSync("lsappinfo", ["front"], { encoding: "utf8", timeout: 2000 }).trim();
    const info = execFileSync("lsappinfo", ["info", "-only", "bundleid", asn], { encoding: "utf8", timeout: 2000 });
    return info.match(/"CFBundleIdentifier"="([^"]+)"/)?.[1] || "";
  } catch { return ""; }
}

function restoreFocus(bundleId) {
  if (!bundleId || /chrome|chromium/i.test(bundleId)) return;
  try { require("child_process").execFile("open", ["-b", bundleId], { timeout: 3000 }, () => {}); } catch {}
}

async function setWindowState(page, windowState) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState } });
    windowMinimized = windowState === "minimized";
    await session.detach().catch(() => {});
  } catch {}
}

// One headed Chrome window is opened once, minimized, and reused for every shipment.
async function trackingPage(playwright) {
  if (sharedContext) {
    if (sharedPage && !sharedPage.isClosed()) return sharedPage;
    try { sharedPage = sharedContext.pages().find(item => !item.isClosed()) || await sharedContext.newPage(); return sharedPage; }
    catch { sharedContext = null; sharedPage = null; }
  }
  const previousApp = frontmostBundleId();
  const options = {
    headless: false,
    chromiumSandbox: true,
    viewport: { width: 1366, height: 900 },
    slowMo: Number(process.env.LOCAL_TRACKING_RPA_SLOWMO || 250),
    timeout: DEFAULT_TIMEOUT_MS,
    // A minimized window must keep loading and running scripts at normal speed.
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
  };
  const context = await playwright.chromium.launchPersistentContext(PROFILE_ROOT, { ...options, channel: process.env.LOCAL_TRACKING_RPA_CHANNEL || "chrome" })
    .catch(() => playwright.chromium.launchPersistentContext(PROFILE_ROOT, options));
  context.on("close", () => { if (sharedContext === context) { sharedContext = null; sharedPage = null; } });
  const page = context.pages()[0] || await context.newPage();
  await setWindowState(page, "minimized");
  restoreFocus(previousApp);
  if (KEEP_WINDOW) { sharedContext = context; sharedPage = page; }
  return page;
}

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
  // Chrome cannot capture a minimized window: page.screenshot waits its full 30 s timeout and then fails, which
  // slowed every tracking request. While minimized the HTML snapshot is the page record and no image is taken.
  let screenshotFile = "";
  if (!page) diagnostics.screenshotSkipped = "no_page";
  else if (windowMinimized) diagnostics.screenshotSkipped = "window_minimized";
  else {
    try {
      const image = await page.screenshot({ fullPage: true, timeout: 5000 });
      if (image && image.length > 1024) { fs.writeFileSync(meta.screenshotPath, image); screenshotFile = meta.screenshotFile; }
    } catch (error) {
      diagnostics.screenshotCaptureError = error.message || String(error);
    }
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
    screenshotFile,
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
    page.locator(".trackTraceInput .custBtn:not(.disableBtn .custBtn)").first(),
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

function blockMessage(failureCode) {
  return failureCode === "SITE_BLOCKED" ? "موقع البريد يمنع التشغيل الآلي" : "ظهرت شاشة تحقق بشري أو CAPTCHA";
}

// Opens the track page, waiting for a person when the site shows its own check. failureCode is set only when the
// site is still refusing afterwards.
async function loadTrackingSite(page) {
  // The page re-runs the previous search saved in localStorage when it opens; clearing it saves those lookups.
  if (page.url().startsWith("https://egyptpost.gov.eg")) await page.evaluate(() => window.localStorage.removeItem("ordersId")).catch(() => {});
  await page.goto(EGYPT_POST_URL, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  let title = await page.title().catch(() => "");
  let bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  let failureCode = classifyBlock(bodyText, title, page.url());
  if (!failureCode) return { title, bodyText, failureCode: "" };
  if (failureCode === "HUMAN_VERIFICATION_REQUIRED") {
    // Show the window only when a person has to complete the site's check.
    await setWindowState(page, "normal");
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(Number(process.env.LOCAL_TRACKING_RPA_HUMAN_WAIT_MS || 60000));
  }
  title = await page.title().catch(() => title);
  bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
  failureCode = classifyBlock(bodyText, title, page.url()) || failureCode;
  return { title, bodyText, failureCode: looksHumanVerification(bodyText, title, page.url()) ? failureCode : "" };
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
    page = await trackingPage(playwright);
    context = page.context();
    let { title, bodyText, failureCode } = await loadTrackingSite(page);
    if (failureCode) {
      const diagnostics = await saveDiagnostics({
        page,
        trackingNumber,
        shipmentId,
        failureCode,
        failureMessage: blockMessage(failureCode),
        diagnostics: { pageOpened: true, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt }
      });
      return baseResponse({ trackingNumber, failureCode, failureMessage: diagnostics.failureMessage, manualReviewRequired: true, diagnostics });
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
    const button = await findSubmitButton(page);
    const resultResponse = page.waitForResponse(response => response.url().includes("/TrackTrace/GetShipmentDetails"), { timeout: 45000 }).catch(() => null);
    if (button) {
      await button.click();
      submitMethod = "button";
    }
    const providerResponse = submitMethod ? await resultResponse : null;
    if (providerResponse?.status() === 429) {
      return baseResponse({ trackingNumber, failureCode: "SITE_RATE_LIMITED", failureMessage: "موقع البريد حدّد عدد طلبات التتبع مؤقتًا؛ ستتم إعادة المحاولة.", manualReviewRequired: false });
    }
    if (providerResponse && providerResponse.status() >= 400) {
      return baseResponse({ trackingNumber, failureCode: "SITE_UNAVAILABLE", failureMessage: "موقع البريد لا يعرض بيانات التتبع حاليًا؛ ستتم إعادة المحاولة.", manualReviewRequired: false });
    }
    await page.locator(".ordersListingItem__title h3").filter({ hasText: trackingNumber }).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});

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

    // The site's own JSON answer is read first; the result page text is the fallback.
    const providerBody = providerResponse ? await providerResponse.json().catch(() => null) : null;
    const jsonSteps = stepsFromShipmentDetails(providerBody);
    const steps = jsonSteps.length ? jsonSteps : await page.locator(".ordersListingItem__title h3").filter({ hasText: trackingNumber }).first().count()
      ? await page.locator(".ordersListingItem .order__container").evaluateAll(nodes => nodes.map(node => ({
          fields: Array.from(node.querySelectorAll(".ordersListingItem__item__data > p"), item => item.textContent.trim())
        })))
      : [];
    const timeline = parseEgyptPostSteps(steps, trackingNumber);
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
    if (context && !KEEP_WINDOW) await context.close().catch(() => {});
    // Diagnostics (including a screenshot of a verification page) are saved first; then the window goes back down.
    else if (page && !page.isClosed() && !windowMinimized) await setWindowState(page, "minimized");
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

// Batch answers the System treats as "this code was not looked up properly" and searches alone instead.
const BATCH_FAILED = "BATCH_FAILED";
const BATCH_ITEM_MISSING = "BATCH_ITEM_MISSING";

function batchItemFailure(trackingNumber, failureCode, failureMessage, extra = {}) {
  return baseResponse({ trackingNumber, failureCode, failureMessage, manualReviewRequired: false, ...extra });
}

function batchResultFromDetails(trackingNumber, httpStatus, body) {
  if (!httpStatus) return batchItemFailure(trackingNumber, BATCH_ITEM_MISSING, "لم يصل رد موقع البريد لهذا الكود ضمن البحث المجمّع");
  if (httpStatus === 429) return batchItemFailure(trackingNumber, "SITE_RATE_LIMITED", "موقع البريد حدّد عدد طلبات التتبع مؤقتًا؛ ستتم إعادة المحاولة.");
  if (httpStatus >= 400) return batchItemFailure(trackingNumber, "SITE_UNAVAILABLE", "موقع البريد لا يعرض بيانات التتبع حاليًا؛ ستتم إعادة المحاولة.");
  if (!body || body.success !== true || !body.data) return batchItemFailure(trackingNumber, BATCH_ITEM_MISSING, "رد موقع البريد لهذا الكود غير مكتمل");
  const rows = Array.isArray(body.data.data) ? body.data.data.filter(row => row && row.itemStatus) : [];
  const timeline = parseEgyptPostSteps(stepsFromShipmentDetails(body), trackingNumber);
  // Events the parser cannot read yet are looked up alone, where the result page text is read as well.
  if (rows.length && !timeline.length) return batchItemFailure(trackingNumber, BATCH_ITEM_MISSING, "تعذر قراءة أحداث هذا الكود من البحث المجمّع");
  if (!timeline.length) return baseResponse({ trackingNumber, failureCode: "RESULT_NOT_FOUND", failureMessage: "لم تظهر نتيجة تتبع مؤكدة", manualReviewRequired: true });
  const latest = timeline[timeline.length - 1] || {};
  const delivered = timeline.some(item => item.normalizedStatus === "delivered");
  return baseResponse({ success: true, trackingNumber, confirmedStatus: delivered ? "delivered" : (latest.normalizedStatus || "unknown"), timeline, delivered });
}

// Searches up to 10 codes at once the way a person does on the site: one barcode per line, then one click. The site
// answers each barcode with its own GetShipmentDetails reply, which is read per code.
async function realTrackBatch(trackingNumbers) {
  const startedAt = Date.now();
  const label = `${trackingNumbers[0]}-BATCH${trackingNumbers.length}`;
  const failAll = (failureCode, failureMessage, manualReviewRequired, diagnostics = {}) =>
    trackingNumbers.map(trackingNumber => baseResponse({ trackingNumber, failureCode, failureMessage, manualReviewRequired, diagnostics }));
  let playwright;
  try { playwright = require("playwright"); }
  catch { return { results: failAll("PLAYWRIGHT_NOT_INSTALLED", "Playwright غير مثبت داخل خدمة RPA. شغّل npm install ثم npm run install:browsers.", true), stopCycle: true, failureCode: "PLAYWRIGHT_NOT_INSTALLED" }; }

  const replies = new Map();
  const onResponse = response => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (!/\/TrackTrace\/GetShipmentDetails$/i.test(url.pathname)) return;
    const barcode = normalizeTrackingNumber(url.searchParams.get("barcode"));
    if (!trackingNumbers.includes(barcode) || replies.has(barcode)) return;
    replies.set(barcode, response.json().catch(() => null).then(body => ({ status: response.status(), body })));
  };
  let context;
  let page;
  try {
    ensureDirs();
    page = await trackingPage(playwright);
    context = page.context();
    let { title, bodyText, failureCode } = await loadTrackingSite(page);
    if (failureCode) {
      const diagnostics = await saveDiagnostics({ page, trackingNumber: label, shipmentId: "", failureCode, failureMessage: blockMessage(failureCode), diagnostics: { batch: trackingNumbers, pageOpened: true, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt } });
      return { results: failAll(failureCode, diagnostics.failureMessage, true, diagnostics), stopCycle: true, failureCode };
    }
    for (const [index, trackingNumber] of trackingNumbers.entries()) {
      const input = page.locator(`.trackTraceInput input.input${index}, input.input${index}`).first();
      await input.waitFor({ state: "visible", timeout: 10000 });
      await input.click();
      await input.fill("");
      await input.type(trackingNumber, { delay: 80 });
      // Enter opens the next barcode line.
      if (index < trackingNumbers.length - 1) await input.press("Enter");
    }
    const button = await findSubmitButton(page);
    if (!button) throw Object.assign(new Error("زر التتبع غير موجود"), { failureCode: "INPUT_NOT_FOUND" });
    page.on("response", onResponse);
    await button.click();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && replies.size < trackingNumbers.length) await page.waitForTimeout(500);
    const answers = new Map();
    for (const [barcode, reply] of replies) answers.set(barcode, await reply);

    title = await page.title().catch(() => "");
    bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    failureCode = classifyBlock(bodyText, title, page.url());
    if (failureCode && !answers.size) {
      const diagnostics = await saveDiagnostics({ page, trackingNumber: label, shipmentId: "", failureCode, failureMessage: blockMessage(failureCode), diagnostics: { batch: trackingNumbers, pageOpened: true, submitClicked: true, pageTitle: title, pageUrl: page.url(), bodyTextSample: bodyText.slice(0, 4000), durationMs: Date.now() - startedAt } });
      return { results: failAll(failureCode, diagnostics.failureMessage, true, diagnostics), stopCycle: true, failureCode };
    }
    const results = trackingNumbers.map(trackingNumber => {
      const answer = answers.get(trackingNumber);
      return batchResultFromDetails(trackingNumber, answer?.status || 0, answer?.body || null);
    });
    const diagnostics = await saveDiagnostics({ page, trackingNumber: label, shipmentId: "", failureCode: "", failureMessage: "", diagnostics: { batch: trackingNumbers, pageOpened: true, submitClicked: true, repliesReceived: answers.size, results: results.map(item => ({ trackingNumber: item.trackingNumber, success: item.success, failureCode: item.failureCode })), durationMs: Date.now() - startedAt } });
    for (const result of results) result.diagnostics = { batch: true, durationMs: diagnostics.durationMs, htmlFile: diagnostics.htmlFile, jsonFile: diagnostics.jsonFile };
    const rateLimited = results.some(item => item.failureCode === "SITE_RATE_LIMITED");
    return { results, stopCycle: rateLimited, failureCode: rateLimited ? "SITE_RATE_LIMITED" : "" };
  } catch (error) {
    const diagnostics = await saveDiagnostics({ page, trackingNumber: label, shipmentId: "", failureCode: BATCH_FAILED, failureMessage: error.message || "تعذر البحث المجمّع", diagnostics: { batch: trackingNumbers, durationMs: Date.now() - startedAt } });
    return { results: trackingNumbers.map(trackingNumber => batchItemFailure(trackingNumber, BATCH_FAILED, "تعذر البحث المجمّع؛ سيتم البحث عن الكود منفردًا.", { diagnostics })), stopCycle: false, failureCode: BATCH_FAILED };
  } finally {
    if (page) page.off("response", onResponse);
    if (context && !KEEP_WINDOW) await context.close().catch(() => {});
    else if (page && !page.isClosed() && !windowMinimized) await setWindowState(page, "minimized");
  }
}

// POST /track-batch: { items: [{ shipmentId, trackingNumber }], force }. Every code gets the same answer shape as
// /track, in "results". A code whose failureCode is BATCH_FAILED or BATCH_ITEM_MISSING was not looked up and the
// System searches it alone; stopCycle means the site is refusing lookups for now.
async function trackBatch(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length || items.length > MAX_BATCH_SIZE) {
    return { success: false, batch: true, results: [], failureCode: "INVALID_BATCH", failureMessage: `البحث المجمّع يقبل من 1 إلى ${MAX_BATCH_SIZE} أكواد` };
  }
  const now = Date.now();
  const answers = new Map();
  const toSearch = [];
  for (const item of items) {
    const trackingNumber = normalizeTrackingNumber(item?.trackingNumber);
    if (answers.has(trackingNumber) || toSearch.includes(trackingNumber)) continue;
    if (!/^[A-Z0-9]{8,30}$/.test(trackingNumber)) {
      answers.set(trackingNumber, baseResponse({ trackingNumber, failureCode: "INVALID_TRACKING_NUMBER", failureMessage: "رقم التتبع غير صالح", manualReviewRequired: true }));
      continue;
    }
    const previous = lastAttemptByTrackingNumber.get(trackingNumber);
    if (!payload.force && previous && now - previous < MIN_REPEAT_INTERVAL_MS) {
      answers.set(trackingNumber, baseResponse({ trackingNumber, failureCode: "RATE_LIMITED", failureMessage: "تم تتبع نفس الكود منذ قليل", manualReviewRequired: false, diagnostics: { lastAttemptAt: new Date(previous).toISOString() } }));
      continue;
    }
    toSearch.push(trackingNumber);
  }
  let outcome = { results: [], stopCycle: false, failureCode: "" };
  if (toSearch.length && activeJobs >= MAX_CONCURRENT) {
    for (const trackingNumber of toSearch) answers.set(trackingNumber, baseResponse({ trackingNumber, failureCode: "BUSY", failureMessage: "خدمة RPA مشغولة الآن", manualReviewRequired: false }));
  } else if (toSearch.length) {
    activeJobs += 1;
    try {
      if (lastAttempt) {
        const elapsed = Date.now() - lastAttempt;
        const minDelay = Math.floor(MIN_DELAY_MS + Math.random() * Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS));
        if (elapsed < minDelay) await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
      }
      lastAttempt = Date.now();
      outcome = await realTrackBatch(toSearch);
    } finally {
      activeJobs -= 1;
    }
    for (const result of outcome.results) {
      answers.set(result.trackingNumber, result);
      // Codes the batch could not look up stay free for the single search that follows.
      if (![BATCH_FAILED, BATCH_ITEM_MISSING].includes(result.failureCode)) lastAttemptByTrackingNumber.set(result.trackingNumber, Date.now());
    }
    if (outcome.results.some(item => item.success)) lastSuccessfulRunAt = new Date().toISOString();
    if (outcome.results.some(item => !item.success)) lastFailureAt = new Date().toISOString();
  }
  const results = [];
  for (const item of items) {
    const trackingNumber = normalizeTrackingNumber(item?.trackingNumber);
    if (!answers.has(trackingNumber) || results.some(result => result.trackingNumber === trackingNumber)) continue;
    results.push({ ...answers.get(trackingNumber), shipmentId: item?.shipmentId || "" });
  }
  return { success: results.some(item => item.success), batch: true, results, stopCycle: Boolean(outcome.stopCycle), failureCode: outcome.failureCode || "" };
}

const server = http.createServer(async (req, res) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 128);
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (!authorized(req)) return json(res, 401, { status: "unauthorized", requestId }, requestId);
    const isJobPoll = req.method === "GET" && /^\/track\/[A-Za-z0-9-]{8,128}$/.test(url.pathname);
    if (!isJobPoll && !withinRateLimit(req)) return json(res, 429, { status: "rate_limited", requestId }, requestId);
    if (url.pathname === "/health" && req.method === "GET") {
      return json(res, 200, {
        status: "ok",
        agentVersion: AGENT_VERSION,
        browserAvailable: browserAvailable(),
        activeJob: activeJobs > 0,
        maxBatchSize: MAX_BATCH_SIZE,
        lastSuccessfulRunAt,
        lastFailureAt
      }, requestId);
    }
    if (url.pathname === "/track" && req.method === "POST") {
      const payload = await readBody(req);
      const { promise, repeated } = trackOnce(requestId, payload);
      // Async mode: answer at once and let the caller poll GET /track/<requestId>, so no request stays open
      // long enough for the tunnel to drop it.
      if (url.searchParams.get("async") === "1") return json(res, 202, { status: "accepted", requestId }, requestId);
      const result = await promise;
      if (repeated) console.log(JSON.stringify({ event: "tracking_result_resent", requestId, success: Boolean(result.success), failureCode: result.failureCode || "" }));
      return json(res, 200, { ...result, requestId }, requestId);
    }
    if (url.pathname === "/track-batch" && req.method === "POST") {
      const payload = await readBody(req);
      const { promise } = trackOnce(requestId, payload, trackBatch);
      // Same async mode as /track: the result is fetched with GET /track/<requestId>.
      if (url.searchParams.get("async") === "1") return json(res, 202, { status: "accepted", requestId }, requestId);
      return json(res, 200, { ...(await promise), requestId }, requestId);
    }
    const jobMatch = url.pathname.match(/^\/track\/([A-Za-z0-9-]{8,128})$/);
    if (jobMatch && req.method === "GET") {
      const entry = recentRequests.get(jobMatch[1]);
      if (!entry) return json(res, 404, { status: "unknown_request", requestId: jobMatch[1] }, requestId);
      if (!entry.result) return json(res, 202, { status: "pending", requestId: jobMatch[1] }, requestId);
      return json(res, 200, { ...entry.result, requestId: jobMatch[1] }, requestId);
    }
    return json(res, 404, { status: "not_found", requestId }, requestId);
  } catch (error) {
    lastFailureAt = new Date().toISOString();
    return json(res, error.statusCode || 500, { ...baseResponse({ failureCode: "UNKNOWN_ERROR", failureMessage: error.message || String(error), manualReviewRequired: true }), requestId }, requestId);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (sharedContext) await sharedContext.close().catch(() => {});
  process.exit(0);
});

server.listen(PORT, HOST, () => {
  ensureDirs();
  if (!SHARED_SECRET) {
    console.error("TRACKING_RPA_SHARED_SECRET is required. The agent will reject every request until it is configured.");
  }
  console.log(`Tracking Agent ${AGENT_VERSION} listening on http://${HOST}:${PORT}`);
});
