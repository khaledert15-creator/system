const assert = require("assert");
const fs = require("fs");

const app = fs.readFileSync("app/app.js", "utf8");
const css = fs.readFileSync("app/styles.css", "utf8");
const finance = require("../app/order-finance.js");
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test("customer change button opens a dedicated picker", () => {
  assert.match(app, /data-action="open-sale-customer-picker"/);
  assert.match(app, /function openSaleCustomerPicker\(\)[\s\S]*openModal\("تغيير عميل الفاتورة"/);
});

test("picker searches by customer name or phone", () => {
  assert.match(app, /sale-customer-modal-search/);
  assert.match(app, /type="search"[\s\S]*placeholder="ابحث بالاسم أو رقم الهاتف"/);
  assert.match(app, /searchCustomers\(event\.target\.value\)/);
  assert.match(app, /customer\.name\.toLowerCase\(\)[\s\S]*normalizePhone\(customer\.phone\)/);
});

test("picker renders separate accessible customer rows", () => {
  assert.match(app, /class="sale-customer-result/);
  assert.match(app, /role="listbox" aria-label="نتائج البحث عن العملاء"/);
  assert.match(css, /\.sale-customer-result \{[\s\S]*display: grid;[\s\S]*border: 1px solid/);
  assert.match(css, /\.modal-customer-suggestions \{[\s\S]*display: grid;[\s\S]*gap: 8px/);
});

test("current customer has a non-overlapping badge", () => {
  assert.match(app, /sale-customer-current-badge">العميل الحالي/);
  assert.match(app, /customer\.id === draftSale\.customerId/);
  assert.match(css, /\.sale-customer-current-badge[^\{]*\{[^}]*white-space: nowrap/);
});

test("picker has independent scrolling and a fixed footer", () => {
  assert.match(css, /\.modal-customer-suggestions \{[^}]*overflow-y: auto/);
  assert.match(css, /\.sale-customer-change \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.sale-customer-footer \{[^}]*border-top: 1px solid/);
  assert.doesNotMatch(css.match(/\.sale-customer-footer \{[^}]*\}/)?.[0] || "", /position:\s*(absolute|fixed|sticky)/);
  assert.match(app, /sale-customer-footer[\s\S]*رجوع بدون تغيير/);
});

test("selecting a customer updates the draft and preserves its commercial fields", () => {
  const handler = app.match(/if \(appAction\?\.dataset\.action === "choose-sale-customer"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(handler, /draftSale\.customerId = customer\.id/);
  assert.match(handler, /applySaleCustomerShipping/);
  assert.doesNotMatch(handler, /draftSale\.lines\s*=|invoiceDiscount\s*=|notes\s*=/);
});

test("automatic shipping is recalculated and manual override is preserved", () => {
  assert.match(app, /function applySaleCustomerShipping\(customer\) \{\s*if\(!customer\|\|draftSale\.shippingFeeOverride\)return;/);
  assert.match(app, /shippingRateForGovernorate\(customer\.governorate,goods\)/);
});

test("opening and cancelling the picker do not save or mutate the draft", () => {
  const picker = app.match(/function openSaleCustomerPicker\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(picker, /saveData\(|draftSale\.[A-Za-z]+\s*=/);
  assert.match(picker, /data-action="close-modal">رجوع بدون تغيير/);
});

test("typing in customer search does not clear the selected customer", () => {
  const inputHandler = app.match(/if \(event\.target\.id === "sale-customer-modal-search"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(inputHandler, /searchCustomers\(event\.target\.value\)/);
  assert.doesNotMatch(inputHandler, /draftSale\.customerId\s*=\s*""/);
});

test("mobile customer picker stacks safely without overlapping results", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.sale-customer-change \{[^}]*max-height:/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.sale-customer-footer \{[^}]*flex-direction: column/);
  assert.match(css, /\.sale-customer-result-copy strong[^\{]*\{[^}]*text-overflow: ellipsis/);
});

test("notes are visible outside collapsed extra options", () => {
  const summaryStart = app.indexOf('<aside class="card invoice-summary">');
  const detailsStart = app.indexOf('<details class="sale-extra-options"', summaryStart);
  const notesStart = app.indexOf('id="sale-notes"', summaryStart);
  assert(notesStart > summaryStart && notesStart < detailsStart);
});

test("discount value and type have separate labelled columns", () => {
  assert.match(app, /<span class="discount-head">الخصم<\/span><span>نوع الخصم<\/span>/);
  assert.match(app, /aria-label="قيمة الخصم"/);
  assert.match(app, /aria-label="نوع الخصم"/);
});

test("mobile layout keeps discount and type visible", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.quick-sale-line \.discount-field \{ grid-column: 6 \/ 9; display: grid; \}/);
  assert.match(css, /\.quick-sale-line \.sale-discount-type \{ grid-column: 9 \/ 11; \}/);
});

test("summary distinguishes free automatic and manual shipping", () => {
  assert.match(app, /تم تعديل الشحن يدويًا/);
  assert.match(app, /حسب المحافظة/);
  assert.match(app, /free-shipping/);
});

test("shipping presentation updates immediately from free to manual and back", () => {
  const source = app.match(/function saleShippingPresentation\(shipping, state = \{\}\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert(source, "saleShippingPresentation helper is missing");
  const factory = new Function("OrderFinance", "money", "draftSale", `${source}; return saleShippingPresentation;`);
  const present = factory(finance, value => `${value} ج.م`, {});
  assert.deepStrictEqual(present(0, { override:false, source:"governorate:الجيزة" }), { fee:0, amountLabel:"مجاني", sourceLabel:"حسب المحافظة", free:true });
  assert.deepStrictEqual(present(25, { override:true, source:"manual" }), { fee:25, amountLabel:"25 ج.م", sourceLabel:"تم تعديل الشحن يدويًا", free:false });
  assert.deepStrictEqual(present(0, { override:true, source:"manual" }), { fee:0, amountLabel:"مجاني", sourceLabel:"تم تعديل الشحن يدويًا", free:true });
  assert.match(app, /classList\.toggle\("free-shipping",shippingPresentation\.free\)/);
  assert.match(app, /sale-shipping-source"\)\)el\("sale-shipping-source"\)\.textContent=shippingPresentation\.sourceLabel/);
});

test("save remains server-confirmed before clearing the draft", () => {
  assert.match(app, /const saved=await saveData\([\s\S]*?if\(!saved\)[\s\S]*?draftSale=beforeDraft[\s\S]*?resetSaleDraft\(\)/);
  assert.match(app, /if\(!saved\)[\s\S]*?return null;[\s\S]*?toast\(`تم اعتماد الفاتورة/);
});

console.log(`${passed}/16 quick sale customer change UI tests passed`);
