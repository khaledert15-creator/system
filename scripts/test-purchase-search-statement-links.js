#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "app", "styles.css"), "utf8");

const checks = [
  ["purchase search normalizes Arabic digits", /function normalizePurchaseSearch[\s\S]*replace\(\/\[٠-٩\]\/g/],
  ["purchase search covers document and supplier invoice", /filterPurchasesForSearch[\s\S]*purchase\.id[\s\S]*purchase\.supplierInvoiceNumber/],
  ["purchase search covers supplier and products", /filterPurchasesForSearch[\s\S]*supplier\?\.name[\s\S]*\.\.\.products/],
  ["main purchase history has search input", /id="purchase-history-search"/],
  ["full purchase list has search input", /id="purchase-list-search"/],
  ["main search updates only results table", /function updatePurchaseHistorySearch[\s\S]*results\.innerHTML = purchaseHistoryTable/],
  ["supplier purchase reference uses unified statement opener", /statement-document-link[\s\S]*data-action="open-statement-record"[\s\S]*data-reference="\$\{esc\(row\.reference\)\}"/],
  ["duplicate invoice link is avoided", /row\.links\.invoiceId !== row\.reference/],
  ["PUR references route to purchase viewer", /if \(ref\.startsWith\("PUR-"\)\) return viewPurchase\(ref\)/],
  ["search and statement link styles exist", /\.purchase-history-searchbar[\s\S]*\.statement-document-link/],
  ["mobile search layout exists", /@media \(max-width: 640px\)[\s\S]*\.purchase-history-searchbar/]
];

let failed = 0;
for (const [name, pattern] of checks) {
  const source = name.includes("styles") || name.includes("mobile") ? css : app;
  if (!pattern.test(source)) {
    failed += 1;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`PASS: ${name}`);
  }
}
if (failed) process.exit(1);
console.log("Purchase search and statement links tests passed.");
