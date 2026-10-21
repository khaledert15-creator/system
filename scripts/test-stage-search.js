#!/usr/bin/env node
"use strict";
// Stage screens (جاهز للتغليف، مغلف ومنتظر كود تتبع، حجز مسبق): one smart search under the stages row filters the
// rows by order number, customer, phone, governorate, tracking or book, and keeps its text across live refreshes.
// Runs the real search functions from app/app.js in a sandbox.
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

const books = { B1:{ name:"مندليف كيميا 3ث" }, B2:{ name:"نيوتن اسأله 3ث" } };
const orders = [
  { id:"ORD-0145", customerName:"أحمد محمود", phone:"01012345678", governorate:"القاهرة", lines:[{ bookId:"B2", qty:1 }] },
  { id:"ORD-0134", customerName:"منى علي", phone:"01099998888", governorate:"الإسكندرية", tracking:"EG123456789", lines:[{ bookId:"B1", qty:1 }] }
];
const sandbox = { data:{ shipments:[] }, getBook:id => books[id], esc:value => String(value).replace(/"/g, "&quot;"), stageSearchTerm:"", console };
vm.createContext(sandbox);
const names = ["normalizeArabicDigits", "normalizeSmartSearch", "smartStem", "smartPieces", "editDistanceWithin", "smartSearchIndex", "smartQueryTokens", "smartTokenMatches", "smartFilter", "smartFilterRows", "orderSearchValues", "applyStageSearch"];
// The search's module-level tables: from the first SMART_ constant through its cache.
const constants = source.slice(source.indexOf("const SMART_SEARCH_PREFIX"), source.indexOf("\n", source.indexOf("const smartSearchIndexCache")) + 1);
vm.runInContext(`${constants}\nlet stageSearchTypedAt=0;\n${names.filter(name => source.includes(`function ${name}(`)).map(extract).join("\n")}`, sandbox);

const rows = orders.map(order => ({ dataset:{ search:sandbox.orderSearchValues(order).join(" ") }, hidden:false, id:order.id }));
const count = { textContent:"" }, input = { value:"", focus() {}, setSelectionRange() {} };
sandbox.root = { querySelectorAll:() => rows };
sandbox.document = { getElementById:id => id === "stage-search" ? input : id === "stage-search-count" ? count : null, activeElement:input };
const search = term => { sandbox.stageSearchTerm = term; vm.runInContext("applyStageSearch()", sandbox); return rows.filter(row => !row.hidden).map(row => row.id); };
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("finds by order number, customer, phone, governorate, tracking and book name", () => {
  assert.deepEqual(search("0145"), ["ORD-0145"]);
  assert.deepEqual(search("منى"), ["ORD-0134"]);
  assert.deepEqual(search("01099998888"), ["ORD-0134"]);
  assert.deepEqual(search("الاسكندرية"), ["ORD-0134"], "hamza-insensitive");
  assert.deepEqual(search("EG123456789"), ["ORD-0134"]);
  assert.deepEqual(search("نيوتن"), ["ORD-0145"]);
  assert.equal(count.textContent, "1 نتيجة");
});
pass("tolerates a small typo and says when nothing matches", () => {
  assert.deepEqual(search("مندلييف"), ["ORD-0134"]);
  assert.deepEqual(search("زززز"), []);
  assert.equal(count.textContent, "مفيش نتايج");
});
pass("an empty search shows every row", () => {
  assert.deepEqual(search(""), ["ORD-0145", "ORD-0134"]);
  assert.equal(count.textContent, "");
});
pass("each stage screen shows the search and rows carry what it looks through", () => {
  const nav = extract("workflowModeTabs");
  for (const mode of ["preparation", "ready-shipping", "shortages"]) assert.ok(nav.includes(`active==="${mode}"?stageSearchBox(`), mode);
  assert.ok(extract("renderPreparationQueue").includes("orderSearchAttr(order)"));
  assert.ok(extract("readyShippingRow").includes("orderSearchAttr(order)"));
  assert.ok(extract("renderShortagesScreen").includes("orderSearchAttr(order)"));
  assert.ok(!source.includes('id="shortage-search"'), "one search per screen");
});
console.log("4/4 stage search tests passed");
