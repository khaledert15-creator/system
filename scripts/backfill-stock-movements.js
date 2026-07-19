#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const databasePath = path.resolve(process.argv.find(arg => arg.startsWith("--database="))?.split("=").slice(1).join("=") || path.join(ROOT, "data", "database.json"));
const reportPath = path.resolve(process.argv.find(arg => arg.startsWith("--report="))?.split("=").slice(1).join("=") || path.join(ROOT, "docs", "product-movement-backfill-report.md"));
const apply = process.argv.includes("--apply");

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function lineItems(document) { return Array.isArray(document.lines) ? document.lines : Array.isArray(document.items) ? document.items : []; }
function lineBookId(line) { return line.bookId || line.productId || ""; }
function lineQuantity(line) { return Math.abs(number(line.qty ?? line.quantity)); }
function documentDate(document) { return document.date || document.createdAt || document.updatedAt || "1970-01-01T00:00:00.000Z"; }
function isCancelled(document) { return Boolean(document.deletedAt || /ملغ/.test(String(document.status || ""))); }
function returnKind(document) { return /مشتريات|شراء|أمانة|supplier|purchase/i.test(String(document.type || document.kind || document.returnType || "")) ? "purchase-return" : "sale-return"; }
function movementClass(type = "") {
  if (/إلغاء/.test(type)) return "cancelled";
  if (/مرتجع مبيعات/.test(type)) return "sale-return";
  if (/مرتجع مشتريات|مرتجع أمانة/.test(type)) return "purchase-return";
  if (/بيع/.test(type)) return "sale";
  if (/شراء|توريد|استلام/.test(type)) return "purchase";
  if (/افتتاح/.test(type)) return "opening";
  if (/جرد/.test(type)) return "count";
  if (/تسوية|تالف|مفقود|تصحيح/.test(type)) return "adjustment";
  return "other";
}
function sourceKey(documentType, documentId, bookId, movementType, lineIndex) {
  return [documentType, documentId, bookId, movementType, lineIndex].map(value => String(value ?? "").replaceAll("|", "/")).join("|");
}

