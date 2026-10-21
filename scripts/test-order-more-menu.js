#!/usr/bin/env node
"use strict";
// One «⋯ المزيد» menu everywhere (orders list, جاهز للتغليف، مغلف ومنتظر كود تتبع، حجز مسبق، order details): «تعديل الطلب»
// and «إلغاء الطلب» are always listed, disabled with the reason under them when they cannot be used. Runs the real
// functions from app/app.js in a sandbox.
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
const allowed = new Set(["order.quick.edit", "order.prepare"]);
const sandbox = { canAction:key => allowed.has(key), esc:value => String(value ?? ""), onlineOrderWorkflowStage:order => order.stage, activeOrderShipment:order => order.shipment || null, canCancelOrderDirectly:order => allowed.has("order.quick.edit") && !["delivered","cancelled"].includes(order.stage) && !order.shipment };
vm.createContext(sandbox);
vm.runInContext(`const isWebsiteOrder=order=>Boolean(order?.websiteOrderNumber||order?.source==="website");\n${["orderEditBlockReason", "orderCancelBlockReason", "onlineOrderMoreActions"].map(extract).join("\n")}`, sandbox);
const menu = (order, options) => sandbox.onlineOrderMoreActions(order, options);
const enabled = (html, action) => new RegExp(`data-action="${action}"`).test(html);
const pass = (name, fn) => { fn(); console.log(`PASS ${name}`); };

pass("a packed WhatsApp order can be edited (it goes back to packing) and cancelled", () => {
  const html = menu({ id:"ORD-1", source:"whatsapp", stage:"ready", saleId:"INV-1", preparedAt:"x" });
  assert.ok(enabled(html, "edit-quick-order")); assert.match(html, /تعديل الطلب \(هيرجع للتغليف\)/);
  assert.ok(enabled(html, "cancel-online-order")); assert.ok(enabled(html, "reopen-order-preparation")); assert.ok(enabled(html, "view-online-order"));
});
pass("a website order is listed for editing too", () => {
  assert.ok(enabled(menu({ id:"ORD-2", source:"website", websiteOrderNumber:"MK1", stage:"new" }), "edit-quick-order"));
});
pass("a shipped or delivered order shows both actions disabled with the reason", () => {
  const shipped = menu({ id:"ORD-3", source:"whatsapp", stage:"shipped", shipment:{ id:"SH-1" }, saleId:"INV-3", preparedAt:"x" });
  assert.ok(!enabled(shipped, "edit-quick-order")); assert.ok(!enabled(shipped, "cancel-online-order"));
  assert.match(shipped, /الطرد اتسلّم لشركة الشحن؛ مينفعش يتعدل/); assert.match(shipped, /الإلغاء بيتعمل كمرتجع لما يرجع/);
  assert.match(menu({ id:"ORD-4", source:"whatsapp", stage:"delivered" }), /الطلب اتسلّم للعميل؛ أي تغيير بيتعمل كمرتجع/);
});
pass("a cancelled order shows no cancel item; an employee without the permission sees why", () => {
  assert.ok(!/إلغاء الطلب/.test(menu({ id:"ORD-5", source:"whatsapp", stage:"cancelled" })));
  allowed.delete("order.quick.edit");
  assert.match(menu({ id:"ORD-6", source:"whatsapp", stage:"new" }), /مش عندك صلاحية تعديل الطلبات/);
  allowed.add("order.quick.edit");
});
pass("the details dialog menu leaves out the details link and the plain return to packing", () => {
  const html = menu({ id:"ORD-7", source:"whatsapp", stage:"ready", saleId:"INV-7", preparedAt:"x" }, { details:false });
  assert.ok(!enabled(html, "view-online-order")); assert.ok(!enabled(html, "reopen-order-preparation")); assert.ok(enabled(html, "edit-quick-order"));
});
pass("every orders screen and the details dialog use the same menu", () => {
  for (const name of ["onlineOrdersTable", "renderPreparationQueue", "readyShippingRow", "renderPreordersScreen", "viewOnlineOrder"]) assert.ok(extract(name).includes("onlineOrderMoreActions(order"), name);
  assert.ok(/chatwoodAction === "edit-quick-order"/.test(source) && /chatwoodAction === "cancel-online-order"/.test(source), "dialog handles the menu actions");
});
console.log("6/6 order more-menu tests passed");
