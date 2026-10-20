#!/usr/bin/env node
"use strict";

// Builds a synthetic QA database (no real customers, orders or prices) for running scripts/test-*.js on a machine
// that does not have the developer's ignored local data/database.json. Several tests read that file and assume the
// shape of a database that has been used by the app: default staff accounts, books with stock, finance arrays,
// tracking/notification arrays, and the opening-balance inventory batch migration.
//
// Usage: node scripts/qa-create-fixture.js [root] [--force]
//   root defaults to this repository; the fixture is written to <root>/data/database.json.
//   An existing database is never replaced unless --force is given.

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const args = process.argv.slice(2);
const force = args.includes("--force");
const root = path.resolve(args.find(arg => arg !== "--force") || path.join(__dirname, ".."));
const dbPath = path.join(root, "data", "database.json");
const DEFAULT_PASSWORD = "DotCom@2026"; // default accounts only exist in a fresh QA database

if (fs.existsSync(dbPath) && !force) {
  console.error(`Refusing to replace ${dbPath}. Pass --force to overwrite this QA database.`);
  process.exit(1);
}

// The default staff accounts are the server's own (same hashes, so every test logs in as in a fresh install).
const serverSource = fs.readFileSync(path.join(root, "server-node.js"), "utf8");
const usersLiteral = serverSource.match(/const defaultUsers = (\[[\s\S]*?\n\]);/);
if (!usersLiteral) throw new Error("defaultUsers not found in server-node.js");
const users = new Function(`return ${usersLiteral[1]};`)();

const DEFAULT_EXPENSE_TYPES = ["تكلفة شحن البريد المصري","عمولة تحصيل البريد المصري","تكلفة مرتجع","تغليف وأكياس","إعلانات وتسويق","رواتب وأجور","إيجار","اتصالات وإنترنت","استضافة وبرامج","أدوات مكتبية","صيانة","نقل ومواصلات","مصروفات بنكية","مصروفات أخرى"];
const DEFAULT_INCOME_TYPES = ["تعويض من شركة شحن","عمولة من مورد","خدمات إضافية","بيع مواد أو كراتين","إيراد متنوع"];

const books = [1, 2, 3, 4, 5].map(i => ({
  id: `B00${i}`, name: `كتاب اختبار ${i}`, publisher: "QA", category: "كتب دراسية", shelf: `A-0${i}`,
  barcode: `QA10000${i}`, extraBarcode: "", cost: 50, price: 100, stock: 20, reservedStock: 0, reorder: 2,
  supplierId: "S001", owned: true, discount: 0, discountType: "percent"
}));

const db = {
  version: 4, meta: { dataRevision: 0 }, users, books,
  customers: [
    { id: "C001", name: "عميل نقدي", phone: "", balance: 0 },
    { id: "C002", name: "عميل QA", phone: "01000000002", governorate: "القاهرة", city: "مدينة نصر", address: "شارع QA", balance: 0 }
  ],
  suppliers: [{ id: "S001", name: "مورد QA", phone: "01010000001", balance: 0 }],
  shippingCompanies: [{ id: "SC-001", name: "البريد المصري", active: true }, { id: "SC-002", name: "بوسطة", active: true }],
  cashAccounts: [{ id: "CA-001", name: "الخزينة الرئيسية", openingBalance: 0, active: true }, { id: "CA-002", name: "InstaPay", openingBalance: 0, active: true }],
  settings: { companyName: "QA", tracking: { enabled: false }, permissions: { roles: {}, users: {} } },
  sales: [], purchases: [], shipments: [], cash: [], receipts: [], onlineOrders: [], orderPayments: [],
  stockMovements: [], inventoryBatches: [], returns: [], audit: [],
  expenses: [], otherIncome: [], orderCollections: [], carrierSettlements: [],
  expenseTypes: DEFAULT_EXPENSE_TYPES.map((name, index) => ({ id: `ET-${String(index + 1).padStart(3, "0")}`, name, active: true })),
  incomeTypes: DEFAULT_INCOME_TYPES.map((name, index) => ({ id: `IT-${String(index + 1).padStart(3, "0")}`, name, active: true }))
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

(async () => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  // One no-op save through the real server adds the arrays and settings the server keeps for every saved database.
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server-node.js"], { cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TRACKING_RPA_ENABLED: "false" }, stdio: "ignore" });
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const login = await (await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "owner", password: DEFAULT_PASSWORD }) })).json();
    if (!login.token) throw new Error("QA owner login failed");
    const headers = { "X-Session-Token": login.token };
    const current = await (await fetch(`${base}/api/db`, { headers })).json();
    const { revision } = await (await fetch(`${base}/api/live-revision`, { headers })).json();
    const saved = await fetch(`${base}/api/db`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json", "If-Match": revision }, body: JSON.stringify(current) });
    if (!saved.ok) throw new Error(`QA fixture save failed with ${saved.status}`);
  } finally {
    child.kill();
  }

  // Real databases carry the opening-balance batch migration marker; apply the repository's own migration.
  execFileSync(process.execPath, [path.join(root, "scripts", "migrate-inventory-batches.js")], { cwd: root, stdio: "ignore" });
  console.log(`QA fixture written: ${dbPath}`);
})().catch(error => { console.error(error.message); process.exit(1); });
