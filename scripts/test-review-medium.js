'use strict';
// Medium fixes from the full system review (2026-10-31): dashboard debt, statements, Cairo dates, counter-sale
// shipping, stale quick-order edits, reservations left alone by unrelated saves, refused parcels repaired.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const H = require('./integration-test-helpers.js');
const Returns = require('../app/returns.js');
const pass = name => console.log(`PASS ${name}`);
const app = fs.readFileSync('app/app.js', 'utf8');
const fn = name => { const start = app.indexOf(`function ${name}(`); return app.slice(start, app.indexOf('\nfunction ', start + 10)); };

{
  // The dashboard sums what customers owe; a customer without a balance field no longer turns the total into NaN.
  assert.match(fn('renderDashboard'), /Math\.max\(0, Number\(item\.balance \|\| 0\)\)/);
  assert.doesNotMatch(fn('renderDashboard'), /\+12\.4%|\+4\.1%/);
  pass('dashboard customer debt reads missing balances as 0 and shows no made-up trends');
}
{
  const ctx = { data: {
    receipts: [], sales: [], returns: [], customerCredits: [], onlineOrders: [],
    purchases: [{ id: 'P1', supplierId: 'S1', type: 'أمانة', total: 360, remaining: 360, status: 'مستلمة', date: '2026-10-01' }, { id: 'P2', supplierId: 'S1', type: 'شراء', total: 100, remaining: 100, status: 'مستلمة', date: '2026-10-02' }],
    orderRefunds: [{ customerId: 'C1', settlementType: 'cash_refund', amount: 180, refundId: 'RF-1', performedAt: '2026-10-03', status: 'confirmed' }],
    customerCreditUses: [] },
    money: v => String(v), esc: v => String(v), returnKind: () => 'sale', returnNo: r => r.id, returnTypeLabel: () => '', returnSettlementLabel: () => '', refusalOutcomeLabel: () => '', cancellationSettlementLabel: () => 'رد مبلغ نقدي' };
  vm.createContext(ctx); vm.runInContext(fn('statementRows'), ctx);
  const supplier = vm.runInContext('statementRows("S1","supplier")', ctx);
  assert.equal(supplier.at(-1).balance, 100, 'consignment is not owed');
  const customer = vm.runInContext('statementRows("C1","customer")', ctx);
  assert.equal(customer.at(-1).balance, 0, 'giving a deposit back does not put the customer in debt');
  assert.match(customer[0].description, /180/);
  pass('statements: consignment adds nothing, a deposit refund is shown without a debit');
}
{
  const db = { customers: [{ id: 'C1', name: 'c', balance: 0 }], books: [{ id: 'B1', name: 'b', stock: 0, price: 100 }], inventoryBatches: [], cash: [], cashAccounts: [{ id: 'CA1', name: 'الخزينة الرئيسية', active: true }], returns: [], stockMovements: [], orderRefunds: [],
    sales: [{ id: 'I1', customerId: 'C1', total: 100, paid: 100, paidAmount: 100, remaining: 0, remainingAmount: 0, status: 'معتمدة', lines: [{ bookId: 'B1', qty: 1, price: 100, finalNet: 100 }] }] };
  const record = Returns.createSaleReturn(db, { invoiceId: 'I1', lines: [{ documentId: 'I1', lineIndex: 0, qty: 1 }], settlement: 'cash', reason: 'x', operationKey: 'k1' }, { username: 'o', name: 'o', uuid: () => 'u', now: '2026-10-30T23:30:00.000Z' }).record;
  assert.equal(record.date, '2026-10-31', '01:30 in Cairo is the new day');
  assert.equal(db.cash[0].date, '2026-10-31');
  assert.equal(db.sales[0].paidAmount, 0, 'paidAmount follows paid'); assert.equal(db.sales[0].remainingAmount, 0);
  assert.match(fn('today'), /Africa\/Cairo/);
  pass('business dates are Cairo dates and a return keeps paidAmount/remainingAmount in step');
}

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    const now = '2026-10-30T10:00:00.000Z';
    db.customers = [{ id: 'C001', name: 'عميل', phone: '01011110001', governorate: 'الجيزة', balance: 0 }];
    db.settings.shippingRules = { defaultCost: 75, byGovernorate: { 'الجيزة': 75 } };
    db.inventoryBatches = db.books.filter(b => !b.deletedAt && b.stock > 0).map(b => ({ id: `BAT-${b.id}`, batchId: `BAT-${b.id}`, productId: b.id, bookId: b.id, remainingQty: b.stock, unitCost: 60, purchaseDate: '2026-10-01' }));
    const reservation = { status: 'active', lines: [{ bookId: 'B0001', qty: 1 }], reservedAt: now, updatedAt: now, reservedBy: 'owner' };
    db.books[0].reservedStock = 1;
    db.onlineOrders = [{ id: 'ORD-1', customerId: 'C001', customerName: 'عميل', phone: '01011110001', governorate: 'الجيزة', lines: [{ bookId: 'B0001', qty: 1, price: 100 }], total: 175, shippingCost: 75, status: 'مؤكد', workflowStage: 'awaiting_preparation', confirmedAt: now, inventoryReservation: reservation, createdAt: now, updatedAt: now },
      { id: 'ORD-2', customerId: 'C001', customerName: 'عميل', lines: [{ bookId: 'B0001', qty: 1, price: 100 }], total: 100, status: 'مرتجع', workflowStage: 'returned', refusal: { id: 'RET-1', repaired: true }, refusedAt: now, shipmentId: 'SH-2', createdAt: now, updatedAt: now }];
    db.shipments = [{ id: 'SH-2', onlineOrderId: 'ORD-2', trackingNumber: 'EG2EG', status: 'تم الشحن', normalizedStatus: 'shipped', createdAt: now }];
    system = await H.startSystem({ db, name: 'review-medium-' });
    await H.until(() => system.readDb().shipments[0].refusedAt, 'startup repair');
    assert.equal(system.readDb().shipments[0].normalizedStatus, 'returned');
    pass('a refused order\'s parcel without refusedAt is marked refused at startup');

    const put = async (username, change) => {
      const page = (await system.api('/api/db', { username })).body;
      change(page);
      return system.api('/api/db', { username, method: 'PUT', body: page, headers: { 'If-Match': String(system.readDb().meta.dataRevision) } });
    };
    let r = await put('cashier', page => { page.customers[0].notes = 'x'; });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(system.readDb().onlineOrders[0].inventoryReservation, reservation, 'an unrelated save leaves the reservation as it was');
    pass('saves no longer re-stamp every reserved order');

    r = await put('cashier', page => {
      page.sales.push({ id: 'INV-9', customerId: 'C001', channel: 'تجزئة', saleOperationType: 'بيع مباشر', date: '2026-10-31', status: 'معتمدة', payment: 'نقدي', shippingCost: 0, total: 100, paid: 100, remaining: 0, lines: [{ bookId: 'B0002', qty: 1, price: 100, finalNet: 100 }], createdAt: now });
    });
    assert.notEqual(r.body?.code, 'SHIPPING_OVERRIDE_FORBIDDEN', JSON.stringify(r.body));
    pass('a cashier sells in the shop without the governorate shipping fee');

    const stamp = order => ({ updatedAt: String(order.updatedAt || ''), stage: String(order.workflowStage || ''), lines: (order.lines || []).map(line => [String(line.bookId || ''), Number(line.qty || 0), Number(line.price || 0), Number(line.discount || 0), String(line.discountType || ''), String(line.discountScope || '')]) });
    const opened = stamp(system.readDb().onlineOrders[0]);
    const body = { phone: '01011110001', customerName: 'عميل', governorate: 'الجيزة', city: 'الدقي', address: 'شارع 1', lines: [{ bookId: 'B0001', qty: 1, price: 100 }], shippingCost: 75, shippingCompany: 'البريد المصري' };
    r = await system.api('/api/orders/ORD-1/quick', { username: 'cashier', method: 'PATCH', body: { ...body, notes: 'أول', orderStamp: opened } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await system.api('/api/orders/ORD-1/quick', { username: 'manager', method: 'PATCH', body: { ...body, notes: 'تاني', orderStamp: opened } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_CHANGED');
    pass('a quick-order edit from a screen opened before another save is refused, not silently overwritten');

    assert.equal((await system.api('/api/customers/C001/ledger', { username: 'warehouse' })).status, 403);
    assert.equal((await system.api('/api/customers/C001/ledger', { username: 'cashier' })).status, 200);
    pass('the customer ledger is for money and customer screens');
  } finally { system?.stop(); }
  console.log('All medium review fixes passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
