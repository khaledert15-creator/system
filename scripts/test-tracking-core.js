const crypto = require("crypto");

function normalizeTrackingNumber(value = "") {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function normalizeTrackingStatus(text = "") {
  const lower = String(text || "").trim().toLowerCase();
  const checks = [
    ["delivered", ["delivered", "تم تسليم الشحنة", "اكتمل الطلب"]],
    ["out_for_delivery", ["out for delivery", "خارج للتسليم", "خرج للتوصيل"]],
    ["in_transit", ["transit", "النقل والمعالجة", "في الطريق"]],
    ["shipped", ["الشحن", "shipped"]],
    ["registered", ["التسجيل", "registered", "accepted"]],
    ["returned_to_sender", ["returned", "مرتجع", "رجوع للمرسل"]]
  ];
  const hit = checks.find(([, words]) => words.some(word => lower.includes(word.toLowerCase())));
  return hit ? hit[0] : "unknown";
}

function eventFingerprint(event = {}) {
  return crypto.createHash("sha1")
    .update(`${event.trackingNumber || ""}|${event.statusText || ""}|${event.normalizedStatus || ""}|${event.location || ""}|${event.eventAt || ""}`, "utf8")
    .digest("hex");
}

function isEligible(shipment, settings = {}, { manual = false } = {}) {
  const now = Date.now();
  const number = normalizeTrackingNumber(shipment.trackingNumber || shipment.tracking);
  return /^[A-Z0-9]{8,30}$/.test(number)
    && shipment.trackingEnabled !== false
    && !["delivered", "returned_to_sender", "cancelled"].includes(shipment.normalizedStatus)
    && (manual || !shipment.manualInterventionNeeded)
    && (manual || Number(shipment.trackingErrorCount || 0) < Number(settings.maxAttempts || 5))
    && (manual || !shipment.nextTrackingAt || new Date(shipment.nextTrackingAt).getTime() <= now)
    && (manual || !shipment.lastTrackingAt || (now - new Date(shipment.lastTrackingAt).getTime()) >= Number(settings.minIntervalHours || 6) * 3600000);
}

function assert(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

function main() {
  assert("status mapping: registration", normalizeTrackingStatus("التسجيل") === "registered");
  assert("status mapping: shipped", normalizeTrackingStatus("الشحن") === "shipped");
  assert("status mapping: in transit", normalizeTrackingStatus("النقل والمعالجة") === "in_transit");
  assert("status mapping: delivered only confirmed", normalizeTrackingStatus("تم تسليم الشحنة") === "delivered");
  assert("status mapping: uncertain remains unknown", normalizeTrackingStatus("يرجى متابعة الطلب") === "unknown");

  const event = { trackingNumber:"ENO33289190EG", statusText:"النقل والمعالجة", normalizedStatus:"in_transit", location:"Cairo", eventAt:"2026-07-13T10:00:00.000Z" };
  assert("duplicate history prevention", eventFingerprint(event) === eventFingerprint({ ...event }));

  const settings = { minIntervalHours: 6, maxAttempts: 5 };
  assert("queue eligibility: active shipment", isEligible({ trackingNumber:"ENO33289190EG", trackingEnabled:true, normalizedStatus:"in_transit" }, settings));
  assert("queue eligibility: skip recent shipment", !isEligible({ trackingNumber:"ENO33289190EG", trackingEnabled:true, normalizedStatus:"in_transit", lastTrackingAt:new Date().toISOString() }, settings));
  assert("queue eligibility: manual can retry manual-review shipment", isEligible({ trackingNumber:"ENO33289190EG", trackingEnabled:true, normalizedStatus:"in_transit", manualInterventionNeeded:true }, settings, { manual:true }));
  assert("queue eligibility: automatic skips manual-review shipment", !isEligible({ trackingNumber:"ENO33289190EG", trackingEnabled:true, normalizedStatus:"in_transit", manualInterventionNeeded:true }, settings));

  console.log("Tracking core tests completed.");
}

main();
