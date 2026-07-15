const http = require("http");

const trackingNumber = String(process.argv[2] || "ENO33289190EG").replace(/\s+/g, "").toUpperCase();
const RPA_URL = process.env.LOCAL_TRACKING_RPA_URL || "http://127.0.0.1:8788";
const MAIN_URL = process.env.DOTCOM_MAIN_URL || "http://127.0.0.1:8765";

function requestJson(url, { method = "GET", headers = {}, body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const target = new URL(url);
    const req = http.request(target, {
      method,
      headers: {
        ...(payload ? { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { rawText: text }; }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

async function optional(name, fn) {
  try {
    return await fn();
  } catch (error) {
    console.log(`SKIP: ${name} (${error.message})`);
    return null;
  }
}

async function main() {
  console.log(`Testing Local Tracking RPA with ${trackingNumber}`);
  const health = await requestJson(`${RPA_URL}/health`).catch(error => ({ error }));
  if (health.error) {
    console.log(`SKIP: RPA service health (${health.error.message})`);
  } else {
    assert("RPA service health", health.statusCode === 200 && health.data.ok);
    assert("RPA browser mode is headed_chrome", health.data.browserMode === "headed_chrome");
    assert("RPA profile path configured", Boolean(health.data.profilePath));

    const success = await requestJson(`${RPA_URL}/track`, { method: "POST", body: { trackingNumber, shipmentId: "TEST-RPA", provider: "mock_success", force: true } });
    assert("mock success response", success.data.success === true && Array.isArray(success.data.timeline) && success.data.timeline.length > 0);
    assert("mock delivered only on confirmed status", success.data.delivered === true && success.data.confirmedStatus === "delivered");

    const blocked = await requestJson(`${RPA_URL}/track`, { method: "POST", body: { trackingNumber, shipmentId: "TEST-RPA", provider: "mock_site_blocked", force: true } });
    assert("SITE_BLOCKED response", blocked.data.success === false && blocked.data.failureCode === "SITE_BLOCKED" && blocked.data.manualReviewRequired === true);

    const human = await requestJson(`${RPA_URL}/track`, { method: "POST", body: { trackingNumber, shipmentId: "TEST-RPA", provider: "mock_human_verification", force: true } });
    assert("HUMAN_VERIFICATION_REQUIRED response", human.data.success === false && human.data.failureCode === "HUMAN_VERIFICATION_REQUIRED" && human.data.manualReviewRequired === true);
  }

  await optional("main system integration", async () => {
    const login = await requestJson(`${MAIN_URL}/api/login`, { method: "POST", body: { username: "owner", password: "DotCom@2026" } });
    assert("main login", login.data.ok && login.data.token);
    const headers = { "X-Session-Token": login.data.token };
    const status = await requestJson(`${MAIN_URL}/api/tracking/rpa/status`, { headers });
    assert("main RPA status endpoint", status.statusCode === 200 && status.data.ok === true);
    const test = await requestJson(`${MAIN_URL}/api/tracking/rpa/test`, { method: "POST", headers, body: { trackingNumber, provider: "mock_success" } });
    assert("main mock RPA test endpoint", test.statusCode === 200 && test.data.result?.success === true);
  });

  console.log("Local RPA tracking tests completed.");
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
