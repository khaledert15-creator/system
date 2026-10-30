'use strict';
// System review 2026-10-30, phase 1: money is paid out once and balances follow collections; a save from the page can
// only change what its user's screens allow; values from the data cannot run as script; the log names the real user.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');
const Refunds = require('../app/order-refund.js'), Returns = require('../app/returns.js');

let n = 0;
const uuid = () => `u${++n}`;
const actor = { name:'owner', username:'owner', uuid };

function noDoubleRefund() {
  const base = () => ({ customers:[{ id:'C1', name:'c', balance:0 }], books:[{ id:'B1', name:'b', stock:0, price:100, cost:50 }],
    sales:[{ id:'INV-1', customerId:'C1', date:'2026-10-01', total:100, paid:100, remaining:0, status:'مكتملة', lines:[{ bookId:'B1', qty:1, price:100, total:100, totalSellingPrice:100 }] }],
    cash:[], cashAccounts:[{ id:'CA-1', name:'الخزينة', active:true }], orderPayments:[], orderRefunds:[], returns:[], stockMovements:[], inventoryBatches:[], shipments:[], onlineOrders:[] });
  let db = base();
  const preview = Refunds.cancellationPreview(db, { invoiceId:'INV-1' });
  Refunds.createSettlement(db, { invoiceId:'INV-1' }, { settlementType:'cash_refund', amount:100, paymentId:preview.payments[0].id, cashAccountId:'CA-1', operationKey:'k1' }, actor, uuid);
  const { record } = Returns.createSaleReturn(db, { customerId:'C1', invoiceId:'INV-1', lines:[{ documentId:'INV-1', lineIndex:0, qty:1 }], settlement:'cash', account:'الخزينة', reason:'x', operationKey:'k2' }, actor);
  assert.equal(record.customerDue, 0, 'refunded on cancellation, so the return pays nothing more');
  assert.equal(db.cash.filter(row => row.type === 'صرف').reduce((sum, row) => sum + row.amount, 0), 100);
  // The other way round: a cash return first, then the cancellation screen finds nothing left to refund.
  db = base();
  db.orderPayments = [{ id:'PAY-1', invoiceId:'INV-1', customerId:'C1', amount:100, status:'confirmed' }];
  Returns.createSaleReturn(db, { customerId:'C1', invoiceId:'INV-1', lines:[{ documentId:'INV-1', lineIndex:0, qty:1 }], settlement:'cash', account:'الخزينة', reason:'x', operationKey:'k3' }, actor);
  assert.equal(Refunds.cancellationPreview(db, { invoiceId:'INV-1' }).outstanding, 0);
  console.log('PASS a customer is refunded once, whether by cancellation or by a return');
}

function collectionDb() {
  const db = H.fixtureDb();
  db.customers = [{ id:'C1', name:'عميل', phone:'01011111111', balance:300 }];
  db.onlineOrders = [{ id:'ORD-1', customerId:'C1', total:300, status:'تم الشحن', workflowStage:'shipped', saleId:'INV-1', shipmentId:'SH-1' }, { id:'ORD-2', customerId:'C1', total:100, status:'مرتجع', workflowStage:'returned', saleId:'INV-2', shipmentId:'SH-2' }];
  db.sales = [{ id:'INV-1', customerId:'C1', onlineOrderId:'ORD-1', total:300, paid:0, remaining:300, status:'معتمدة', lines:[] }, { id:'INV-2', customerId:'C1', onlineOrderId:'ORD-2', total:100, paid:0, remaining:100, status:'معتمدة', lines:[] }];
  db.shipments = [
    { id:'SH-1', onlineOrderId:'ORD-1', invoiceId:'INV-1', trackingNumber:'EG100', carrier:'بوسطة', company:'بوسطة', status:'تم التسليم', shippingStatus:'delivered', normalizedStatus:'delivered', collectionAmount:300 },
    { id:'SH-2', onlineOrderId:'ORD-2', invoiceId:'INV-2', trackingNumber:'EG200', carrier:'بوسطة', company:'بوسطة', status:'مرتجع', shippingStatus:'returned', normalizedStatus:'returned', collectionAmount:100 }
  ];
  return db;
}

