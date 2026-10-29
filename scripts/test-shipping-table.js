#!/usr/bin/env node
"use strict";
// Shipping screen: the day the parcel left (tracking code entered), how long it has been on the road, late after
// SHIPMENT_LATE_DAYS, open parcels first and oldest at the top, the shipping-date filter, and manual tracking in the row.
// Runs the real functions from app/app.js in a sandbox.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let parens = 0, j = source.indexOf("(", start);
  for (; j < source.length; j++) { if (source[j] === "(") parens++; else if (source[j] === ")" && --parens === 0) break; }
  let depth = 0, i = source.indexOf("{", j);
  for (; i < source.length; i++) { if (source[i] === "{") depth++; else if (source[i] === "}" && --depth === 0) break; }
  return source.slice(start, i + 1);
}

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(10, 0, 0, 0); return d.toISOString(); };
const shipments = [
  { id:"SH-1", onlineOrderId:"ORD-1", trackingNumber:"EN1EG", status:"في مرحلة نقل", shippedAt:daysAgo(1), shippedBy:"أحمد" },
  { id:"SH-2", onlineOrderId:"ORD-2", trackingNumber:"EN2EG", status:"في مرحلة نقل", shippedAt:daysAgo(10) },
  { id:"SH-3", onlineOrderId:"ORD-3", trackingNumber:"EN3EG", status:"تم التسليم", normalizedStatus:"delivered", shippedAt:daysAgo(8) },
  { id:"SH-4", onlineOrderId:"ORD-4", trackingNumber:"EN4EG", status:"تم الشحن", shippedAt:daysAgo(0) },
  { id:"SH-5", onlineOrderId:"ORD-5", trackingNumber:"EN5EG", status:"تم التسليم", normalizedStatus:"delivered", shippedAt:daysAgo(2) }
];
const sandbox = {
  esc:value => String(value), canAction:() => true, arabicDateTimeLabel:() => "اليوم", dateTimeLabel:() => "اليوم", complaintStatusLabel:() => "",
  shipmentTrackingSummary:() => ({}), shipmentComplaints:() => [], shipmentStatusOptions:() => "<option>x</option>", shipmentStatusBadge:() => "",
  shipmentStatusCode:item => item.normalizedStatus || "in_transit",
  shipmentStatusMeta:item => ({ code:item.normalizedStatus || "in_transit" }),
  data:{ onlineOrders:[], shipments, complaints:[], trackingHistory:[], settings:{ tracking:{} } }, orderCanBeRefused:() => false,
  ShipmentFollowUp:require("../app/shipment-followup.js")
};
vm.createContext(sandbox);
vm.runInContext(`const SHIPMENT_LATE_DAYS = 3; const POST_DAYS_OFF = [5, 6];\n${["isTerminalShipment", "shipmentShippedAt", "shipmentDaysSinceShipped", "shipmentWorkingDaysSinceShipped", "shipmentIsOpen", "shipmentIsLate", "shipmentDaysLabel", "shipmentWorkingDaysLabel", "sortShipmentsForFollowUp", "shipmentShippedOnFilter", "followUpSettings", "shipmentFollowUpTasks", "followUpFlag", "followUpActions", "shipmentsTable"].map(extract).join("\n")}`, sandbox);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("Egypt Post working days start the day after shipping and skip Friday and Saturday", () => {
  const work = (shipped, now) => sandbox.shipmentWorkingDaysSinceShipped({ shippedAt:new Date(shipped).toISOString() }, new Date(now));
  // 2026-10-22 is a Thursday.
  assert.equal(work("2026-10-22T12:00:00", "2026-10-22T18:00:00"), 0, "shipping day itself does not count");
  assert.equal(work("2026-10-22T12:00:00", "2026-10-24T12:00:00"), 0, "Friday and Saturday do not count");
  assert.equal(work("2026-10-22T12:00:00", "2026-10-25T12:00:00"), 1, "Sunday is the first working day");
  assert.equal(work("2026-10-22T12:00:00", "2026-10-27T12:00:00"), 3, "Tuesday is the third");
  assert.equal(work("2026-10-25T09:00:00", "2026-10-28T09:00:00"), 3, "Sunday → Wednesday = 3");
  assert.equal(sandbox.shipmentWorkingDaysLabel(1), "يوم شغل واحد للبريد");
});
pass("days since the tracking code was entered, and late after 3 working days for open parcels only", () => {
  assert.equal(sandbox.shipmentDaysSinceShipped(shipments[0]), 1);
  assert.equal(sandbox.shipmentIsLate(shipments[1]), true, "10 days on the road");
  assert.equal(sandbox.shipmentIsLate(shipments[0]), false);
  assert.equal(sandbox.shipmentIsLate(shipments[2]), false, "delivered is never late");
  assert.equal(sandbox.shipmentDaysLabel(0), "النهارده");
  assert.equal(sandbox.shipmentDaysLabel(5), "من 5 أيام");
});
pass("open parcels first, oldest at the top; finished ones after, newest first", () => {
  assert.deepEqual(sandbox.sortShipmentsForFollowUp(shipments).map(item => item.id), ["SH-2", "SH-1", "SH-4", "SH-5", "SH-3"]);
});
pass("shipping-date filter", () => {
  const ids = filter => shipments.filter(item => sandbox.shipmentShippedOnFilter(item, filter)).map(item => item.id);
  assert.deepEqual(ids("today"), ["SH-4"]);
  assert.deepEqual(ids("yesterday"), ["SH-1"]);
  assert.deepEqual(ids("older"), ["SH-2", "SH-3"]);
  assert.equal(ids("").length, 5);
});
pass("the table shows the shipping day, marks the late row, and has manual tracking only for open parcels", () => {
  const html = sandbox.shipmentsTable(shipments);
  assert.match(html, /<th>اتشحن من عندنا<\/th>/);
  assert.ok(html.indexOf('data-record-id="SH-2"') < html.indexOf('data-record-id="SH-1"'), "oldest open first");
  assert.match(html, /data-record-id="SH-2" class="shipment-late"/);
  assert.ok(html.includes("من 10 أيام · متأخرة"));
  assert.ok(html.includes("أيام شغل للبريد"), "working days shown for open parcels");
  const row = id => html.slice(html.indexOf(`data-record-id="${id}"`), html.indexOf("</tr>", html.indexOf(`data-record-id="${id}"`)));
  assert.ok(row("SH-1").includes('data-action="open-egypt-post-with-code"') && row("SH-1").includes('data-status="delivered"'), "manual tracking on an open parcel");
  assert.ok(!row("SH-3").includes("open-egypt-post-with-code"), "no manual tracking on a delivered parcel");
  assert.ok(row("SH-1").includes('data-action="shipment-history"') && row("SH-1").includes('data-action="add-shipment-complaint"'), "the other actions stay under «المزيد»");
  assert.ok(row("SH-1").includes("أحمد"), "who shipped it");
});
pass("a parcel 10 days on the road is flagged for a complaint, a fresh one is not", () => {
  const html = sandbox.shipmentsTable(shipments);
  const row = id => html.slice(html.indexOf(`data-record-id="${id}"`), html.indexOf("</tr>", html.indexOf(`data-record-id="${id}"`)));
  assert.ok(row("SH-2").includes("followup-flag complaint-due") && row("SH-2").includes("قدّم شكوى"));
  assert.ok(row("SH-2").includes('data-action="complaint-waive"'));
  assert.ok(!row("SH-4").includes("followup-flag"), "shipped today");
  assert.ok(!row("SH-3").includes("followup-flag"), "delivered");
});
console.log("Shipping table tests completed.");
