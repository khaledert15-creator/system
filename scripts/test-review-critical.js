'use strict';
// Fixes from the full system review (2026-10-31): orders and shipping, saves that bypass the screens' permissions,
// party vouchers, and the returns/exchange money rules. Each block reproduces the original problem.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const H = require('./integration-test-helpers.js');
const Returns = require('../app/returns.js');
const OrderRefusals = require('../app/order-refusal.js');
const pass = name => console.log(`PASS ${name}`);

// ---- Returns and exchanges (module level) ------------------------------------------------------------------------
let serial = 0;
const actor = { username: 'owner', name: 'مالك', uuid: () => `u-${++serial}` }, key = () => `k-${++serial}`;
function returnsDb() {
  return {
    customers: [{ id: 'C1', name: 'عميل', balance: 0 }], suppliers: [{ id: 'S1', name: 'مورد', balance: 400 }],
    books: [{ id: 'B1', name: 'كتاب 1', stock: 0, price: 100 }, { id: 'B2', name: 'كتاب 2', stock: 4, price: 100 }],
    inventoryBatches: [{ id: 'BAT-1', batchId: 'BAT-1', productId: 'B1', remainingQty: 0, unitCost: 50, purchaseDate: '2026-01-01' }, { id: 'BAT-2', batchId: 'BAT-2', productId: 'B2', remainingQty: 4, unitCost: 60, purchaseDate: '2026-01-01' }],
    sales: [
      { id: 'I1', customerId: 'C1', total: 100, paid: 100, remaining: 0, status: 'معتمدة', lines: [{ bookId: 'B1', qty: 1, price: 100, finalNet: 100, batchAllocations: [{ batchId: 'BAT-1', qty: 1, unitCost: 50 }] }] },
      { id: 'I2', customerId: 'C1', total: 200, paid: 200, remaining: 0, status: 'معتمدة', lines: [{ bookId: 'B2', qty: 2, price: 100, finalNet: 200, batchAllocations: [{ batchId: 'BAT-2', qty: 2, unitCost: 60 }] }] }],
    purchases: [{ id: 'P1', supplierId: 'S1', type: 'شراء', total: 400, paid: 0, remaining: 400, status: 'مستلمة', lines: [{ bookId: 'B2', qty: 4, cost: 100, finalNet: 400 }] }],
    cash: [], cashAccounts: [{ id: 'CA1', name: 'الخزينة الرئيسية', active: true }], returns: [], stockMovements: [], orderRefunds: []
  };
}
{
  const db = returnsDb();
  // The last copy of B1 comes back and leaves again as the replacement: the return can still be reversed.
  const r = Returns.createSaleReturn(db, { invoiceId: 'I1', lines: [{ documentId: 'I1', lineIndex: 0, qty: 1 }], replacements: [{ bookId: 'B1', qty: 1 }], settlement: 'cash', reason: 'استبدال', operationKey: key() }, actor).record;
  Returns.reverseReturn(db, r.id, { reason: 'غلط' }, actor);
  assert.equal(db.books[0].stock, 0); assert.equal(db.inventoryBatches[0].remainingQty, 0); assert.equal(db.customers[0].balance, 0);
  pass('an exchange for the same book (last copy) can be reversed');
}
{
  const db = returnsDb();
  Returns.createSaleReturn(db, { invoiceId: 'I2', lines: [{ documentId: 'I2', lineIndex: 0, qty: 1 }], settlement: 'customer-credit', reason: 'x', operationKey: key() }, actor);
  assert.equal(db.customers[0].balance, -100);
  Returns.createSaleReturn(db, { invoiceId: 'I2', lines: [{ documentId: 'I2', lineIndex: 0, qty: 1 }], settlement: 'debt-only', reason: 'x', operationKey: key() }, actor);
  assert.equal(db.customers[0].balance, -100, 'debt-only never raises the balance or wipes a credit');
  pass('«خصم من المديونية فقط» keeps the credit the customer already had');
}
{
  const db = returnsDb();
  assert.throws(() => Returns.createSaleReturn(db, { invoiceId: 'I2', lines: [{ documentId: 'I2', lineIndex: 0, qty: 1 }], settlement: 'cash', returnShippingDeduction: 'abc', reason: 'x', operationKey: key() }, actor), /أرقام/);
  assert.equal(db.sales[1].paid, 200);
  pass('a non-numeric shipping deduction is refused instead of corrupting the invoice');
}
{
  const db = returnsDb();
  const r = Returns.createPurchaseReturn(db, { supplierId: 'S1', lines: [{ documentId: 'P1', lineIndex: 0, qty: 2 }], settlement: 'cash', reason: 'x', operationKey: key() }, actor).record;
  assert.equal(db.purchases[0].remaining, 400, 'cash back from the supplier leaves the document debt alone');
  assert.equal(db.suppliers[0].balance, 400); assert.equal(db.cash.at(-1).amount, 200); assert.equal(db.cash.at(-1).type, 'قبض');
  Returns.reverseReturn(db, r.id, { reason: 'x' }, actor);
  assert.equal(db.purchases[0].remaining, 400);
  pass('a supplier return by account with a cash refund keeps purchase remaining and supplier balance in step');
}
{
  const db = returnsDb();
  const r = Returns.createSaleReturn(db, { invoiceId: 'I2', lines: [{ documentId: 'I2', lineIndex: 0, qty: 1 }], replacements: [{ bookId: 'B2', qty: 3 }], settlement: 'cash', reason: 'x', operationKey: key() }, actor).record;
  const inv = db.sales.find(s => s.id === r.replacementSaleId);
  assert.equal(db.customers[0].balance, 200);
  // Old data: the replacement was cancelled on its own (it took its 200 off the balance); reversing must not take it again.
  Object.assign(inv, { status: 'ملغاة' }); db.customers[0].balance = 0;
  inv.lines.forEach(line => { db.books[1].stock += line.qty; db.inventoryBatches[1].remainingQty += line.qty; });
  Returns.reverseReturn(db, r.id, { reason: 'x' }, actor);
  assert.equal(db.customers[0].balance, 0);
  pass('reversing an exchange whose replacement was already cancelled takes its debt off once');
}

