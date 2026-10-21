#!/usr/bin/env node
"use strict";
// «الكتب المطلوبة» (the books screen): each summary box is a button that shows only its books in the table; pressing the
// active box again (or «عرض كل الكتب») shows them all. Runs the real renderShortagesScreen from app/app.js.
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

const row = (bookId, extra = {}) => ({ bookId, book:{ name:`كتاب ${bookId}` }, stock:0, reserved:0, preorder:0, needed:0, shortfall:0, countHold:0, soldOut:false, suggested:0, toBuy:0, preorderOrders:[], reservedOrders:[], ...extra });
const rows = [row("B1", { shortfall:3, preorder:3, needed:3, toBuy:3 }), row("B2", { reserved:2, stock:2, soldOut:true }), row("B3", { countHold:1, stock:4, reserved:1 })];
const sandbox = {
  shortageFilter:"", backorderOrders:() => [], shortageRows:() => rows, canAction:() => true, canView:() => true, esc:value => String(value),
  ordersCountLabel:n => `${n} طلب`, getBook:() => null, bookAvailableStock:() => 0, workflowModeTabs:() => "", shortageOrdersMarkup:() => "", sinceLabel:() => "", badge:text => text, money:n => String(n), orderIssueNote:() => ""
};
vm.createContext(sandbox);
vm.runInContext(extract("renderShortagesScreen"), sandbox);
const render = () => vm.runInContext("renderShortagesScreen()", sandbox);
const books = html => [...html.matchAll(/<tr data-shortage-row[^>]*>.*?<strong>(كتاب B\d)<\/strong>/gs)].map(match => match[1]);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("the five boxes are buttons that filter the table", () => {
  const html = render();
  assert.equal((html.match(/<button type="button" class="shortage-stat/g) || []).length, 5);
  for (const key of ["buy", "preorder", "reserved", "count", "soldout"]) assert.ok(html.includes(`data-action="shortage-filter" data-filter="${key}"`), key);
  assert.deepEqual(books(html), ["كتاب B1", "كتاب B2", "كتاب B3"], "no filter shows every book");
});
pass("each box shows only its books and says what is shown", () => {
  const expect = { buy:["كتاب B1"], preorder:["كتاب B1"], reserved:["كتاب B2", "كتاب B3"], count:["كتاب B3"], soldout:["كتاب B2"] };
  for (const [key, list] of Object.entries(expect)) {
    sandbox.shortageFilter = key;
    const html = render();
    assert.deepEqual(books(html), list, key);
    assert.ok(html.includes(`data-filter="" aria-pressed="true"`), `${key}: the active box clears the filter when pressed again`);
    assert.match(html, /بيعرض: <strong>/);
    assert.ok(html.includes("عرض كل الكتب"));
  }
});
pass("an empty filter says so", () => {
  rows.splice(2, 1);
  sandbox.shortageFilter = "count";
  assert.match(render(), /مفيش كتب في الفلتر ده دلوقتي/);
});
console.log("3/3 shortage filter tests passed");
