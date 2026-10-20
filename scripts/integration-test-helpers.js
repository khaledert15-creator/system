'use strict';
// Shared helpers for the Store/Chatwood integration tests (test-integration-*.js, test-website-order-*.js,
// test-chatwood-panel.js). Everything runs on loopback: a scratch copy of the System and a mock Store HTTP server.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), http = require('node:http'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const IntegrationAuth = require('../app/integration-auth.js');

const SECRET = 'integration-test-secret-0123456789abcdef';
const PASSWORD = 'test-password';
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
async function until(fn, label = 'condition') { for (let i = 0; i < 200; i++) { if (await fn()) return; await sleep(25); } throw new Error(`Timed out waiting for ${label}`); }

function user(id, username, role) {
  const salt = `salt-${username}`;
  return { id, username, name:username, role, active:true, salt, passwordHash:crypto.createHash('sha256').update(`${salt}:${PASSWORD}`).digest('hex') };
}

function fixtureDb(overrides = {}) {
  const book = (id, extra = {}) => ({ id, name:`كتاب ${id}`, barcode:`BC-${id}`, extraBarcode:'', sku:`SKU-${id}`, price:100, cost:60, purchaseListPrice:80, lastPurchasePrice:60, supplierId:'S001', stock:5, reservedStock:0, countHoldQty:0, allowPreorder:false, updatedAt:'2026-10-01T00:00:00.000Z', ...extra });
  return {
    version:4, meta:{ dataRevision:0 },
    users:[user('U1','owner','مالك'), user('U2','manager','مدير'), user('U3','cashier','كاشير'), user('U4','warehouse','مخزن'), user('U5','shipping','شحن'), user('U6','accountant','محاسب')],
    settings:{ tracking:{ enabled:false }, permissions:{ roles:{}, users:{} } },
    books:[book('B0001'), book('B0002', { price:50, stock:1 }), book('B0003', { stock:0, allowPreorder:true }), book('B0004', { stock:0, allowPreorder:false }), book('B0099', { deletedAt:'2026-10-02T00:00:00.000Z' })],
    customers:[], suppliers:[{ id:'S001', name:'مورد', phone:'01010000001', balance:0 }],
    shippingCompanies:[{ id:'SC-001', name:'البريد المصري', active:true }, { id:'SC-002', name:'بوسطة', active:true }],
    cashAccounts:[{ id:'CA-001', name:'الخزينة الرئيسية', openingBalance:0, active:true }, { id:'CA-003', name:'InstaPay', openingBalance:0, active:true }],
    sales:[], purchases:[], shipments:[], cash:[], receipts:[], onlineOrders:[], orderPayments:[], stockMovements:[], inventoryBatches:[], returns:[], audit:[],
    ...overrides
  };
}

function workspace(name) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), name));
  fs.cpSync(path.join(ROOT, 'app'), path.join(temp, 'app'), { recursive:true });
  fs.copyFileSync(path.join(ROOT, 'server-node.js'), path.join(temp, 'server-node.js'));
  fs.mkdirSync(path.join(temp, 'data'));
  return temp;
}

