const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dbPath = path.join(root, "data", "database.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const db = readJson(dbPath);
db.books = Array.isArray(db.books) ? db.books : [];
db.inventoryBatches = Array.isArray(db.inventoryBatches) ? db.inventoryBatches : [];

const existingByProduct = new Set(
  db.inventoryBatches
    .filter(batch => !batch.deletedAt)
    .map(batch => batch.productId || batch.bookId)
    .filter(Boolean)
);

let normalizedProducts = 0;
let openingBatchesCreated = 0;
let incompleteCostWarnings = 0;
const now = new Date().toISOString();

for (const book of db.books) {
  const productId = book.id;
  if (!productId) continue;

  const coverPrice = num(book.coverPrice ?? book.purchaseListPrice ?? book.price, 0);
  const defaultSellingPrice = num(book.defaultSellingPrice ?? book.price, 0);
  const legacyCost = num(book.lastPurchasePrice ?? book.cost ?? book.purchasePrice, 0);

  if (book.coverPrice === undefined) book.coverPrice = coverPrice;
  if (book.defaultSellingPrice === undefined) book.defaultSellingPrice = defaultSellingPrice;
  if (book.lastPurchasePrice === undefined) book.lastPurchasePrice = legacyCost;
  if (book.purchaseListPrice === undefined) book.purchaseListPrice = coverPrice;
  normalizedProducts += 1;

  const stock = num(book.stock, 0);
  if (stock > 0 && !existingByProduct.has(productId)) {
    if (!legacyCost) incompleteCostWarnings += 1;
    db.inventoryBatches.push({
      id: `OB-${productId}`,
      batchId: `OB-${productId}`,
      productId,
      bookId: productId,
      purchaseInvoiceId: "opening_balance",
      supplierId: book.supplierId || "",
      receivedQty: stock,
      remainingQty: stock,
      unitCost: legacyCost,
      coverPrice,
      purchaseDate: book.createdAt || now,
      source: "opening_balance",
      status: legacyCost ? "active" : "cost_incomplete",
      warning: legacyCost ? "" : "legacy_cost_missing",
      createdAt: now,
      updatedAt: now
    });
    existingByProduct.add(productId);
    openingBatchesCreated += 1;
  }
}

db.meta = db.meta || {};
db.meta.inventoryBatchMigration = {
  version: 1,
  migratedAt: now,
  normalizedProducts,
  openingBatchesCreated,
  incompleteCostWarnings
};

writeJson(dbPath, db);

console.log(JSON.stringify(db.meta.inventoryBatchMigration, null, 2));
