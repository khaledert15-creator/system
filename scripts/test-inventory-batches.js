const fs = require("fs");
const path = require("path");

const dbPath = path.resolve(__dirname, "..", "data", "database.json");
const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));

function assert(name, condition, details = "") {
  if (!condition) {
    throw new Error(`${name}${details ? `: ${details}` : ""}`);
  }
  console.log(`PASS ${name}`);
}

function allocateFIFO(batches, productId, qty) {
  let remaining = Number(qty || 0);
  let cogs = 0;
  const allocations = [];
  batches
    .filter(batch => batch.productId === productId && batch.status !== "closed" && Number(batch.remainingQty || 0) > 0)
    .sort((a, b) => new Date(a.purchaseDate || a.createdAt || 0) - new Date(b.purchaseDate || b.createdAt || 0))
    .forEach(batch => {
      if (remaining <= 0) return;
      const take = Math.min(remaining, Number(batch.remainingQty || 0));
      batch.remainingQty = Number((Number(batch.remainingQty || 0) - take).toFixed(6));
      remaining = Number((remaining - take).toFixed(6));
      cogs += take * Number(batch.unitCost || 0);
      allocations.push({ batchId: batch.batchId, qty: take, unitCost: Number(batch.unitCost || 0) });
    });
  return { cogs: Number(cogs.toFixed(2)), allocations, remaining };
}

assert("database has books", Array.isArray(db.books) && db.books.length > 0);
assert("inventoryBatches array exists", Array.isArray(db.inventoryBatches));
assert("opening batch migration exists", Boolean(db.meta?.inventoryBatchMigration));

const productId = "FIFO-QA-001";
const batches = [
  { batchId: "BAT-QA-1", productId, supplierId: "SUP-A", receivedQty: 5, remainingQty: 5, unitCost: 50, coverPrice: 100, purchaseDate: "2026-01-01", status: "active" },
  { batchId: "BAT-QA-2", productId, supplierId: "SUP-B", receivedQty: 7, remainingQty: 7, unitCost: 70, coverPrice: 100, purchaseDate: "2026-02-01", status: "active" }
];

const firstSale = allocateFIFO(batches, productId, 3);
assert("sale below first batch uses first batch only", firstSale.allocations.length === 1 && firstSale.allocations[0].batchId === "BAT-QA-1");
assert("COGS for first sale", firstSale.cogs === 150, `expected 150 got ${firstSale.cogs}`);
assert("remaining first batch after first sale", batches[0].remainingQty === 2);

const secondSale = allocateFIFO(batches, productId, 6);
assert("sale crossing batches uses two batches", secondSale.allocations.length === 2);
assert("second sale allocation from first batch", secondSale.allocations[0].batchId === "BAT-QA-1" && secondSale.allocations[0].qty === 2);
assert("second sale allocation from second batch", secondSale.allocations[1].batchId === "BAT-QA-2" && secondSale.allocations[1].qty === 4);
assert("COGS for crossing sale", secondSale.cogs === 380, `expected 380 got ${secondSale.cogs}`);
assert("remaining second batch after crossing sale", batches[1].remainingQty === 3);

const revenue = 6 * 100;
assert("gross profit calculation", revenue - secondSale.cogs === 220);

const actualOpeningBatches = db.inventoryBatches.filter(batch => batch.source === "opening_balance");
assert("opening batches created for existing stock", actualOpeningBatches.length === db.meta.inventoryBatchMigration.openingBatchesCreated);

const inventoryValue = db.inventoryBatches
  .filter(batch => !batch.deletedAt)
  .reduce((sum, batch) => sum + Number(batch.remainingQty || 0) * Number(batch.unitCost || 0), 0);
assert("current inventory value can be calculated from batches", Number.isFinite(inventoryValue));

console.log(JSON.stringify({
  fifoFirstSaleCogs: firstSale.cogs,
  fifoCrossBatchCogs: secondSale.cogs,
  grossProfit: revenue - secondSale.cogs,
  openingBatches: actualOpeningBatches.length,
  inventoryValue: Number(inventoryValue.toFixed(2))
}, null, 2));