// ---- Party vouchers (page code) ------------------------------------------------------------------------------------
{
  const app = fs.readFileSync('app/app.js', 'utf8');
  const start = app.indexOf('function createPartyVoucher('), end = app.indexOf('\nfunction ', start + 10);
  const run = (kind, type, balance) => {
    const ctx = { data: { customers: [{ id: 'C', name: 'c', balance }], suppliers: [{ id: 'S', name: 's', balance }], receipts: [], cash: [] }, nextVoucherId: () => 'V1', nextId: () => 'TX-1', today: () => '2026-10-31', saveData: () => true, actorSnapshot: () => ({}), audit: () => {} };
    vm.createContext(ctx); vm.runInContext(app.slice(start, end), ctx);
    vm.runInContext(`createPartyVoucher(${JSON.stringify({ partyKind: kind, partyId: kind === 'customer' ? 'C' : 'S', type, amount: 100, account: 'x', method: 'نقدي', balanceMode: 'settle' })})`, ctx);
    return (kind === 'customer' ? ctx.data.customers : ctx.data.suppliers)[0].balance;
  };
  assert.equal(run('customer', 'استلام', 500), 400);
  assert.equal(run('customer', 'دفع', 500), 500, 'paying a customer who owes us does not lower the debt');
  assert.equal(run('customer', 'دفع', -150), -50, 'paying back a customer credit settles the credit');
  assert.equal(run('supplier', 'دفع', 1000), 900);
  assert.equal(run('supplier', 'استلام', 1000), 1000, 'money from a supplier does not lower what we owe him');
  pass('vouchers settle the right side of the balance');
}

