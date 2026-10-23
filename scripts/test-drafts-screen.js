#!/usr/bin/env node
"use strict";
// «مسودات»: saved WhatsApp orders that were never confirmed. Each shows its books and what confirming it now would do
// (reserve the copies or become a pre-order), a deposit already taken, and a later confirmed order for the same customer
// and books (a likely duplicate). Runs the real functions from app/app.js in a sandbox.
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

const books = { B1:{ name:"مندليف", stock:0 }, B2:{ name:"نيوتن", stock:3 }, B3:{ name:"سنيور", stock:1 } };
const drafts = [
  { id:"ORD-303", status:"مسودة", source:"whatsapp", customerName:"دعاء", phone:"01011112222", createdAt:"2026-10-23T15:53:00Z", createdBy:"مالك النظام", total:705, paidAmount:0, lines:[{ bookId:"B2", qty:1 }, { bookId:"B1", qty:1 }] },
  { id:"ORD-307", status:"مسودة", source:"whatsapp", customerName:"نور", phone:"01033334444", createdAt:"2026-10-23T16:30:00Z", total:345, paidAmount:50, lines:[{ bookId:"B3", qty:2 }] },
  { id:"ORD-309", status:"مسودة", source:"whatsapp", customerName:"الحسين", phone:"+20 1055556666", createdAt:"2026-10-23T16:50:00Z", total:393, paidAmount:0, lines:[{ bookId:"B2", qty:1 }, { bookId:"B3", qty:1 }] }
];
const confirmed = [
  { id:"ORD-314", status:"قيد التجهيز", confirmedAt:"2026-10-23T17:21:00Z", createdAt:"2026-10-23T17:21:00Z", phone:"01055556666", lines:[{ bookId:"B3", qty:1 }, { bookId:"B2", qty:1 }] },
  { id:"ORD-100", status:"ملغي", confirmedAt:"2026-10-23T17:00:00Z", createdAt:"2026-10-23T17:00:00Z", phone:"01011112222", lines:[{ bookId:"B2", qty:1 }, { bookId:"B1", qty:1 }] }
];
const sandbox = {
  data:{ onlineOrders:[...drafts, ...confirmed] },
  unconfirmedOrders:() => drafts, canAction:() => true, getBook:id => books[id],
  bookAvailableStock:book => Math.max(0, book.stock || 0),
  normalizePhone:value => String(value || "").replace(/\D/g, ""),
  onlineOrderWorkflowStage:order => order.status === "ملغي" ? "cancelled" : "new",
  esc:value => String(value), money:n => String(n), sinceLabel:() => "من يوم", arabicDateTimeLabel:() => "23 أكتوبر",
  onlineOrderMoreActions:order => `<button data-more="${order.id}">المزيد</button>`,
  workflowModeTabs:active => `<nav data-active="${active}"></nav>`, orderSearchAttr:order => `data-search-row data-search="${order.id}"`
};
vm.createContext(sandbox);
vm.runInContext(["draftBookState", "draftDuplicateOf", "renderDraftsScreen"].map(extract).join("\n"), sandbox);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("each book says whether confirming now reserves it or makes a pre-order", () => {
  assert.equal(sandbox.draftBookState({ bookId:"B2", qty:1 }).cls, "ok");
  assert.match(sandbox.draftBookState({ bookId:"B2", qty:1 }).text, /هيتحجز لما تأكّد/);
  assert.match(sandbox.draftBookState({ bookId:"B1", qty:1 }).text, /مش متاح · هيبقى حجز مسبق/);
  assert.match(sandbox.draftBookState({ bookId:"B3", qty:2 }).text, /متاح 1 بس/);
});
pass("a later confirmed order with the same phone and books is flagged; a cancelled one is not", () => {
  assert.equal(sandbox.draftDuplicateOf(drafts[2])?.id, "ORD-314");
  assert.equal(sandbox.draftDuplicateOf(drafts[0]), null);
  assert.equal(sandbox.draftDuplicateOf(drafts[1]), null);
});
pass("the screen lists every draft with its books, deposit, duplicate warning and actions", () => {
  const html = vm.runInContext("renderDraftsScreen()", sandbox);
  assert.match(html, /<h2>مسودات<\/h2>/);
  assert.match(html, /data-active="drafts"/);
  for (const order of drafts) {
    assert.ok(html.includes(`data-action="edit-quick-order" data-id="${order.id}"`), `${order.id} open`);
    assert.ok(html.includes(`data-more="${order.id}"`), `${order.id} more`);
  }
  assert.ok(html.includes("مندليف × 1") && html.includes("نيوتن × 1") && html.includes("سنيور × 2"), "book names and quantities");
  assert.ok(html.includes("العميل دافع 50"), "deposit on an unconfirmed order");
  assert.ok(html.includes("غالبًا مكرر") && html.includes('data-id="ORD-314"'), "duplicate link");
});
pass("an empty list says so", () => {
  sandbox.unconfirmedOrders = () => [];
  assert.match(vm.runInContext("renderDraftsScreen()", sandbox), /مفيش مسودات/);
});
pass("the navigation opens the drafts screen from the alert and its own button", () => {
  const nav = extract("workflowModeTabs");
  assert.ok(nav.includes("open-unconfirmed-orders"), "alert button");
  assert.ok(/action === "open-unconfirmed-orders"\) \{[^}]*onlineOrdersMode="drafts"/.test(source), "alert opens the drafts screen");
  assert.ok(nav.includes('link({mode:"drafts"}') && nav.includes("orders-drafts-button") && nav.includes("مسودات"), "drafts button");
  assert.ok(/onlineOrdersMode==="drafts"\)\{root\.innerHTML=renderDraftsScreen\(\)/.test(source), "drafts mode renders the screen");
});
console.log("Drafts screen tests completed.");
