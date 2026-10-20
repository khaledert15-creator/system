#!/usr/bin/env node
"use strict";

// Measures what one whole-database save costs, on a synthetic database of a given size (no real data):
// browser-side JSON.stringify, server time for PUT /api/db and GET /api/db on loopback, and the gzip ratio.
// Usage: node scripts/bench-db-save.js [targetMegabytes=6] [runs=5]
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const targetBytes = Number(process.argv[2] || 6) * 1024 * 1024;
const runs = Number(process.argv[3] || 5);
const PASSWORD = "DotCom@2026";

const source = fs.readFileSync(path.join(ROOT, "server-node.js"), "utf8");
const users = new Function(`return ${source.match(/const defaultUsers = (\[[\s\S]*?\n\]);/)[1]};`)();
const books = Array.from({ length:120 }, (_, i) => ({ id:`B${String(i + 1).padStart(3, "0")}`, name:`كتاب تجريبي رقم ${i + 1} للصف الثالث الثانوي`, publisher:"QA", category:"كتب دراسية", barcode:`QA${100000 + i}`, cost:50, price:100 + i, stock:500, reservedStock:0, reorder:2, supplierId:"S001", owned:true }));
const db = {
  version:4, meta:{ dataRevision:0 }, users, books,
  customers:[], suppliers:[{ id:"S001", name:"مورد", phone:"01010000001", balance:0 }],
  shippingCompanies:[{ id:"SC-001", name:"البريد المصري", active:true }], cashAccounts:[{ id:"CA-001", name:"الخزينة", openingBalance:0, active:true }],
  settings:{ companyName:"QA", tracking:{ enabled:false }, permissions:{ roles:{}, users:{} } },
  sales:[], purchases:[], shipments:[], cash:[], receipts:[], onlineOrders:[], orderPayments:[], stockMovements:[], inventoryBatches:[], returns:[], audit:[],
  expenses:[], otherIncome:[], orderCollections:[], carrierSettlements:[]
};
// Grow with record shapes like the real ones until the file reaches the target size.
for (let n = 1; JSON.stringify(db).length < targetBytes; n += 1) {
  const id = String(n).padStart(5, "0"), phone = `010${String(10000000 + n).slice(-8)}`, when = new Date(Date.UTC(2026, 0, 1) + n * 3600000).toISOString();
  const lines = [{ bookId:books[n % 120].id, qty:1 + (n % 3), price:books[n % 120].price, discount:0, discountType:"percent", lineTotal:books[n % 120].price }, { bookId:books[(n * 7) % 120].id, qty:1, price:120, discount:5, discountType:"percent", lineTotal:114 }];
  db.customers.push({ id:`C${id}`, name:`عميل تجريبي ${n}`, phone, governorate:"القاهرة", city:"مدينة نصر", address:`شارع تجريبي ${n}`, balance:0, createdAt:when });
  db.onlineOrders.push({ id:`ORD-${id}`, date:when.slice(0, 10), customerId:`C${id}`, customerName:`عميل تجريبي ${n}`, phone, governorate:"القاهرة", city:"مدينة نصر", address:`شارع تجريبي ${n}`, status:"تم التسليم", workflowStage:"delivered", lines, total:400, shippingFee:35, paidAmount:400, notes:"", createdAt:when, updatedAt:when });
  db.sales.push({ id:`INV-${id}`, date:when.slice(0, 10), customerId:`C${id}`, onlineOrderId:`ORD-${id}`, lines, total:400, paid:400, remaining:0, status:"مدفوعة", createdAt:when });
  db.shipments.push({ id:`SH-${id}`, onlineOrderId:`ORD-${id}`, saleId:`INV-${id}`, company:"البريد المصري", tracking:`EG${100000000 + n}EG`, status:"تم التسليم", history:[{ at:when, status:"تم الشحن" }, { at:when, status:"تم التسليم" }], createdAt:when });
  db.audit.push({ id:`AUD-${id}`, date:when, action:"إنشاء فاتورة", entity:"المبيعات", entityId:`INV-${id}`, user:"مالك النظام", username:"owner", role:"مالك", details:`فاتورة للطلب ORD-${id}` });
}

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ms = start => Number(process.hrtime.bigint() - start) / 1e6;

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "maktabaa-bench-"));
  fs.cpSync(path.join(ROOT, "app"), path.join(temp, "app"), { recursive:true });
  fs.copyFileSync(path.join(ROOT, "server-node.js"), path.join(temp, "server-node.js"));
  fs.mkdirSync(path.join(temp, "data"));
  const raw = JSON.stringify(db);
  fs.writeFileSync(path.join(temp, "data", "database.json"), raw);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server-node.js"], { cwd:temp, env:{ ...process.env, HOST:"127.0.0.1", PORT:String(port), TRACKING_RPA_ENABLED:"false" }, stdio:"ignore" });
  try {
    for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const { token } = await (await fetch(`${base}/api/login`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ username:"owner", password:PASSWORD }) })).json();
    const headers = { "X-Session-Token":token };
    const result = { sizeBytes:raw.length, gzipBytes:zlib.gzipSync(raw).length, records:{ orders:db.onlineOrders.length, sales:db.sales.length, customers:db.customers.length }, runs:[] };
    for (let run = 0; run < runs; run += 1) {
      let start = process.hrtime.bigint();
      const response = await fetch(`${base}/api/db`, { headers });
      const current = await response.json();
      const get = ms(start);
      current.books[0].shelf = `رف ${run}`;
      start = process.hrtime.bigint();
      const body = JSON.stringify(current);
      const stringify = ms(start);
      const { revision } = await (await fetch(`${base}/api/live-revision`, { headers })).json();
      start = process.hrtime.bigint();
      const put = await fetch(`${base}/api/db`, { method:"PUT", headers:{ ...headers, "Content-Type":"application/json", "If-Match":revision }, body });
      await put.json();
      result.runs.push({ getMs:Math.round(get), stringifyMs:Math.round(stringify), putMs:Math.round(ms(start)), putStatus:put.status });
    }
    result.median = { getMs:median(result.runs.map(r => r.getMs)), stringifyMs:median(result.runs.map(r => r.stringifyMs)), putMs:median(result.runs.map(r => r.putMs)) };
    // Transfer time of the body alone at typical connection speeds (megabits per second), without and with gzip.
    result.transferSeconds = Object.fromEntries([2, 5, 10, 20, 50].map(mbps => [`${mbps}Mbps`, { raw:+(raw.length * 8 / (mbps * 1e6)).toFixed(2), gzip:+(result.gzipBytes * 8 / (mbps * 1e6)).toFixed(2) }]));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    child.kill();
    fs.rmSync(temp, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exit(1); });
