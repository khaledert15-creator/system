const BASE_URL = process.env.DOTCOM_BASE_URL || "http://127.0.0.1:8765";
const USERNAME = process.env.DOTCOM_USER || "owner";
const PASSWORD = process.env.DOTCOM_PASSWORD || "DotCom@2026";
const TRACKING_NUMBER = String(process.env.TRACKING_NUMBER || process.argv[2] || "ENO33289190EG").replace(/\s+/g, "").toUpperCase();

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { rawText: text }; }
  return { response, body };
}

function yes(value) {
  return value ? "Yes" : "No";
}

async function main() {
  const login = await request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });
  if (!login.response.ok) throw new Error(`Login failed: HTTP ${login.response.status} ${login.body.message || ""}`);
  const token = login.body.token;
  const test = await request("/api/tracking/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Token": token },
    body: JSON.stringify({ trackingNumber: TRACKING_NUMBER })
  });
  const result = test.body.result || {};
  const diagnostics = result.diagnostics || result.debug || {};
  console.log(`Tracking number: ${TRACKING_NUMBER}`);
  console.log(`HTTP status: ${test.response.status}`);
  console.log(`Provider: ${test.body.provider || "N/A"}`);
  console.log(`Source: ${test.body.source || "N/A"}`);
  console.log(`Real request sent: ${yes(Boolean(test.body.provider))}`);
  console.log(`Page opened: ${yes(diagnostics.pageOpened)}`);
  console.log(`Tracking input found: ${yes(diagnostics.trackingInputFound)}`);
  console.log(`Tracking number entered: ${yes(diagnostics.trackingNumberEntered)}`);
  console.log(`Submit clicked: ${yes(diagnostics.submitClicked)}`);
  console.log(`Result container found: ${yes(diagnostics.resultContainerFound)}`);
  console.log(`Tracking result text captured: ${yes(diagnostics.trackingResultTextCaptured)}`);
  console.log(`Parsed confirmed status: ${yes(diagnostics.parsedConfirmedStatus)}`);
  console.log(`Parsed location: ${yes(diagnostics.parsedLocation)}`);
  console.log(`Parsed date: ${yes(diagnostics.parsedDate)}`);
  console.log(`Manual intervention needed: ${yes(result.manualIntervention)}`);
  console.log(`Failure code: ${diagnostics.failureCode || result.errorCode || "N/A"}`);
  console.log(`Failure message: ${diagnostics.failureMessage || test.body.message || result.error || "N/A"}`);
  console.log(`Status text: ${diagnostics.statusText || "N/A"}`);
  console.log(`Location: ${diagnostics.location || "N/A"}`);
  console.log(`Date: ${diagnostics.dateText || "N/A"}`);
  console.log("Result text:");
  console.log(diagnostics.resultText || diagnostics.bodyTextSample || "N/A");
  if (result.debug) {
    console.log(`Debug screenshot: debug/tracking/${result.debug.screenshotFile || ""}`);
    console.log(`Debug HTML: debug/tracking/${result.debug.htmlFile || ""}`);
    console.log(`Debug JSON: debug/tracking/${result.debug.jsonFile || ""}`);
  }
  if (!test.response.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
