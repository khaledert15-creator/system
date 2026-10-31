'use strict';
// Regressions found by the second review (2026-10-31): legitimate daily work refused by the stricter page-save rules,
// counter-sale shipping, closed parcels, replacement invoices, and money collected beyond what an invoice owed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./integration-test-helpers.js');
const pass = name => console.log(`PASS ${name}`);

{
  const app = fs.readFileSync('app/app.js', 'utf8');
  const start = app.indexOf('function updateSaleSummary('), body = app.slice(start, app.indexOf('\nfunction ', start + 10));
  assert.match(body, /saleIsInStore\(\)\?\{fee:0,source:"in_store"\}/);
  pass('the sale summary keeps an in-shop sale without shipping');
}

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    const now = '2026-10-30T10:00:00.000Z';
    db.customers = [{ id: 'C001', name: 'عميل', phone: '01011110001', balance: 185 }];
    db.sales = [{ id: 'INV-1', customerId: 'C001', date: '2026-10-30', status: 'معتمدة', total: 185, paid: 0, remaining: 185, lines: [{ bookId: 'B0001', qty: 1, price: 110, finalNet: 110 }], shippingFee: 75, createdAt: now },
      { id: 'INV-2', customerId: 'C001', date: '2026-10-30', status: 'معتمدة', total: 100, paid: 0, remaining: 0, replacementForReturnId: 'RET-9', replacementForReturnNo: 'RINV-009', lines: [{ bookId: 'B0001', qty: 1, price: 100, finalNet: 100 }], createdAt: now }];
    db.expenses = [{ id: 'EXP-1', date: '2026-10-30', amount: 50, account: 'الخزينة الرئيسية', expenseType: 'نثريات', status: 'مسجل', createdAt: now }];
    db.receipts = [{ id: 'RCP-0001', date: '2026-10-30', type: 'استلام', partyKind: 'customer', partyId: 'C001', amount: 40, account: 'الخزينة الرئيسية', status: 'معتمد', balanceApplied: 0, balanceMode: 'none' }];
    db.purchases = [{ id: 'PUR-1', supplierId: 'S001', type: 'شراء', date: '2026-10-30', status: 'مستلمة', total: 300, paid: 100, remaining: 200, lines: [] }];
    // A server-written cash row (as quick-order deposits are) has no deletedAt field.
    db.cash = [{ id: 'TX-0001', date: '2026-10-30', type: 'قبض', locked: true, account: 'الخزينة الرئيسية', amount: 40, receiptId: 'RCP-0001', category: 'تحصيل عميل' }];
    db.onlineOrders = [{ id: 'ORD-1', customerId: 'C001', status: 'ملغي', workflowStage: 'cancelled', cancelledAt: now, lines: [], total: 0, shipmentId: 'SH-1', createdAt: now }];
    db.shipments = [{ id: 'SH-1', onlineOrderId: 'ORD-1', trackingNumber: 'EG1EG', status: 'ملغاة', normalizedStatus: 'cancelled', shippingStatus: 'cancelled', cancelledAt: now, createdAt: now }];
    system = await H.startSystem({ db, name: 'review-regressions-' });
    const rev = () => String(system.readDb().meta.dataRevision);
    const put = async (username, change) => {
      const page = (await system.api('/api/db', { username })).body;
      for (const row of page.cash || []) if (!('deletedAt' in row)) row.deletedAt = null; // what the page's normalizeData does
      change(page);
      return system.api('/api/db', { username, method: 'PUT', body: page, headers: { 'If-Match': rev() } });
    };
    const cash = (extra) => ({ id: `TX-${Math.random().toString(36).slice(2, 7)}`, date: '2026-10-31', locked: true, account: 'الخزينة الرئيسية', deletedAt: null, ...extra });

    let r = await put('cashier', page => { page.customers[0].notes = 'x'; });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pass('an unrelated save passes when a server-written cash row has no deletedAt');

    r = await put('accountant', page => { Object.assign(page.expenses[0], { status: 'معتمد', approvedBy: 'accountant' }); page.cash.push(cash({ type: 'صرف', amount: 50, expenseId: 'EXP-1', category: 'مصروف' })); });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pass('the accountant approves an expense with its cash row');

    r = await put('accountant', page => { Object.assign(page.sales[0], { paid: 85, remaining: 100 }); page.cash.push(cash({ type: 'قبض', amount: 85, saleId: 'INV-1', category: 'تحصيل فاتورة' })); });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await put('accountant', page => { page.cash.push(cash({ type: 'قبض', amount: 500, saleId: 'INV-1', category: 'تحصيل فاتورة' })); page.sales[0].notes = 'y'; });
    assert.notEqual(r.status, 403, 'the accountant may also record general receipts');
    pass('the accountant collects an invoice payment');

    r = await put('cashier', page => { page.receipts[0].status = 'ملغى'; page.cash.push(cash({ type: 'صرف', amount: 40, receiptId: 'RCP-0001', category: 'إلغاء إيصال' })); });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pass('a voucher is cancelled with its reverse cash row');

    r = await put('warehouse', page => { page.purchases[0].status = 'ملغاة'; page.cash.push(cash({ type: 'قبض', amount: 100, purchaseId: 'PUR-1', category: 'إلغاء مشتريات' })); });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await put('warehouse', page => { page.customers[0].notes = 'z'; page.cash.push(cash({ type: 'قبض', amount: 900, purchaseId: 'PUR-1', category: 'x' })); });
    assert.equal(r.status, 403, 'more than the step moves still needs the cash permission');
    pass('a paid purchase is cancelled with its refund, and no more than that');

    r = await put('manager', page => { page.sales.find(s => s.id === 'INV-2').status = 'ملغاة'; });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'REPLACEMENT_INVOICE');
    pass('a replacement invoice cannot be cancelled by a page save');

    r = await system.api('/api/shipping/shipments/SH-1/status', { username: 'shipping', method: 'PATCH', body: { shippingStatus: 'delivered' } });
    assert.equal(r.status, 409); assert.equal(system.readDb().onlineOrders[0].status, 'ملغي');
    pass('a cancelled parcel cannot be marked delivered and its order stays cancelled');
  } finally { system?.stop(); }

  // Money collected beyond what the invoice still owed becomes the customer's credit, and reversal takes it back.
  const src = fs.readFileSync('server-node.js', 'utf8'), vm = require('node:vm');
  const a = src.indexOf('function applyCarrierPayment('), b = src.indexOf('function orderPaymentFromCollections('), c = src.indexOf('function reverseCarrierPayment('), d = src.indexOf('\n}', c) + 2;
  const ctx = { OrderFinance: require('../app/order-finance.js'), orderPaymentFromCollections: () => {} };
  vm.createContext(ctx); vm.runInContext(src.slice(a, b) + src.slice(c, d), ctx);
  const sale = { id: 'I', customerId: 'C', total: 295, paid: 0, remaining: 185, returnedRemaining: 110 }, data = { customers: [{ id: 'C', balance: 185 }] };
  const effect = ctx.applyCarrierPayment(data, sale, null, 295, 'now');
  assert.equal(sale.remaining, 0); assert.equal(effect.excessCredit, 110); assert.equal(data.customers[0].balance, -110);
  ctx.reverseCarrierPayment(data, effect, sale, null, 'now');
  assert.equal(data.customers[0].balance, 185); assert.equal(sale.remaining, 185);
  pass('a collection above what the invoice owed leaves the excess as customer credit');
  console.log('All review regression fixes passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
