"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app/app.js", "utf8");
const server = fs.readFileSync("server-node.js", "utf8");
const rowSource = app.match(/function readyShippingRow\(order\) \{[\s\S]*?\n\}/)?.[0];
assert(rowSource, "readyShippingRow is missing");
// The row's repack and cancel now live in the shared «⋯ المزيد» menu, which is rendered with the real functions.
const fn = name => app.match(new RegExp(`function ${name}\\(order[^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
const menuSource = ["orderEditBlockReason", "orderCancelBlockReason", "onlineOrderMoreActions"].map(name => { const found = fn(name); assert(found, `${name} is missing`); return found; }).join("\n");

function renderRow(order, permissions = ["order.prepare", "order.pack", "order.shipping", "convert-order-sale"]) {
  const factory = new Function("OrderFinance", "data", "canAction", "shippingExportSelection", "esc", "money", "arabicDateTimeLabel", "canCancelOrderDirectly", "orderSearchAttr", `const onlineOrderWorkflowStage=()=>"ready",activeOrderShipment=()=>null,isWebsiteOrder=()=>false;${menuSource}\n${rowSource}; return readyShippingRow;`);
  const render = factory(
    { calculatePayment: () => ({ remainingAmount: 100 }) },
    { shipments: [] },
    action => permissions.includes(action),
    new Set(),
    value => String(value ?? ""),
    value => `${value} ج.م`,
    value => String(value),
    () => permissions.includes("order.quick.edit"),
    order => `data-search-row data-search="${order.id}"`
  );
  return render({ id: "ORD-TEST", source: "whatsapp", preparedAt: "2026-10-21T00:00:00.000Z", customerName: "عميل", phone: "01000000000", governorate: "القاهرة", lines: [{ qty: 1 }], total: 100, paidAmount: 0, saleId: "INV-TEST", ...order });
}

const noWeight = renderRow({ packedWeightGrams: null });
assert.doesNotMatch(noWeight, /data-action="cancel-online-order"/);
assert.match(noWeight, /مش عندك صلاحية إلغاء الطلبات/, "without the permission the menu says why");
assert.match(renderRow({ packedWeightGrams: null }, ["order.quick.edit"]), /data-action="cancel-online-order"[^>]*>إلغاء الطلب/);
assert.match(noWeight, /data-action="packed-weight-edit"[^>]*>تسجيل الوزن/);
assert.match(noWeight, /data-action="ship-ready-order"[^>]*disabled[^>]*>سجّل الوزن أولًا/);
assert.match(noWeight, /data-action="reopen-order-preparation"/);

const weighed = renderRow({ packedWeightGrams: 1200 });
assert.match(weighed, /data-action="packed-weight-edit"[^>]*>تصحيح الوزن/);
assert.match(weighed, /data-action="ship-ready-order"[^>]*>إدخال كود يدويًا/);
assert.doesNotMatch(weighed.match(/data-action="ship-ready-order"[^>]*/)?.[0] || "", /disabled/);

const shippingOnly = renderRow({ packedWeightGrams: 1200 }, ["order.shipping"]);
assert.match(shippingOnly, /data-action="packed-weight-edit"/);
assert.match(shippingOnly, /data-action="ship-ready-order"/);
assert.doesNotMatch(shippingOnly, /data-action="reopen-order-preparation"/);

const preparationOnly = renderRow({ packedWeightGrams: 1200 }, ["order.prepare"]);
assert.match(preparationOnly, /data-action="reopen-order-preparation"/);
assert.doesNotMatch(preparationOnly, /data-action="packed-weight-edit"|data-action="ship-ready-order"/);

assert.match(app, /root\.addEventListener\("click", async event => \{[\s\S]*?if \(action === "packed-weight-edit"\) openPackingWeightModal\(target\.dataset\.id,true\)/);
assert.match(app, /function shipReadyOrderModal\(id\) \{[\s\S]*?سجّل وزن الطرد أولًا ثم أدخل كود التتبع/);
assert.match(server, /route\.endsWith\("\/prepare\/reopen"\)[\s\S]*?packedWeightGrams:null,postalCostQuote:null,shippingExport:null/);

console.log("PASS ready-shipping buttons: weight, manual tracking, repack, permissions, and export reset");
