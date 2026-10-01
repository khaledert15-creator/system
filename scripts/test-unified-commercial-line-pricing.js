const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "app", "styles.css"), "utf8");
let passed = 0;

function check(label, condition) {
  if (!condition) throw new Error(`FAIL ${label}`);
  passed += 1;
  console.log(`PASS ${label}`);
}

check("shared unit pricing helper exists", app.includes("function commercialUnitPricing"));
check("sale entry exposes percent and amount together", app.includes("sale-discount-percent") && app.includes("sale-discount-amount"));
check("sale amount and percent update one canonical discount", app.includes("setSaleLineDiscount(index, event.target.value"));
check("sale fixed discount stays per unit when quantity changes", app.includes("Number(line.unitDiscountAmount) * line.qty"));
check("purchase entry exposes percent and amount together", app.includes("purchase-supplier-discount") && app.includes("purchase-discount-amount"));
check("purchase amount derives the after-discount cost", app.includes("line.cost = OrderFinance.round(cover - amount)"));
check("sale details show all requested pricing columns", /السعر الأساسي<\/th><th>خصم %<\/th><th>خصم ج\.م<\/th><th>السعر بعد الخصم/.test(app));
check("purchase details show all requested pricing columns", app.includes('commercialUnitPricing(line,"purchase")'));
check("return source pricing is resolved from original documents", app.includes("function returnLinePricing") && app.includes("sourceInvoiceId"));
check("all return selectors expose pricing breakdown", (app.match(/كمية المرتجع<\/th><th>قيمة المتاح/g) || []).length >= 4 && (app.match(/خصم ج\.م<\/th>/g) || []).length >= 7);
check("sale and purchase printouts expose explicit discount columns", (app.match(/<th>خصم %<\/th><th>خصم ج\.م<\/th><th>بعد الخصم<\/th>/g) || []).length >= 2);
check("online order details retain the unified pricing fields", app.includes("line.unitOriginalPrice") && app.includes("line.unitDiscountAmount") && app.includes("line.unitFinalPrice"));
check("desktop sale rows have eight aligned columns", css.includes("minmax(130px, 1.7fr) 52px 68px 58px 68px 78px 88px 30px"));
check("purchase rows have eight aligned columns", css.includes("minmax(130px, 1.7fr) 52px 70px 58px 68px 78px 88px 30px"));
check("line editor has safe horizontal overflow", css.includes(".invoice-lines { padding: 16px; overflow-x: auto; }"));
check("mobile sale fields have explicit grid positions", css.includes(".sale-discount-percent { grid-column: 6 / 8; }") && css.includes(".sale-discount-amount { grid-column: 8 / 10; }"));
check("sale card layout keeps all eight columns visible", css.includes(".invoice-lines .sale-line-head,.invoice-lines .quick-sale-line{grid-template-columns:minmax(145px,1.55fr) 48px 66px 56px 66px 76px 84px 30px"));
check("sale card remove button is wired to delegated action", /class="row-action sale-remove"[^>]*data-action="remove-sale-line"/.test(app) && app.includes('if (action === "remove-sale-line")'));
check("purchase line remove button is wired to delegated action", /class="row-action purchase-remove"[^>]*data-action="remove-purchase-line"/.test(app) && app.includes('if (action === "remove-purchase-line")'));
const purchaseRender = app.slice(app.indexOf("function renderPurchases()"), app.indexOf("function updatePurchaseSummary()"));
check("purchase workspace omits duplicate command cards and history panel", !purchaseRender.includes("purchase-command-grid") && !purchaseRender.includes("purchasesHistoryPanel()"));
check("purchase register uses a dedicated wide modal", app.includes('class="purchase-list-modal"') && css.includes('.modal:has(.purchase-list-modal)') && css.includes('width: min(1600px, calc(100vw - 32px))'));

console.log(`${passed}/${passed} unified commercial line pricing tests passed`);
