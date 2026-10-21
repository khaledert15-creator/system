#!/usr/bin/env node
"use strict";
// «حجز مسبق»: every waiting order with why it waits (the packer's report, a stock count at zero, the system at
// confirmation, a split order, the customer's website choice), what each missing book needs, and the existing actions.
// The former books screen is «الكتب المطلوبة». Runs the real functions from app/app.js in a sandbox.
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

const books = { B1:{ name:"مندليف", stock:0 }, B2:{ name:"نيوتن", stock:3 }, B3:{ name:"سنيور", stock:5, countHoldQty:2 } };
const C = "2026-10-20T09:00:00.000Z";
const orders = [
  { id:"ORD-1", workflowStage:"awaiting_stock", confirmedAt:C, backorderLines:[{ bookId:"B3", qty:1 }], preparationIssue:{ reason:"صنف غير متوفر", notes:"مش على الرف", missingLines:[{ bookId:"B3", qty:1 }], createdBy:"أحمد", createdAt:C } },
  { id:"ORD-2", workflowStage:"awaiting_stock", confirmedAt:C, backorderLines:[{ bookId:"B1", qty:1 }], inventoryReservation:{ releaseReason:"كتاب غير متوفر (جرد = 0) — حجز مسبق", releasedAt:C } },
  { id:"ORD-3", workflowStage:"awaiting_stock", confirmedAt:C, backorderLines:[{ bookId:"B2", qty:1 }], inventoryReservation:{ releaseReason:"حجز مسبق — تُحجز النسخ عند توفر كل الكتب" } },
  { id:"ORD-4", workflowStage:"awaiting_stock", confirmedAt:C, splitFromOrderId:"ORD-0", backorderLines:[{ bookId:"B1", qty:2 }] },
  { id:"ORD-5", workflowStage:"awaiting_stock", confirmedAt:C, websiteOrderNumber:"MK1", websitePreorderConsent:true, backorderLines:[{ bookId:"B1", qty:1 }] }
];
const sandbox = {
  preorderFilter:"", PREPARATION_SHORTAGE_REASONS:["صنف غير متوفر", "الكمية غير كافية"],
  backorderOrders:() => orders, backorderAllocatable:order => order.id === "ORD-3", splitShipmentEligible:order => order.id === "ORD-1",
  getBook:id => books[id], bookAvailableStock:book => Math.max(0, (book.stock || 0) - (book.countHoldQty || 0)), bookCountHold:book => book.countHoldQty || 0,
  esc:value => String(value), arabicDateTimeLabel:() => "20 أكتوبر", sinceLabel:() => "من يوم", money:n => String(n), splitPartBadge:() => "",
  onlineOrderPrimaryAction:order => `<button data-primary="${order.id}">إجراء</button>`, onlineOrderMoreActions:order => `<button data-more="${order.id}">المزيد</button>`,
  shortageRows:() => [{ shortfall:3 }, { shortfall:0 }], workflowModeTabs:active => `<nav data-active="${active}"></nav>`, orderSearchAttr:order => `data-search-row data-search="${order.id}"`
};
vm.createContext(sandbox);
vm.runInContext(["preorderReason", "preorderBookState", "renderPreordersScreen"].map(extract).join("\n"), sandbox);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };
const reason = id => sandbox.preorderReason(orders.find(order => order.id === id));

pass("each order says why it waits", () => {
  assert.deepEqual([reason("ORD-1").source, reason("ORD-1").title, reason("ORD-1").detail], ["staff", "صنف غير متوفر", "مش على الرف · أحمد"]);
  assert.equal(reason("ORD-2").source, "count");
  assert.equal(reason("ORD-3").source, "system");
  assert.equal(reason("ORD-4").source, "split"); assert.match(reason("ORD-4").title, /ORD-0/);
  assert.equal(reason("ORD-5").source, "website");
});
pass("each missing book says what it needs: a stock count, a purchase, or it is back on the shelf", () => {
  assert.equal(sandbox.preorderBookState(orders[0], { bookId:"B3", qty:1 }).text, "مستني جرد");
  assert.equal(sandbox.preorderBookState(orders[1], { bookId:"B1", qty:1 }).text, "محتاج شراء");
  assert.equal(sandbox.preorderBookState(orders[2], { bookId:"B2", qty:1 }).text, "متاح دلوقتي 3");
});
pass("the screen lists every waiting order with its reason and the existing actions, and filters", () => {
  let html = vm.runInContext("renderPreordersScreen()", sandbox);
  assert.match(html, /<h2>حجز مسبق<\/h2>/);
  assert.match(html, /data-active="preorders"/);
  for (const order of orders) { assert.ok(html.includes(`data-primary="${order.id}"`) && html.includes(`data-more="${order.id}"`), order.id); }
  assert.ok(html.includes("👤 الموظف") && html.includes("📦 جرد") && html.includes("⚙ تلقائي من السيستم"));
  assert.ok(html.includes('data-mode="shortages"') && html.includes("📚 الكتب المطلوبة") && html.includes("1 ناقص"), "link to the books screen with the books to buy");
  sandbox.preorderFilter = "ready";
  html = vm.runInContext("renderPreordersScreen()", sandbox);
  assert.ok(html.includes('data-primary="ORD-3"') && !html.includes('data-primary="ORD-1"'), "«يقدر يتغلّف دلوقتي» shows only those");
  sandbox.preorderFilter = "partial";
  html = vm.runInContext("renderPreordersScreen()", sandbox);
  assert.ok(html.includes('data-primary="ORD-1"') && !html.includes('data-primary="ORD-3"'), "«جزء من كتبه متاح» shows only those");
  sandbox.preorderFilter = "";
});
pass("navigation: stage 1 opens «حجز مسبق», the books screen is «الكتب المطلوبة» with its own button", () => {
  const nav = extract("workflowModeTabs");
  assert.ok(nav.includes('["backorder","حجز مسبق","",backorderOrders().length,{mode:"preorders"}]'));
  assert.ok(nav.includes("الكتب المطلوبة") && nav.includes('{mode:"shortages"}'));
  assert.match(extract("renderShortagesScreen"), /<h2>الكتب المطلوبة<\/h2>/);
  assert.ok(!source.includes("الكتب الناقصة والحجوزات"), "the old name is gone");
});
console.log("4/4 pre-order screen tests passed");
// A book reported missing for this order and on count hold is not "available" for the move to preparation.
{
  const source2 = require("fs").readFileSync(require("path").join(__dirname, "../app/app.js"), "utf8");
  const start = source2.indexOf("function backorderAllocatable(");
  const body = source2.slice(start, source2.indexOf("\n}\n", start) + 2);
  const box = { getBook:id => ({ B3:{ stock:5, countHoldQty:2 }, B2:{ stock:3 } })[id], bookAvailableStock:book => Math.max(0, (book.stock || 0) - (book.countHoldQty || 0)), bookCountHold:book => book.countHoldQty || 0 };
  require("vm").createContext(box); require("vm").runInContext(body, box);
  const reported = { lines:[{ bookId:"B3", qty:1 }], preparationIssue:{ missingLines:[{ bookId:"B3", qty:1 }] } };
  require("assert").equal(box.backorderAllocatable(reported), false, "count-held reported book blocks the move");
  require("assert").equal(box.backorderAllocatable({ lines:[{ bookId:"B3", qty:1 }] }), true, "the same book is fine for an order that did not report it");
  console.log("PASS a book waiting for a stock count is not offered as «نقل للتجهيز الآن»");
}
