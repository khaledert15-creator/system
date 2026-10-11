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

test("quick sale and customer picker both offer adding a new customer", () => {
  const invoice = app.match(/function renderSaleInvoice\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const picker = app.match(/function openSaleCustomerPicker\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(invoice, /class="quick-customer"[\s\S]*?data-action="register-sale-customer">\+ إضافة عميل/);
  assert.match(picker, /data-action="register-sale-customer">\+ إضافة عميل جديد/);
  assert.match(css, /\.quick-customer-actions \{[^}]*display: flex/);
  assert.match(css, /\.sale-customer-footer-actions \{[^}]*display: flex/);
});

test("new customer is selected only after a successful save without clearing invoice lines", () => {
  assert.match(app, /if \(action === "register-sale-customer"\) addPartyModal\("customer", null, \{ returnToSale: true \}\)/);
  const submit = app.match(/if \(form\.id === "party-form"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(submit, /const saved = await saveData\(partyOperation/);
  assert.match(submit, /if \(!saved\) \{[\s\S]*?return toast/);
  assert.match(submit, /if \(isCustomer && form\.dataset\.returnToSale === "true"\) \{\s*draftSale\.customerId = item\.id;\s*applySaleCustomerShipping\(item\);\s*renderSales\(\)/);
  assert.doesNotMatch(submit, /resetSaleDraft\(|draftSale\.lines\s*=/);
});

test("add customer button inside the picker opens the sale customer form", () => {
  const modalClick = app.match(/modalBody\.addEventListener\("click", event => \{[\s\S]*?\n\}\);/)?.[0] || "";
  assert.match(modalClick, /dataset\.action === "register-sale-customer"[\s\S]*?requireAction\("register-sale-customer"\)[\s\S]*?addPartyModal\("customer", null, \{ returnToSale: true \}\)/);
});

test("arrow keys move through customer and book suggestions without replacing Tab", () => {
  const source = app.match(/function focusSuggestionWithArrow\(event, input, list\) \{[\s\S]*?\n\}/)?.[0] || "";
  const navigate = new Function(`${source}; return focusSuggestionWithArrow;`)();
  let focused = "", prevented = false;
  const input = { focus: () => { focused = "search"; } };
  const buttons = [0, 1, 2].map(index => ({ focus: () => { focused = index; } }));
  const list = { querySelectorAll: () => buttons };
  const event = (key, target) => ({ key, target, preventDefault: () => { prevented = true; } });
  assert.strictEqual(navigate(event("ArrowDown", input), input, list), true);
  assert.strictEqual(focused, 0);
  assert.strictEqual(navigate(event("ArrowDown", buttons[0]), input, list), true);
  assert.strictEqual(focused, 1);
  assert.strictEqual(navigate(event("ArrowUp", buttons[0]), input, list), true);
  assert.strictEqual(focused, "search");
  assert.strictEqual(navigate(event("ArrowUp", input), input, list), true);
  assert.strictEqual(focused, 2);
  assert.strictEqual(prevented, true);
  prevented = false;
  assert.strictEqual(navigate(event("Tab", input), input, list), false);
  assert.strictEqual(prevented, false);
  assert.match(app, /event\.target\.id === "sale-book-search" \|\| event\.target\.closest\("#sale-book-suggestions"\)/);
  assert.match(app, /modalBody\.addEventListener\("keydown"[\s\S]*?focusSuggestionWithArrow\(event, input, list\)/);
});

test("Tab stays inside sale customer dialogs and focus begins at the first field", () => {
  assert.match(app, /modal\.addEventListener\("keydown"[\s\S]*?event\.key !== "Tab"[\s\S]*?focusable\.at\(-1\)\.focus\(\)[\s\S]*?focusable\[0\]\.focus\(\)/);
  assert.match(app, /modalBody\.querySelector\("#sale-customer-modal-search"\)\?\.focus\(\)/);
  assert.match(app, /if \(options\.returnToSale\) modalBody\.querySelector\('#party-form \[name="name"\]'\)\?\.focus\(\)/);
  assert.match(app, /id="sale-book-suggestions"[\s\S]*?id="sale-quick-qty"/);
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
  assert.match(app, /class="quick-order-table-head sale-line-head"[\s\S]*?<span>السعر الأساسي<\/span><span>خصم %<\/span><span>خصم ج\.م<\/span><span>بعد الخصم<\/span><span>إجمالي الصنف<\/span>/);
  assert.match(app, /aria-label="نسبة الخصم"/);
  assert.match(app, /aria-label="قيمة الخصم بالجنيه للنسخة"/);
});

test("mobile layout keeps discount and type visible", () => {
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.invoice-lines \.quick-sale-line \.quick-discount-field\{grid-column:auto\}/);
  assert.match(css, /\.invoice-lines \.quick-sale-line\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
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

console.log(`${passed} quick sale customer change UI tests passed`);
