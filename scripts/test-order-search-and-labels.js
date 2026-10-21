#!/usr/bin/env node
"use strict";
// Online orders screen: the status badge names the card the order is counted under, and a search looks through
// every order whatever card is selected. Runs the real functions from app/app.js in a sandbox.
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

const orders = [
  { id:"ORD-0001", workflowStage:"draft", status:"مسودة" },
  { id:"ORD-0145", workflowStage:"awaiting_preparation", status:"قيد التجهيز", confirmedAt:"2026-10-21T00:22:03Z" },
  { id:"ORD-0134", workflowStage:"preparing", status:"قيد التجهيز", confirmedAt:"2026-10-20T22:00:00Z" },
  { id:"ORD-0212", workflowStage:"awaiting_stock", status:"حجز مسبق", confirmedAt:"2026-10-20T17:22:00Z" }
];
const table = { innerHTML:"" }, search = { value:"" };
const sandbox = {
  data:{ onlineOrders:orders, sales:[], shipments:[] }, onlineOrderQuickFilter:"", table, search,
  document:{ getElementById:id => id === "online-orders-table" ? table : id === "online-order-search" ? search : null },
  smartFilter:(list, term, fields) => term ? list.filter(item => fields(item).flat().filter(Boolean).some(value => String(value).includes(term))) : list,
  onlineOrdersTable:list => list.map(order => order.id).join(","), esc:value => String(value), scheduleStickyTableScrollbar:() => {}, getBook:() => null, badge:text => text
};
vm.createContext(sandbox);
vm.runInContext(["onlineOrderWorkflowStage", "onlineOrderWorkflowLabel", "onlineOrderMatchesQuickFilter", "onlineOrderQuickFilterLabel", "filterOnlineOrders"].map(extract).join("\n"), sandbox);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("a confirmed order waiting to be packed and one being packed both say «جاهز للتغليف», like their stage", () => {
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[1]), "جاهز للتغليف");
  assert.equal(sandbox.onlineOrderWorkflowLabel({ ...orders[2], preparingBy:"أحمد" }), "جاهز للتغليف · بدأه أحمد");
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[2]), "جاهز للتغليف");
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[0]), "لسه ما اتأكدش", "an unconfirmed order says so");
  assert.ok(sandbox.onlineOrderMatchesQuickFilter(orders[1], "prep") && sandbox.onlineOrderMatchesQuickFilter(orders[2], "prep"));
  assert.ok(!sandbox.onlineOrderMatchesQuickFilter(orders[3], "prep"), "a pre-order is not ready to pack");
});
pass("one navigation: five stages in order, the two create buttons, no second row of status cards", () => {
  const nav = extract("workflowModeTabs");
  const order = ["حجز مسبق", "جاهز للتغليف", "مغلف ومنتظر كود تتبع", "تم الشحن", "تم التسليم"].map(label => nav.indexOf(`"${label}"`));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), "stages appear in order");
  assert.ok(nav.indexOf("طلب جديد من واتساب") > 0 && nav.indexOf("طلب جديد من واتساب") < nav.indexOf("طلبات الموقع"), "the WhatsApp button comes first");
  assert.ok(nav.includes("whatsapp-order-button") && nav.includes("open-unconfirmed-orders"));
  assert.ok(!source.includes('class="order-stage-filters"'), "the duplicate status cards are gone");
});
pass("search finds an order outside the selected card and says so", () => {
  sandbox.onlineOrderQuickFilter = "preparing";
  search.value = "ORD-0145";
  vm.runInContext("filterOnlineOrders()", sandbox);
  assert.match(table.innerHTML, /ORD-0145$/);
  assert.match(table.innerHTML, /نتايج البحث من كل الطلبات، مش من «جاهز للتغليف» بس/);
});
pass("orders saved but never confirmed are listed for the alert, newest first", () => {
  vm.runInContext(extract("unconfirmedOrders"), sandbox);
  sandbox.data.onlineOrders.push({ id:"ORD-0002", workflowStage:"draft", status:"مسودة", updatedAt:"2026-10-21T01:00:00Z" });
  assert.deepEqual(sandbox.unconfirmedOrders().map(order => order.id), ["ORD-0002", "ORD-0001"]);
  sandbox.data.onlineOrders.pop();
});
pass("with no search the selected card still filters", () => {
  search.value = "";
  vm.runInContext("filterOnlineOrders()", sandbox);
  assert.equal(table.innerHTML, "ORD-0134");
});
console.log("5/5 order navigation, search and label tests passed");
