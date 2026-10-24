"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const app = fs.readFileSync("app/app.js", "utf8");
const css = fs.readFileSync("app/styles.css", "utf8");
const pricingStart = app.indexOf("function saleLineNet(");
const pricingEnd = app.indexOf("\nfunction purchaseLineNet(", pricingStart);
assert(pricingStart >= 0 && pricingEnd > pricingStart);
const pricingContext = vm.createContext({
  OrderFinance: { round: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100 },
  discountAmount: (base, value, type) => type === "amount" ? Math.min(base, Number(value || 0)) : base * Number(value || 0) / 100
});
vm.runInContext(app.slice(pricingStart, pricingEnd), pricingContext);
const directLine = { qty:1, price:110, lineDiscount:0, finalNet:87.08 };
const directPricing = vm.runInContext("saleLinePriceBreakdown", pricingContext)(directLine);
assert.equal(directPricing.base, 110);
assert.equal(directPricing.bookDiscountUnit, 0);
assert.equal(directPricing.invoiceDiscountUnit, 22.92);
assert.equal(directPricing.finalUnit, 87.08);
assert.equal(vm.runInContext("saleInvoiceDiscountTotal", pricingContext)({ lines:[directLine], invoiceDiscountAmount:22.92 }), 22.92);
const onlinePricing = vm.runInContext("saleLinePriceBreakdown", pricingContext)({ qty:2, unitOriginalPrice:100, lineDiscountTotal:10, unitFinalPrice:95, finalNet:170 });
assert.equal(onlinePricing.bookDiscountUnit, 5);
assert.equal(onlinePricing.invoiceDiscountUnit, 10);
assert.equal(onlinePricing.finalUnit, 85);
assert.equal(vm.runInContext("saleLineNet", pricingContext)({ qty:2, finalNet:170 }, 1), 85, "partial return uses the saved invoice net");
const saleViewStart = app.indexOf("function viewSale(");
const saleViewEnd = app.indexOf("\nfunction salePaymentModal(", saleViewStart);
assert(saleViewStart >= 0 && saleViewEnd > saleViewStart);
const saleViews = [];
Object.assign(pricingContext, {
  data: { sales:[{ id:"INV-1", customerId:"C1", lines:[{ bookId:"B1", ...directLine }], subtotal:110, total:87.08, discount:22.92, invoiceDiscountAmount:22.92, shipping:0, paid:0, remaining:87.08 }] },
  getCustomer: () => ({ name:"عميل اختبار", phone:"01000000000" }),
  getBook: () => ({ name:"كتاب اختبار" }),
  shipmentForSale: () => null,
  documentDisplayName: value => value,
  dateTimeLabel: value => value || "—",
  saleCreatedByName: () => "موظف",
  paymentStatusLabel: () => "غير مدفوع",
  money: value => `${Number(value || 0).toFixed(2)} ج.م`,
  esc: value => String(value ?? ""),
  openModal: (...args) => saleViews.push(args)
});
vm.runInContext(app.slice(app.indexOf("function normalizePhone(value) {"), app.indexOf("function normalizeTrackingNumber(")) + app.slice(saleViewStart, saleViewEnd), pricingContext);
vm.runInContext('viewSale("INV-1")', pricingContext);
assert.match(saleViews[0][2], /خصم الفاتورة للنسخة/);
assert.match(saleViews[0][2], /22\.92 ج\.م/);
assert.match(saleViews[0][2], /87\.08 ج\.م/);
assert.match(saleViews[0][2], /خصم الفاتورة <b>22\.92 ج\.م/);
const summaryStart = app.indexOf("function updateCustomerSaleReturnSummary(");
const summaryEnd = app.indexOf("\nfunction isFullyReturned(", summaryStart);
assert(summaryStart >= 0 && summaryEnd > summaryStart);
const valueCell = { textContent:"" };
const metricCells = Object.fromEntries(["customer-return-gross", "customer-return-debt", "customer-return-replacement", "customer-return-due"].map(id => [id, { textContent:"" }]));
const input = { value:"1", max:"1", dataset:{ saleId:"INV-1", unitValue:"87.08" }, closest:() => ({ querySelector:() => valueCell }) };
const cashField = { hidden:false };
const form = { querySelectorAll:() => [input], querySelector:() => cashField, elements:{ replacementDeduction:{ value:"0" }, settlement:{ value:"cash" } } };
const summaryContext = vm.createContext({
  document:{ getElementById:id => id === "sale-customer-return-form" ? form : metricCells[id] },
  customerSaleReturnCalculation:lines => ({ returnAmount:lines[0].amount, debtReduction:0, replacement:0, customerDue:lines[0].amount }),
  money:value => `${Number(value || 0).toFixed(2)} ج.م`
});
vm.runInContext(app.slice(summaryStart, summaryEnd), summaryContext);
vm.runInContext("updateCustomerSaleReturnSummary()", summaryContext);
assert.equal(valueCell.textContent, "87.08 ج.م", "selected return value updates from the saved final unit price");
assert.equal(metricCells["customer-return-gross"].textContent, "87.08 ج.م");