// ---- Server routes -------------------------------------------------------------------------------------------------
(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    const now = '2026-10-30T10:00:00.000Z';
    db.customers = [{ id: 'C001', name: 'عميل', phone: '01011110001', balance: 0 }];
    db.inventoryBatches = db.books.filter(b => !b.deletedAt && b.stock > 0).map(b => ({ id: `BAT-${b.id}`, batchId: `BAT-${b.id}`, productId: b.id, bookId: b.id, remainingQty: b.stock, unitCost: 60, purchaseDate: '2026-10-01' }));
    const order = (id, extra) => ({ id, customerId: 'C001', customerName: 'عميل', phone: '01011110001', lines: [{ bookId: 'B0001', qty: 1, price: 100 }], total: 100, createdAt: now, updatedAt: now, ...extra });
    db.onlineOrders = [
      order('ORD-1', { status: 'ملغي', workflowStage: 'cancelled', confirmedAt: now, cancelledAt: now }),
      order('ORD-2', { status: 'تم الشحن', workflowStage: 'shipped', confirmedAt: now, saleId: 'INV-2', shipmentId: 'SH-2' }),
      order('ORD-3', { status: 'تم الشحن', workflowStage: 'shipped', confirmedAt: now, saleId: 'INV-3', shipmentId: 'SH-3' })];
    const sale = (id, orderId) => ({ id, onlineOrderId: orderId, customerId: 'C001', date: '2026-10-30', status: 'معتمدة', total: 100, paid: 0, remaining: 100, lines: [{ bookId: 'B0001', qty: 1, price: 100, finalNet: 100 }], createdAt: now });
    db.sales = [sale('INV-2', 'ORD-2'), sale('INV-3', 'ORD-3')];
    const shipment = (id, orderId, invoiceId, status) => ({ id, onlineOrderId: orderId, invoiceId, orderId: invoiceId, trackingNumber: `EG00${id.slice(-1)}EG`, company: 'بوسطة', carrier: 'بوسطة', status: status === 'delivered' ? 'تم التسليم' : 'تم الشحن', normalizedStatus: status, shippingStatus: status, createdAt: now, shippedAt: now });
    db.shipments = [shipment('SH-2', 'ORD-2', 'INV-2', 'delivered'), shipment('SH-3', 'ORD-3', 'INV-3', 'shipped')];
    system = await H.startSystem({ db, name: 'review-critical-' });

    let r = await system.api('/api/orders/ORD-1/confirm', { username: 'cashier', method: 'POST', body: {} });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(system.readDb().onlineOrders[0].workflowStage, 'cancelled');
    r = await system.api('/api/orders/ORD-2/confirm', { username: 'cashier', method: 'POST', body: {} });
    assert.equal(r.status, 200); assert.equal(r.body.existing, true); assert.equal(system.readDb().onlineOrders[1].workflowStage, 'shipped');
    pass('confirm does not bring a cancelled or shipped order back to packing');

    const preview = OrderRefusals.refusalPreview(system.readDb(), 'ORD-2');
    assert.equal(preview.canRefuse, false); assert.match(preview.blocked, /اتسلمت/);
    pass('a delivered parcel cannot be recorded as refused');

    r = await system.api('/api/shipping/shipments/SH-2/cancel', { username: 'shipping', method: 'POST', body: { reason: 'غلط', resolution: 'revise_shipment', carrierCancelled: true } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'SHIPMENT_NOT_CANCELLABLE');
    pass('a delivered shipment cannot be cancelled and shipped again');

    r = await system.api('/api/shipping/shipments/SH-3/status', { username: 'shipping', method: 'PATCH', body: { shippingStatus: 'delivered' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(system.readDb().onlineOrders[2].workflowStage, 'delivered'); assert.equal(system.readDb().onlineOrders[2].status, 'تم التسليم');
    pass('marking a shipment delivered by hand closes its order');

    // Saves from the page (PUT /api/db).
    const put = async (username, change) => {
      const page = (await system.api('/api/db', { username })).body;
      change(page);
      return system.api('/api/db', { username, method: 'PUT', body: page, headers: { 'If-Match': String(system.readDb().meta.dataRevision) } });
    };
    r = await put('shipping', page => { page.onlineOrders[2].internalNote = 'x'; page.cash.push({ id: 'TX-HACK', date: '2026-10-31', type: 'صرف', account: 'الخزينة الرئيسية', amount: 5000, orderId: 'ORD-3' }); });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    pass('touching an order no longer lets any role add money to or take it from the treasury');
    r = await put('cashier', page => { Object.assign(page.sales[0], { paid: 100, remaining: 0, status: 'مدفوعة' }); });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    r = await put('warehouse', page => { page.sales[0].deletedAt = '2026-10-31T00:00:00.000Z'; });
    assert.ok([403, 409].includes(r.status), JSON.stringify(r.body));
    pass('only the payment and cancel permissions change what an invoice was paid or delete it');
    r = await put('cashier', page => {
      page.sales.push({ id: 'INV-9', customerId: 'C001', date: '2026-10-31', status: 'معتمدة', payment: 'نقدي', total: 100, paid: 100, remaining: 0, lines: [{ bookId: 'B0001', qty: 1, price: 100, finalNet: 100 }], createdAt: now });
      page.cash.push({ id: 'TX-SALE', date: '2026-10-31', type: 'قبض', locked: true, account: 'الخزينة الرئيسية', accountId: 'CA-001', saleId: 'INV-9', amount: 100, category: 'مبيعات', note: 'فاتورة INV-9' });
    });
    assert.notEqual(r.status, 403, JSON.stringify(r.body));
    pass('a counter sale still records its own payment');
    r = await put('owner', page => { page.dayClosings = [{ id: 'DAY-001', date: '2026-10-30', closedAt: now }]; });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await put('cashier', page => { page.dayClosings = []; });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    r = await put('cashier', page => { page.sales.find(s => s.id === 'INV-2').notes = 'تعديل'; });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'DAY_CLOSED');
    pass('a closed day cannot be reopened or edited without the closing permission');
    r = await put('manager', page => { page.settings.permissions.users.manager = { actions: ['manage-users', 'view-sales'] }; });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal((await system.api('/api/admin/users', { username: 'manager' })).status, 403);
    pass('a manager cannot give himself user administration');
  } finally { system?.stop(); }
  console.log('All review fixes passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
