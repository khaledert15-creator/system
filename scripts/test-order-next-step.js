#!/usr/bin/env node
"use strict";
// Order details: no manual «إنشاء فاتورة من الطلب» / «إنشاء شحنة» (the invoice is issued at packing, the shipment with
// the tracking code); one «الخطوة الجاية» button opens the screen of the order's next step; «طباعة ورقة التجهيز»
// replaces «أمر تجهيز». Runs the real orderNextStep from app/app.js.
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  let parens = 0, j = source.indexOf("(", start);
  for (; j < source.length; j++) { if (source[j] === "(") parens++; else if (source[j] === ")" && --parens === 0) break; }
  let depth = 0, i = source.indexOf("{", j);
  for (; i < source.length; i++) { if (source[i] === "{") depth++; else if (source[i] === "}" && --depth === 0) break; }
  return source.slice(start, i + 1);
}
let allowed = ["order.quick.edit", "order.prepare"];
const box = { canAction:action => allowed.includes(action) };
vm.createContext(box);
vm.runInContext([extract("onlineOrderWorkflowStage"), extract("orderNextStep")].join("\n"), box);
const next = order => box.orderNextStep(order);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("each stage leads to its screen", () => {
  assert.deepEqual(next({ workflowStage:"draft", source:"whatsapp" }), { label:"كمّل الطلب وأكّده", edit:true });
  assert.equal(next({ workflowStage:"awaiting_preparation", confirmedAt:"x" }).mode, "preparation");
  assert.equal(next({ workflowStage:"preparing", confirmedAt:"x" }).label, "جاهز للتغليف");
  assert.equal(next({ workflowStage:"awaiting_stock", confirmedAt:"x" }).mode, "preorders");
  assert.equal(next({ workflowStage:"awaiting_shipping", preparedAt:"x" }).mode, "ready-shipping");
  for (const stage of [{ workflowStage:"shipped", shipmentId:"S" }, { workflowStage:"delivered" }, { workflowStage:"cancelled" }]) assert.equal(next(stage), null);
});
pass("without the packing screen permission it opens the matching list instead", () => {
  allowed = ["order.quick.edit"];
  assert.deepEqual(next({ workflowStage:"preparing", confirmedAt:"x" }), { label:"جاهز للتغليف", mode:"orders", filter:"prep" });
  allowed = ["order.quick.edit", "order.prepare"];
});
pass("the details dialog no longer creates invoices or shipments by hand", () => {
  const dialog = extract("viewOnlineOrder");
  assert.ok(!dialog.includes("إنشاء فاتورة من الطلب") && !dialog.includes("إنشاء شحنة بعد الفاتورة") && !dialog.includes('data-action="create-order-shipment"'));
  assert.ok(dialog.includes("الخطوة الجاية") && dialog.includes("طباعة ورقة التجهيز") && !dialog.includes(">أمر تجهيز<"));
  assert.ok(dialog.includes("عرض الفاتورة") && dialog.includes("عرض الشحنة"), "existing invoice and shipment can still be opened");
  assert.ok(source.includes('if (chatwoodAction === "order-next-step")') && source.includes('if (action === "order-next-step")'), "works from the dialog and the main view");
});
console.log("3/3 order next-step tests passed");