const returnableSource = app.slice(app.indexOf("function saleReturnableLines("), app.indexOf("\nfunction customerReturnableSaleLines(")).trim();
assert(returnableSource.startsWith("function saleReturnableLines("));
const returnable = vm.runInNewContext(`(${returnableSource})`, { returnedQuantityMap: () => new Map([["0", 1]]), saleLineNet: (_line, qty) => qty * 90 });
const [line] = returnable({ id:"INV-1", date:"2026-10-11", lines:[{ bookId:"B1", qty:3, price:100 }] });
assert.equal(line.remaining, 2, "available means sold quantity minus earlier returns");

const start = app.indexOf("function saleReturnByCustomerModal(");
const end = app.indexOf("\nfunction purchaseReturnBySupplierModal(", start);
assert(start >= 0 && end > start);
const customer = { id:"C1", name:"عميل اختبار", balance:275 };
const captured = [];
const context = vm.createContext({
  getCustomer: () => customer,
  customerReturnableSaleLines: () => [{ ...line, saleId:"INV-1", lineIndex:0, saleDate:"2026-10-11", invoiceDiscountTotal:30 }],
  getBook: () => ({ name:"كتاب اختبار", barcode:"BOOK-1" }),
  saleLineNet: (_line, qty) => qty * 90,
  saleLinePriceBreakdown: () => ({ base:100, bookDiscountPercent:0, bookDiscountUnit:0, invoiceDiscountUnit:10, finalUnit:90 }),
  normalizeReturnSearch: value => value,
  fmtDate: value => value,
  money: value => `${value} ج.م`,
  esc: value => String(value ?? ""),
  cashAccountOptions: () => "<option>الخزينة الرئيسية</option>",
  today: () => "2026-10-11",
  openModal: (...args) => captured.push(args),
  setTimeout: () => {},
  updateCustomerSaleReturnSummary: () => {},
  toast: message => { throw new Error(message); }
});
vm.runInContext(app.slice(start, end), context);
vm.runInContext('saleReturnByCustomerModal("C1")', context);
const html = captured[0]?.[2] || "";
assert.match(html, /مديونية العميل الحالية<\/span><strong>275 ج\.م/);
assert.match(html, /متاح للمرتجع<\/span><strong>٢ نسخة/);
assert.match(html, /سعر الكتاب − خصم الكتاب − نصيبه من خصم الفاتورة/);
assert.match(html, /وليس رصيد المخزون/);
assert.match(html, /data-label="المتاح للمرتجع"/);
assert.match(html, /أُرجع سابقًا ١/);
assert.match(html, /خصم الفاتورة بالكامل 30 ج\.م/);
assert.match(html, /data-label="خصم الفاتورة للنسخة" class="money">10 ج\.م/);
assert.match(html, /data-label="سعر النسخة النهائي" class="money"><strong>90 ج\.م/);
assert.match(html, /data-label="قيمة المرتجع" class="money" data-return-line-value>0 ج\.م/);
assert.match(html, /aria-label="كمية مرتجع كتاب اختبار من فاتورة INV-1"/);
assert.match(css, /\.modal:has\(#sale-customer-return-form\) \{[^}]*width: min\(1700px, calc\(100vw - 32px\)\)/);
assert.match(css, /\.customer-return-table \{[^}]*min-width: 0; table-layout: fixed/);
assert.match(css, /@media \(max-width: 1100px\) \{[\s\S]*?\.customer-return-table tr \{[^}]*display: grid/);

customer.balance = -50;
vm.runInContext('saleReturnByCustomerModal("C1")', context);
assert.match(captured[1][2], /مديونية العميل الحالية<\/span><strong>0 ج\.م/);
assert.match(captured[1][2], /رصيد دائن 50 ج\.م/);
console.log("PASS customer return: full-width layout, responsive rows, debt, invoice discount split, and saved net accounting");
