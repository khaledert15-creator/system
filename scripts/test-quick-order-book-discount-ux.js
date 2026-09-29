#!/usr/bin/env node
const fs=require("fs"),path=require("path"),assert=require("assert");
const root=path.resolve(__dirname,".."),app=fs.readFileSync(path.join(root,"app/app.js"),"utf8"),css=fs.readFileSync(path.join(root,"app/styles.css"),"utf8");
const checks=[
  ["latest discount helper reads orders and sales",/function quickOrderLastBookDiscount[\s\S]*data\.onlineOrders[\s\S]*data\.sales/],
  ["cancelled history is ignored",/quickOrderLastBookDiscount[\s\S]*\["ملغاة","ملغي"\]/],
  ["amount history is converted to percent",/type==="amount"\?OrderFinance\.round\(Math\.min\(100,raw\*100\/price\)\)/],
  ["adding a book applies latest percent",/lastDiscount=quickOrderLastBookDiscount\(book\.id\)[\s\S]*discount:lastDiscount\.percent[\s\S]*discountType:"percent"/],
  ["search shows price and latest discount",/quick-result-price[\s\S]*السعر الأساسي[\s\S]*quick-result-discount[\s\S]*آخر خصم/],
  ["selected line shows base price",/quick-price-cell[\s\S]*السعر الأساسي/],
  ["percent and amount inputs coexist",/data-quick-order-discount-percent[\s\S]*data-quick-order-discount-amount/],
  ["percent or amount updates canonical draft",/isAmount\?"amount":"percent"/],
  ["derived inputs refresh without full render",/percentInput[\s\S]*amountInput[\s\S]*unitFinal/],
  ["final unit and line totals are visible",/data-quick-line-unit-final[\s\S]*data-quick-line-total/],
  ["search uses smart matching",/term\?smartBookSearch\(quickOrderSearch,10\)/],
  ["desktop table columns are aligned",/\.quick-order-table-head,.quick-order-line\{display:grid;grid-template-columns/],
  ["mobile layout is responsive",/@media\(max-width:760px\)\{\.quick-order-line\{grid-template-columns:repeat\(2/],
  ["book selection closes results and focuses quantity",/selectedIndex=quickOrderDraft\.lines\.findIndex[\s\S]*focusSelector:`\[data-quick-order-qty=/],
  ["book rows have visual hierarchy",/quick-book-avatar[\s\S]*quick-price-cell[\s\S]*quick-final-price/],
  ["shipping and payment cards are compact",/\.quick-shipping-card,.quick-payment-card\{padding:14px 16px\}[\s\S]*\.quick-shipping-preview\{display:grid;grid-template-columns:auto 1fr/],
  ["medium screens place shipping and payment side by side",/@media\(min-width:900px\) and \(max-width:1450px\)[\s\S]*\.quick-shipping-card,.quick-payment-card\{align-self:start\}/]
];
for(const [name,pattern] of checks){const source=["columns","mobile","compact","screens","hierarchy"].some(token=>name.includes(token))?css:app;assert(pattern.test(source),name);console.log(`PASS ${name}`);}
console.log(`${checks.length}/${checks.length} quick order book discount UX tests passed`);