function buildCandidates(db, review) {
  const candidates = [];
  const historicalDates = [...(db.sales || []), ...(db.purchases || []), ...(db.returns || [])].filter(document => !isCancelled(document)).map(documentDate).map(value => new Date(value).getTime()).filter(Number.isFinite);
  const openingDate = historicalDates.length ? new Date(Math.min(...historicalDates) - 1).toISOString() : "1970-01-01T00:00:00.000Z";
  const pushLines = (documents, documentType, movementType, sign, partyField) => {
    for (const document of documents || []) {
      review.documentsInspected += 1;
      if (isCancelled(document)) { review.skipped.push(`${documentType} ${document.id || document.returnNo || "بدون رقم"}: ملغي أو محذوف`); continue; }
      const lines = lineItems(document);
      if (!lines.length) { review.uninterpreted.push(`${documentType} ${document.id || document.returnNo || "بدون رقم"}: لا توجد بنود تفصيلية`); continue; }
      lines.forEach((line, index) => {
        const bookId = lineBookId(line); const quantity = lineQuantity(line);
        if (!bookId || !quantity) { review.uninterpreted.push(`${documentType} ${document.id || document.returnNo || "بدون رقم"} سطر ${index + 1}: صنف أو كمية غير صالحين`); return; }
        const documentId = document.id || document.returnNo || document.documentId || "";
        const kind = typeof movementType === "function" ? movementType(document) : movementType;
        const direction = typeof sign === "function" ? sign(document) : sign;
        const unitPrice = number(line.unitPrice ?? line.price ?? line.unitSellingPrice ?? line.coverPriceAtPurchase);
        const unitCost = number(line.unitPurchaseCost ?? line.cost ?? line.unitCost);
        candidates.push({ sourceKey:sourceKey(documentType, documentId, bookId, kind, index), bookId, productId:bookId, date:documentDate(document), createdAt:document.createdAt || documentDate(document), type:kind, movementType:kind, quantity:direction * quantity, quantityIn:direction > 0 ? quantity : 0, quantityOut:direction < 0 ? quantity : 0, documentType, documentId, documentNo:document.supplierInvoiceNumber || document.returnNo || documentId, documentNumber:document.supplierInvoiceNumber || document.returnNo || documentId, customerId:document.customerId || (documentType === "sale-return" ? document.accountId || "" : ""), supplierId:document.supplierId || (documentType === "purchase-return" ? document.accountId || "" : ""), partyId:document[partyField] || document.accountId || "", userId:document.createdByUserId || document.userId || "", username:document.createdByUsername || "", employeeName:document.createdByName || document.createdBy || "غير مسجل (Backfill)", unitPrice, priceAtOperation:unitPrice, unitCost, costAtOperation:unitCost, notes:document.notes || document.reason || `Backfill من ${documentType}`, note:document.notes || document.reason || `Backfill من ${documentType}`, lineIndex:index });
      });
    }
  };

  const openingByBook = new Map();
  for (const batch of db.inventoryBatches || []) {
    if (batch.deletedAt || batch.source !== "opening_balance") continue;
    const bookId = batch.bookId || batch.productId; if (!bookId) continue;
    const current = openingByBook.get(bookId) || { quantity:0, date:batch.purchaseDate || batch.createdAt, unitCost:0, costQty:0 };
    const qty = number(batch.receivedQty); current.quantity += qty; current.date = [current.date, batch.purchaseDate || batch.createdAt].filter(Boolean).sort()[0]; current.unitCost += number(batch.unitCost) * qty; current.costQty += qty; openingByBook.set(bookId, current);
  }
  for (const [bookId, row] of openingByBook) candidates.push({ sourceKey:sourceKey("opening_balance", "opening_balance", bookId, "مخزون افتتاحي", 0), bookId, productId:bookId, date:openingDate, createdAt:openingDate, type:"مخزون افتتاحي", movementType:"مخزون افتتاحي", quantity:row.quantity, quantityIn:row.quantity, quantityOut:0, documentType:"opening_balance", documentId:"opening_balance", documentNo:"opening_balance", documentNumber:"opening_balance", partyId:"", userId:"", employeeName:"النظام", unitPrice:0, priceAtOperation:0, unitCost:row.costQty ? row.unitCost / row.costQty : 0, costAtOperation:row.costQty ? row.unitCost / row.costQty : 0, notes:"رصيد افتتاحي من دفعات التهيئة", note:"رصيد افتتاحي من دفعات التهيئة", lineIndex:0 });

  pushLines(db.sales, "sale", "بيع", -1, "customerId");
  pushLines((db.purchases || []).filter(document => !/بانتظار|قيد/.test(String(document.status || ""))), "purchase", document => document.type === "أمانة" ? "توريد أمانة" : "شراء", 1, "supplierId");
  const saleReturns = (db.returns || []).filter(document => returnKind(document) === "sale-return");
  const purchaseReturns = (db.returns || []).filter(document => returnKind(document) === "purchase-return");
  pushLines(saleReturns, "sale-return", "مرتجع مبيعات", 1, "customerId");
  pushLines(purchaseReturns, "purchase-return", document => /أمانة/.test(String(document.type || "")) ? "مرتجع أمانة" : "مرتجع مشتريات", -1, "supplierId");
  return candidates.sort((a,b) => String(a.date).localeCompare(String(b.date)) || a.sourceKey.localeCompare(b.sourceKey));
}

