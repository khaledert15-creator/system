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

pass("a confirmed order waiting to be packed and one being packed both say «للتجهيز», like their stage", () => {
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[1]), "للتجهيز");
  assert.equal(sandbox.onlineOrderWorkflowLabel({ ...orders[2], preparingBy:"أحمد" }), "للتجهيز · بدأه أحمد");
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[2]), "للتجهيز");
  assert.equal(sandbox.onlineOrderWorkflowLabel(orders[0]), "مسودة · ما اتأكدتش", "an unconfirmed order says it is a draft");
  assert.ok(sandbox.onlineOrderMatchesQuickFilter(orders[1], "prep") && sandbox.onlineOrderMatchesQuickFilter(orders[2], "prep"));
  assert.ok(!sandbox.onlineOrderMatchesQuickFilter(orders[3], "prep"), "a pre-order is not in «للتجهيز»");
});
pass("one navigation: five stages in order, the two create buttons, no second row of status cards", () => {
  const nav = extract("workflowModeTabs");
  const order = ["حجز مسبق", "للتجهيز", "مغلّف", "اتشحن", "اتسلّم"].map(label => nav.indexOf(`"${label}"`));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), "stages appear in order");
  assert.ok(nav.includes("＋ طلب واتساب جديد") && nav.includes("طلبات الموقع"));
  assert.ok(!source.includes('class="order-stage-filters"'), "the duplicate status cards are gone");
});
pass("search finds an order outside the selected card and says so", () => {
  sandbox.onlineOrderQuickFilter = "preparing";
  search.value = "ORD-0145";
  vm.runInContext("filterOnlineOrders()", sandbox);
  assert.match(table.innerHTML, /ORD-0145$/);
  assert.match(table.innerHTML, /نتايج البحث من كل الطلبات، مش من «للتجهيز» بس/);
});
pass("with no search the selected card still filters", () => {
  search.value = "";
  vm.runInContext("filterOnlineOrders()", sandbox);
  assert.equal(table.innerHTML, "ORD-0134");
});
console.log("4/4 order navigation, search and label tests passed");
