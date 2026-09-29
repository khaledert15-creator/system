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
  ["mobile layout is responsive",/@media\(max-width:760px\)\{\.quick-order-line\{grid-template-columns:repeat\(2/]
];
for(const [name,pattern] of checks){const source=name.includes("columns")||name.includes("mobile")?css:app;assert(pattern.test(source),name);console.log(`PASS ${name}`);}
console.log(`${checks.length}/${checks.length} quick order book discount UX tests passed`);
