#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_EXPENSE_TYPES = ["تكلفة شحن البريد المصري","عمولة تحصيل البريد المصري","تكلفة مرتجع","تغليف وأكياس","إعلانات وتسويق","رواتب وأجور","إيجار","اتصالات وإنترنت","استضافة وبرامج","أدوات مكتبية","صيانة","نقل ومواصلات","مصروفات بنكية","مصروفات أخرى"];
const DEFAULT_INCOME_TYPES = ["تعويض من شركة شحن","عمولة من مورد","خدمات إضافية","بيع مواد أو كراتين","إيراد متنوع"];
const FINANCE_KEYS = ["expenses","otherIncome","expenseTypes","incomeTypes","orderCollections","carrierSettlements"];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`QA server exited with ${child.exitCode}`);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("QA server did not start");
}

async function request(base, route, { token, method = "GET", body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { "X-Session-Token": token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function runtimeMaterializedPayload(source) {
  const payload = structuredClone(source);
  payload.books = (payload.books || []).map(book => ({ ...book, reservedStock:Number(book.reservedStock || 0) }));
  payload.expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  payload.otherIncome = Array.isArray(payload.otherIncome) ? payload.otherIncome : [];
  payload.orderCollections = Array.isArray(payload.orderCollections) ? payload.orderCollections : [];
  payload.carrierSettlements = Array.isArray(payload.carrierSettlements) ? payload.carrierSettlements : [];
  payload.expenseTypes = Array.isArray(payload.expenseTypes) ? payload.expenseTypes : DEFAULT_EXPENSE_TYPES.map((name,index)=>({ id:`ET-${String(index+1).padStart(3,"0")}`,name,active:true }));
  payload.incomeTypes = Array.isArray(payload.incomeTypes) ? payload.incomeTypes : DEFAULT_INCOME_TYPES.map((name,index)=>({ id:`IT-${String(index+1).padStart(3,"0")}`,name,active:true }));
  return payload;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "maktabaa-lazy-defaults-"));
  fs.cpSync(path.join(ROOT, "app"), path.join(temp, "app"), { recursive:true });
  fs.copyFileSync(path.join(ROOT, "server-node.js"), path.join(temp, "server-node.js"));
  fs.mkdirSync(path.join(temp, "data"), { recursive:true });
  const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "database.json"), "utf8"));
  legacy.books.forEach(book => delete book.reservedStock);
  FINANCE_KEYS.forEach(key => delete legacy[key]);
  delete legacy.orderPayments;
  legacy.onlineOrders.forEach(order => ["paymentPlan","paymentStatus","paidAmount","remainingAmount","amountDueAtDelivery","paymentReceiptId"].forEach(key => delete order[key]));
  const dbPath = path.join(temp, "data", "database.json");
  fs.writeFileSync(dbPath, JSON.stringify(legacy, null, 2));
  const initialHash = sha(fs.readFileSync(dbPath));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server-node.js"], { cwd:temp, env:{ ...process.env, HOST:"127.0.0.1", PORT:String(port), TRACKING_RPA_ENABLED:"false" }, stdio:["ignore","ignore","pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await waitForServer(base, child);
    const login = await request(base, "/api/login", { method:"POST", body:{ username:"owner", password:process.env.DOTCOM_TEST_PASSWORD || "DotCom@2026" } });
    assert(login.status === 200, "legacy QA owner login");
    const token = login.body.token;

    let db = (await request(base, "/api/db", { token })).body;
    assert(db.books.every(book => !hasOwn(book, "reservedStock")), "load and read do not materialize reservedStock");
    assert(FINANCE_KEYS.every(key => !hasOwn(db, key)), "load and read do not materialize finance arrays");
    assert(!hasOwn(db,"orderPayments")&&db.onlineOrders.every(order=>!hasOwn(order,"paidAmount")&&!hasOwn(order,"paymentStatus")),"load and read do not materialize payment fields");

    const noOp = runtimeMaterializedPayload(db);
    let result = await request(base, "/api/db", { token, method:"PUT", body:noOp });
    assert(result.status === 200, "no-op general save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.books.every(book => !hasOwn(book, "reservedStock")), "no-op save strips runtime-only reservedStock defaults");
    assert(FINANCE_KEYS.every(key => !hasOwn(db, key)), "no-op save strips runtime-only finance defaults");
    assert(!hasOwn(db,"orderPayments")&&db.onlineOrders.every(order=>!hasOwn(order,"paidAmount")&&!hasOwn(order,"paymentStatus")),"no-op save does not materialize payment fields");
    assert(sha(fs.readFileSync(dbPath)) === initialHash, "no-op save preserves database bytes and SHA-256");

    const customerId = db.customers[0].id;
    const oldName = db.customers[0].name;
    const unrelated = runtimeMaterializedPayload(db);
    unrelated.customers.find(item => item.id === customerId).name = `${oldName} QA`;
    result = await request(base, "/api/db", { token, method:"PUT", body:unrelated });
    assert(result.status === 200, "unrelated customer save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.customers.find(item => item.id === customerId).name === `${oldName} QA`, "unrelated customer field is the intended change");
    assert(db.books.every(book => !hasOwn(book, "reservedStock")), "unrelated save does not materialize reservedStock");
    assert(FINANCE_KEYS.every(key => !hasOwn(db, key)), "unrelated save does not materialize finance arrays");
    assert(!hasOwn(db,"orderPayments")&&db.onlineOrders.every(order=>!hasOwn(order,"paidAmount")&&!hasOwn(order,"paymentStatus")),"unrelated save does not materialize payment fields");

    const book = db.books.find(item => Number(item.stock || 0) >= 3);
    assert(Boolean(book), "legacy reservation fixture has stock");
    const stamp = Date.now();
    const draft = await request(base, "/api/orders/quick", { token, method:"POST", body:{ phone:`010${String(stamp).slice(-8)}`, customerName:"عميل Lazy QA", governorate:"القاهرة", address:"QA", chatwootConversationId:`lazy-${stamp}`, lines:[{ bookId:book.id, qty:2 }] } });
    assert(draft.status === 201, "reservation first-use draft created");
    db = (await request(base, "/api/db", { token })).body;
    assert(!hasOwn(db.books.find(item => item.id === book.id), "reservedStock"), "draft does not create reservedStock");
    result = await request(base, `/api/orders/${draft.body.order.id}/confirm`, { token, method:"POST" });
    assert(result.status === 200, "reservation first-use confirm accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.books.find(item => item.id === book.id).reservedStock === 2, "confirm materializes reservedStock only for reserved product");
    assert(db.books.filter(item => item.id !== book.id).every(item => !hasOwn(item, "reservedStock")), "confirm leaves unrelated legacy products untouched");
    result = await request(base, `/api/orders/${draft.body.order.id}/cancel`, { token, method:"POST", body:{ reason:"Lazy QA" } });
    assert(result.status === 200, "reservation first-use cancel accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.books.find(item => item.id === book.id).reservedStock === 0, "cancel keeps used reservation field at zero");
    const afterUse = runtimeMaterializedPayload(db);
    afterUse.customers.find(item => item.id === customerId).name = oldName;
    result = await request(base, "/api/db", { token, method:"PUT", body:afterUse });
    assert(result.status === 200, "general save after reservation use accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(hasOwn(db.books.find(item => item.id === book.id), "reservedStock"), "existing reservedStock field is never removed");
    assert(db.books.filter(item => item.id !== book.id).every(item => !hasOwn(item, "reservedStock")), "later general save still leaves unused products untouched");

    let financePayload = runtimeMaterializedPayload(db);
    financePayload.expenses.push({ id:`EXP-LAZY-${stamp}`, date:"2026-07-29", expenseTypeId:"ET-001", expenseType:DEFAULT_EXPENSE_TYPES[0], amount:10, account:"الخزينة الرئيسية", status:"مسودة" });
    result = await request(base, "/api/db", { token, method:"PUT", body:financePayload });
    assert(result.status === 200, "first expense save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.expenses.length === 1 && Array.isArray(db.expenseTypes), "first expense materializes expense structures");
    assert(!hasOwn(db, "otherIncome") && !hasOwn(db, "incomeTypes") && !hasOwn(db, "orderCollections") && !hasOwn(db, "carrierSettlements"), "first expense leaves unrelated finance structures absent");

    financePayload = runtimeMaterializedPayload(db);
    financePayload.otherIncome.push({ id:`INC-LAZY-${stamp}`, date:"2026-07-29", incomeTypeId:"IT-001", incomeType:DEFAULT_INCOME_TYPES[0], amount:15, account:"الخزينة الرئيسية", status:"مسودة" });
    result = await request(base, "/api/db", { token, method:"PUT", body:financePayload });
    assert(result.status === 200, "first other income save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.otherIncome.length === 1 && Array.isArray(db.incomeTypes), "first other income materializes income structures");
    assert(!hasOwn(db, "orderCollections") && !hasOwn(db, "carrierSettlements"), "income first-use leaves collection and settlement absent");

    financePayload = runtimeMaterializedPayload(db);
    financePayload.orderCollections.push({ id:`COL-LAZY-${stamp}`, sourceKey:`lazy:${stamp}`, amount:20, status:"collected_by_carrier" });
    result = await request(base, "/api/db", { token, method:"PUT", body:financePayload });
    assert(result.status === 200, "first order collection save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.orderCollections.length === 1 && !hasOwn(db, "carrierSettlements"), "collection first-use materializes only collection");

    financePayload = runtimeMaterializedPayload(db);
    financePayload.carrierSettlements.push({ id:`SET-LAZY-${stamp}`, company:"شركة QA", status:"مسودة", lines:[] });
    result = await request(base, "/api/db", { token, method:"PUT", body:financePayload });
    assert(result.status === 200, "first carrier settlement save accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(db.carrierSettlements.length === 1, "settlement first-use materializes settlement");
    const keepExisting = runtimeMaterializedPayload(db);
    FINANCE_KEYS.forEach(key => { keepExisting[key] = []; });
    result = await request(base, "/api/db", { token, method:"PUT", body:keepExisting });
    assert(result.status === 200, "emptying already-materialized finance collections accepted");
    db = (await request(base, "/api/db", { token })).body;
    assert(FINANCE_KEYS.every(key => hasOwn(db, key)), "already-existing finance fields are never removed");

    console.log(JSON.stringify({
      productionRegression: "reproduced by runtimeMaterializedPayload before server pruning",
      noOpSha256: initialHash,
      reservationProduct:book.id,
      financeKeys:FINANCE_KEYS.filter(key => hasOwn(db, key))
    }, null, 2));
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve)).catch(() => {});
    fs.rmSync(temp, { recursive:true, force:true });
  }
})().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