async function collectionsMoveBalances() {
  const system = await H.startSystem({ db:collectionDb(), name:'fin-col-' });
  try {
    const db = () => system.readDb(), customer = () => db().customers[0], sale = id => db().sales.find(item => item.id === id);
    let r = await system.api('/api/finance/order-collections', { method:'POST', body:{ trackingNumber:'EG100', amount:300, registrationType:'collected_by_carrier' } });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal(sale('INV-1').remaining, 0); assert.equal(customer().balance, 0, 'the collection lowers what the customer owes');
    const id = r.body.collection.id;
    r = await system.api(`/api/finance/order-collections/${id}/reverse`, { method:'POST', body:{ reason:'غلط' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(sale('INV-1').paid, 0); assert.equal(sale('INV-1').remaining, 300); assert.equal(customer().balance, 300, 'reversal puts invoice and balance back');
    assert.equal(db().onlineOrders[0].paidAmount, 0);
    r = await system.api('/api/finance/order-collections', { method:'POST', body:{ trackingNumber:'EG100', amount:300, registrationType:'collected_by_carrier' } });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal(sale('INV-1').paid, 300, 'collecting again does not count twice');
    r = await system.api('/api/finance/order-collections', { method:'POST', body:{ trackingNumber:'EG200', amount:100, registrationType:'collected_by_carrier' } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'SHIPMENT_NOT_COLLECTABLE');
  } finally { system.stop(); }
  console.log('PASS collections lower the customer balance, reversals undo all of it, returned parcels are not collected');
}

async function balanceRepairTool() {
  const db = collectionDb();
  // An older collection: the invoice was paid, the balance was not lowered.
  db.sales[0].paid = 300; db.sales[0].remaining = 0;
  db.orderCollections = [{ id:'COL-001', sourceKey:'order-collection:SH-1', shipmentId:'SH-1', trackingNumber:'EG100', invoiceId:'INV-1', onlineOrderId:'ORD-1', amount:300, status:'collected_by_carrier', registrationType:'collected_by_carrier' }];
  const system = await H.startSystem({ db, name:'fin-repair-' });
  try {
    let r = await system.api('/api/admin/customer-balance-repair', { username:'cashier' });
    assert.equal(r.status, 403);
    r = await system.api('/api/admin/customer-balance-repair');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.rows.map(row => [row.customerId, row.balance, row.change, row.newBalance]), [['C1', 300, 300, 0]]);
    assert.equal(system.readDb().customers[0].balance, 300, 'the preview changes nothing');
    r = await system.api('/api/admin/customer-balance-repair', { method:'POST', body:{ revision:r.body.revision } });
    assert.equal(r.status, 200, r.text);
    assert.equal(system.readDb().customers[0].balance, 0);
    assert.equal((await system.api('/api/admin/customer-balance-repair')).body.rows.length, 0, 'applied once');
    r = await system.api('/api/finance/order-collections/COL-001/reverse', { method:'POST', body:{ reason:'x' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(system.readDb().customers[0].balance, 300, 'a repaired collection reverses cleanly');
  } finally { system.stop(); }
  console.log('PASS customer balances are previewed, corrected once and stay reversible');
}

async function saveWritesFollowScreens() {
  const db = H.fixtureDb({ customers:[{ id:'C1', name:'عميل', phone:'01011111111', balance:50 }],
    sales:[{ id:'INV-1', customerId:'C1', total:100, paid:50, remaining:50, status:'معتمدة', lines:[{ bookId:'B0001', qty:1, price:100 }] }],
    cash:[{ id:'TX-1', type:'قبض', amount:50, account:'الخزينة الرئيسية', category:'مبيعات', note:'فاتورة INV-1', locked:true, date:'2026-10-01' }] });
  const system = await H.startSystem({ db, name:'fin-writes-' });
  try {
    const save = async (username, change) => {
      const page = await system.api('/api/db', { username });
      change(page.body);
      return system.api('/api/db', { username, method:'PUT', body:page.body, headers:{ 'If-Match':page.headers.get('x-db-revision') } });
    };
    let r = await save('shipping', page => { page.customers[0].balance = 0; });
    assert.equal(r.status, 403, r.text); assert.equal(r.body.code, 'WRITE_PERMISSION_DENIED');
    r = await save('cashier', page => { page.sales[0].total = 1; });
    assert.equal(r.status, 403, r.text);
    r = await save('cashier', page => { page.customers = []; });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'RECORD_DELETE_FORBIDDEN');
    r = await save('warehouse', page => { page.books[0].price = -5; });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'INVALID_AMOUNT');
    r = await save('cashier', page => { page.settings.storeName = 'x'; });
    assert.equal(r.status, 200, r.text); assert.equal(system.readDb().settings.storeName, undefined, 'settings stay as the server has them');
    r = await save('accountant', page => { page.cash[0].amount = 999999; page.expenses = [{ id:'EXP-9', amount:5, status:'مسجل', expenseType:'x' }]; });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'CASH_DOCUMENT_PROTECTED', 'a sale\'s cash row is never rewritten');
    // A cashier's POS sale with its cash row is a normal save.
    r = await save('cashier', page => {
      page.sales.push({ id:'INV-2', customerId:'C1', total:100, paid:100, remaining:0, status:'معتمدة', date:'2026-10-30', lines:[{ bookId:'B0001', qty:1, price:100 }] });
      page.cash.push({ id:'TX-2', type:'قبض', amount:100, account:'الخزينة الرئيسية', category:'مبيعات', note:'فاتورة INV-2', locked:true, date:'2026-10-30' });
      page.stockMovements.push({ id:'MOV-S2', bookId:'B0001', type:'بيع', quantity:-1, before:5, after:4, documentId:'INV-2' });
      page.books[0].stock = 4;
      page.audit.push({ id:'x', action:'إنشاء فاتورة', username:'owner', user:'Owner' });
    });
    assert.equal(r.status, 200, r.text);
    const row = system.readDb().audit.at(-1);
    assert.equal(row.username, 'cashier', 'the log names the real user'); assert.equal(row.claimedUser, 'owner');
    r = await save('cashier', page => { page.onlineOrders.push({ id:'ORD-1"><img src=x onerror=alert(1)>', status:'طلب جديد', lines:[] }); });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'INVALID_RECORD_ID');
    const html = await fetch(system.base + '/');
    assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  } finally { system.stop(); }
  console.log('PASS saves change only what the user\'s screens allow; ids cannot carry script; the log is stamped');
}

async function loginLockoutIsPerAddress() {
  const system = await H.startSystem({ name:'fin-login-' });
  try {
    const login = (password, ip) => fetch(system.base + '/api/login', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Forwarded-For':ip }, body:JSON.stringify({ username:'owner', password }) });
    for (let i = 0; i < 10; i++) await login('wrong', '203.0.113.9');
    assert.equal((await login('test-password', '203.0.113.9')).status, 429, 'the guessing address is held back');
    assert.equal((await login('test-password', '198.51.100.7')).status, 200, 'the owner still logs in from elsewhere');
  } finally { system.stop(); }
  console.log('PASS wrong passwords from one address cannot lock the owner out');
}

(async () => {
  noDoubleRefund();
  await collectionsMoveBalances();
  await balanceRepairTool();
  await saveWritesFollowScreens();
  await loginLockoutIsPerAddress();
})().catch(error => { console.error(error); process.exitCode = 1; });