function run(db) {
  db.stockMovements = Array.isArray(db.stockMovements) ? db.stockMovements : [];
  const review = { documentsInspected:0, existing:0, toCreate:0, metadataUpdated:0, uninterpreted:[], skipped:[], mismatches:[], added:[] };
  const candidates = buildCandidates(db, review);
  const exactKeys = new Set(db.stockMovements.map(item => item.sourceKey).filter(Boolean));
  const claimedLegacy = new Set();
  let nextNumber = db.stockMovements.reduce((max,item) => Math.max(max, number(String(item.id || "").match(/(\d+)$/)?.[1])), 0) + 1;
  for (const candidate of candidates) {
    if (exactKeys.has(candidate.sourceKey)) { review.existing += 1; continue; }
    const candidateClass = movementClass(candidate.type);
    const legacyIndex = db.stockMovements.findIndex((item,index) => !item.sourceKey && !claimedLegacy.has(index) && item.bookId === candidate.bookId && String(item.documentId || item.documentNo || "") === String(candidate.documentId) && movementClass(item.type) === candidateClass && number(item.quantity) === number(candidate.quantity));
    if (legacyIndex >= 0) {
      claimedLegacy.add(legacyIndex); review.existing += 1; review.metadataUpdated += 1;
      Object.assign(db.stockMovements[legacyIndex], { sourceKey:candidate.sourceKey, productId:candidate.productId, movementType:candidate.movementType, quantityIn:candidate.quantityIn, quantityOut:candidate.quantityOut, documentType:candidate.documentType, documentNumber:candidate.documentNumber, partyId:candidate.partyId, unitPrice:candidate.unitPrice, unitCost:candidate.unitCost, notes:candidate.notes });
      exactKeys.add(candidate.sourceKey); continue;
    }
    const id = `MOV-${String(nextNumber++).padStart(6,"0")}`;
    db.stockMovements.push({ id, ...candidate, before:null, after:null, backfilled:true, backfilledAt:new Date().toISOString() });
    review.toCreate += 1; review.added.push(`${id}: ${candidate.sourceKey} (${candidate.quantity})`); exactKeys.add(candidate.sourceKey);
  }

  const books = new Map((db.books || []).map(book => [book.id, book]));
  for (const [bookId, book] of books) {
    const rows = db.stockMovements.filter(item => item.bookId === bookId).sort((a,b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt)) || String(a.sourceKey || a.id).localeCompare(String(b.sourceKey || b.id)));
    let balance = 0;
    rows.forEach(item => { item.calculatedBefore = balance; balance += number(item.quantity); item.calculatedAfter = balance; });
    const current = number(book.stock);
    if (Math.abs(balance - current) > 0.0001) review.mismatches.push({ bookId, name:book.name, calculated:balance, current, difference:current-balance });
  }
  return review;
}

function reportMarkdown(review, mode, backupFile = "—") {
  return `# تقرير Backfill لحركات المخزون\n\n- الوضع: **${mode}**\n- قاعدة البيانات: \`${databasePath}\`\n- النسخة الاحتياطية: \`${backupFile}\`\n- المستندات المفحوصة: **${review.documentsInspected}**\n- الحركات الموجودة مسبقًا: **${review.existing}**\n- الحركات التي ستُنشأ/أُنشئت: **${review.toCreate}**\n- الحركات القديمة التي أضيف لها sourceKey: **${review.metadataUpdated}**\n- السجلات التي تعذر تفسيرها: **${review.uninterpreted.length}**\n- فروقات الرصيد: **${review.mismatches.length}**\n\n## الحركات المضافة\n\n${review.added.map(row=>`- ${row}`).join("\n") || "لا توجد."}\n\n## السجلات المتجاهلة\n\n${[...review.skipped,...review.uninterpreted].map(row=>`- ${row}`).join("\n") || "لا توجد."}\n\n## الأصناف التي تحتاج مراجعة\n\n${review.mismatches.map(row=>`- ${row.bookId} — ${row.name}: المحسوب ${row.calculated}، الحالي ${row.current}، الفرق ${row.difference}`).join("\n") || "لا توجد فروقات."}\n`;
}

if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
const originalText = fs.readFileSync(databasePath, "utf8");
const database = JSON.parse(originalText);
const review = run(database);
let backupFile = "—";
if (apply) {
  const backupDir = path.join(path.dirname(databasePath), "backups"); fs.mkdirSync(backupDir, { recursive:true });
  backupFile = path.join(backupDir, `database-before-product-movement-backfill-${new Date().toISOString().replace(/[:.]/g,"-")}.json`);
  fs.writeFileSync(backupFile, originalText, "utf8");
  const temporary = `${databasePath}.backfill.tmp`; fs.writeFileSync(temporary, JSON.stringify(database, null, 2), "utf8"); fs.renameSync(temporary, databasePath);
}
fs.mkdirSync(path.dirname(reportPath), { recursive:true });
fs.writeFileSync(reportPath, reportMarkdown(review, apply ? "APPLY" : "DRY RUN", backupFile), "utf8");
process.stdout.write(JSON.stringify({ mode:apply ? "apply" : "dry-run", databasePath, reportPath, backupFile, ...review }, null, 2) + "\n");