async function startSystem({ db = fixtureDb(), env = {}, name = 'integration-' } = {}) {
  const temp = workspace(name), dbFile = path.join(temp, 'data/database.json');
  fs.writeFileSync(dbFile, JSON.stringify(db));
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const childEnv = { ...process.env, PORT:String(port), HOST:'127.0.0.1', TRACKING_RPA_ENABLED:'false', ...env };
  for (const key of ['TRACKING_RPA_BASE_URL', 'TRACKING_RPA_SHARED_SECRET', 'FACTORY_RESET_EXECUTION_ENABLED']) delete childEnv[key];
  for (const [key, value] of Object.entries(childEnv)) if (value === undefined) delete childEnv[key];
  let output = '';
  const child = spawn(process.execPath, ['server-node.js'], { cwd:temp, env:childEnv, stdio:['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'System server');
  const tokens = {};
  const system = {
    base, port, temp, dbFile, child, output:() => output,
    readDb:() => JSON.parse(fs.readFileSync(dbFile, 'utf8')),
    async login(username = 'owner') {
      if (tokens[username]) return tokens[username];
      const response = await fetch(base + '/api/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ username, password:PASSWORD }) });
      const body = await response.json();
      if (!body.token) throw new Error(`login failed for ${username}: ${JSON.stringify(body)}`);
      return (tokens[username] = body.token);
    },
    async api(route, { username = 'owner', method = 'GET', body, headers = {}, token } = {}) {
      const sessionToken = token === undefined ? await system.login(username) : token;
      const response = await fetch(base + route, { method, headers:{ ...(body !== undefined ? { 'Content-Type':'application/json' } : {}), ...(sessionToken ? { 'X-Session-Token':sessionToken } : {}), ...headers }, body:body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status:response.status, body:json, text, headers:response.headers };
    },
    stop() { child.kill(); fs.rmSync(temp, { recursive:true, force:true }); }
  };
  return system;
}

// Mock Store integration API (§3). It verifies the System's signatures with the real verifier.
async function startMockStore({ secret = SECRET } = {}) {
  const state = { orders:new Map(), requests:[], down:false, delayMs:0, salesLinkStatus:200, conversationResult:null };
  const nonces = IntegrationAuth.createNonceCache();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://store');
    const verified = IntegrationAuth.verifyRequest({ headers:req.headers, method:req.method, pathWithQuery:req.url, body:raw, secrets:[secret], acceptedKeyIds:['system-v1'], nonceCache:nonces });
    state.requests.push({ method:req.method, path:url.pathname, query:Object.fromEntries(url.searchParams), body:raw ? JSON.parse(raw) : null, verified:verified.ok, keyId:req.headers['x-maktabaa-key-id'] });
    const json = (status, value) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(value)); };
    if (state.delayMs) await sleep(state.delayMs);
    if (state.down) { res.writeHead(503, { 'Content-Type':'text/plain' }); res.end('down'); return; }
    if (!verified.ok) return json(401, { ok:false, code:'INTEGRATION_AUTH_FAILED' });
    const match = url.pathname.match(/^\/api\/integration\/v1\/orders(?:\/([^/]+))?(?:\/(sales-link|conversation))?$/);
    if (!match) return json(404, { ok:false, code:'NOT_FOUND' });
    const [, number, action] = match;
    if (!number && req.method === 'GET') {
      const phone = url.searchParams.get('phone');
      let orders = [...state.orders.values()];
      if (url.searchParams.get('state') !== 'all') orders = orders.filter(order => order.status === 'awaiting_confirmation' && !order.salesOrderId && !order.archived);
      if (phone) orders = orders.filter(order => order.customer.mobile === phone || order.customer.altMobile === phone);
      return json(200, { ok:true, orders });
    }
    const order = state.orders.get(number);
    if (!order) return json(404, { ok:false, code:'ORDER_NOT_FOUND' });
    if (!action && req.method === 'GET') return json(200, { ok:true, order });
    const body = raw ? JSON.parse(raw) : {};
    if (action === 'sales-link' && req.method === 'POST') {
      if (state.salesLinkStatus !== 200) return json(state.salesLinkStatus, { ok:false, code:'FAILED' });
      if (order.salesOrderId === body.salesOrderId) return json(200, { ok:true, existing:true });
      if (order.salesOrderId) return json(409, { ok:false, code:'ALREADY_LINKED' });
      Object.assign(order, { salesOrderId:body.salesOrderId, integrationId:order.integrationId || body.integrationId, status:'confirmed' });
      return json(200, { ok:true, existing:false });
    }
    if (action === 'conversation' && req.method === 'POST') {
      if (state.conversationResult) return json(state.conversationResult.status, state.conversationResult.body);
      if (![order.customer.mobile, order.customer.altMobile].includes(body.contactPhone)) return json(409, { ok:false, code:'PHONE_MISMATCH', message:'phone mismatch' });
      if (order.chatwootConversationId && order.chatwootConversationId !== body.conversationId) return json(409, { ok:false, code:'CONVERSATION_ALREADY_LINKED', message:'linked' });
      const existing = order.chatwootConversationId === body.conversationId;
      order.chatwootConversationId = body.conversationId;
      return json(200, { ok:true, existing });
    }
    return json(404, { ok:false, code:'NOT_FOUND' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state, server, close:() => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

let orderSequence = 10000;
function storeOrder(overrides = {}) {
  orderSequence += 1;
  const items = overrides.items || [{ productId:1, externalBookId:'B0001', nameAr:'كتاب B0001', quantity:1, unitPrice:100, subtotal:100, availabilityAtOrder:'available', preorderQuantity:0 }];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const shippingCost = overrides.shippingCost ?? 35, couponDiscount = overrides.couponDiscount ?? 0;
  return {
    id:orderSequence, orderNumber:`MK261020-${orderSequence}`, integrationId:crypto.randomUUID(), status:'awaiting_confirmation', contactStatus:'whatsapp_opened', paymentStatus:'pending',
    archived:false, salesOrderId:null, chatwootConversationId:null,
    customer:{ name:'عميل الموقع', mobile:'01001234567', altMobile:null },
    address:{ governorate:'القاهرة', city:'مدينة نصر', detailedAddress:'شارع الاختبار 5', landmark:null },
    notes:{ delivery:null, order:null }, subtotal, couponDiscount, shippingCost, total:subtotal - couponDiscount + shippingCost,
    depositRequired:100, preorderConsent:false, splitShipmentPreference:'single', createdAt:new Date().toISOString(),
    ...overrides, items
  };
}

async function signedFetch(base, pathWithQuery, { method = 'GET', body = '', secret = SECRET, keyId = 'store-v1', now = Date.now(), nonce, headers = {} } = {}) {
  const signed = IntegrationAuth.signedHeaders({ secret, keyId, method, pathWithQuery, body, now, nonce });
  return fetch(base + pathWithQuery, { method, headers:{ ...signed, ...headers }, body:body || undefined });
}

function integrationEnv(store, extra = {}) {
  return { INTEGRATION_SHARED_SECRET:SECRET, STORE_INTEGRATION_BASE_URL:store ? store.base : undefined, ...extra };
}

// Each call gets its own sender phone and reference so unrelated approvals never look like duplicate transfers.
let senderSequence = 10000000;
const deposit = (extra = {}) => ({ amount:100, receiptMethod:'InstaPay', cashAccountId:'CA-003', senderPhone:`012${senderSequence++}`, senderName:'محوّل', reference:`TX-${crypto.randomUUID().slice(0, 8)}`, receivedConfirmed:true, ...extra });

module.exports = { SECRET, PASSWORD, sleep, until, freePort, fixtureDb, startSystem, startMockStore, storeOrder, signedFetch, integrationEnv, deposit, IntegrationAuth };
