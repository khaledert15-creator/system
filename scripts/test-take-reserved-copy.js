'use strict';
// Exception to «pre-orders wait, oldest first»: an employee who edits orders takes a copy another customer's order
// holds and gives it to a pre-order. The pre-order must then be complete (it moves to packing); the other order keeps
// the book and becomes a pre-order, first in line. A reason is required; nothing moves when it would not help.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');
const pass = name => console.log(`PASS ${name}`);

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.books = [
      { id: 'B1', name: 'نيوتن 3ث', price: 100, cost: 50, stock: 1, reservedStock: 0, supplierId: 'S001' },
      { id: 'B2', name: 'كيمياء 3ث', price: 100, cost: 50, stock: 5, reservedStock: 0, supplierId: 'S001' },
      { id: 'B3', name: 'مش موجود', price: 100, cost: 50, stock: 0, reservedStock: 0, supplierId: 'S001' }
    ];
    db.inventoryBatches = db.books.filter(book => book.stock).map(book => ({ id: `BATCH-${book.id}`, productId: book.id, bookId: book.id, qty: book.stock, quantity: book.stock, remainingQty: book.stock, unitCost: book.cost, createdAt: '2026-10-01T00:00:00.000Z' }));
    system = await H.startSystem({ db, name: 'take-reserved-' });
    const order = id => system.readDb().onlineOrders.find(row => row.id === id);
    const book = id => system.readDb().books.find(row => row.id === id);
    const create = async (phone, lines, key) => {
      const r = await system.api('/api/orders/quick', { username: 'cashier', method: 'POST', body: { phone, customerName: `عميل ${phone.slice(-2)}`, governorate: 'القاهرة', address: 'شارع', shippingCompany: 'البريد المصري', requestId: key, lines } });
      await system.api(`/api/orders/${r.body.order.id}/confirm`, { username: 'cashier', method: 'POST', body: {} });
      return r.body.order.id;
    };
    const holder = await create('01011110011', [{ bookId: 'B1', qty: 1 }, { bookId: 'B2', qty: 2 }], 'a');
    const waiting = await create('01011110022', [{ bookId: 'B1', qty: 1 }], 'b');
    const short = await create('01011110033', [{ bookId: 'B1', qty: 1 }, { bookId: 'B3', qty: 1 }], 'c');
    assert.equal(order(holder).workflowStage, 'awaiting_preparation'); assert.equal(order(waiting).workflowStage, 'awaiting_stock');
    const take = (target, extra = {}, username = 'cashier') => system.api(`/api/orders/${target}/take-reserved`, { username, method: 'POST', body: { bookId: 'B1', sourceOrderId: holder, reason: 'العميل محتاجه ضروري', operationKey: `k-${target}`, ...extra } });

    assert.equal((await take(waiting, {}, 'warehouse')).status, 403);
    let r = await take(waiting, { reason: '' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'REASON_REQUIRED');
    r = await take(short); assert.equal(r.status, 409); assert.equal(r.body.code, 'TARGET_STILL_SHORT');
    assert.equal(order(holder).inventoryReservation.status, 'active'); assert.equal(book('B1').reservedStock, 1, 'nothing moved');
    pass('permission, required reason, and nothing moves when the pre-order would still be short');

    r = await take(waiting); assert.equal(r.status, 200, r.text);
    const target = order(waiting), source = order(holder);
    assert.equal(target.workflowStage, 'awaiting_preparation'); assert.deepEqual(target.inventoryReservation.lines, [{ bookId: 'B1', qty: 1 }]);
    assert.equal(source.workflowStage, 'awaiting_stock'); assert.deepEqual(source.backorderLines, [{ bookId: 'B1', qty: 1 }]);
    assert.deepEqual(source.lines.map(line => [line.bookId, line.qty]), [['B1', 1], ['B2', 2]], 'the source keeps its books');
    assert.equal(source.backorderSince, source.confirmedAt, 'first in line for the next copy');
    assert.equal(book('B1').reservedStock, 1); assert.equal(book('B2').reservedStock, 0, 'a pre-order holds no copies');
    assert.equal(target.reservationTransfers[0].reason, 'العميل محتاجه ضروري'); assert.equal(source.reservationTransfers[0].toOrderId, waiting);
    assert.ok(system.readDb().notifications.some(row => row.entityId === holder && /نسخة محجوزة/.test(row.title)));
    pass('the copy moves: the pre-order goes to packing, the other order becomes a pre-order first in line');

    r = await take(waiting); assert.equal(r.status, 200); assert.equal(r.body.existing, true);
    r = await system.api(`/api/orders/${short}/take-reserved`, { username: 'cashier', method: 'POST', body: { bookId: 'B1', sourceOrderId: holder, reason: 'تجربة', operationKey: 'k2' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'SOURCE_NOT_TAKEABLE', 'a pre-order holds nothing to take');
    pass('a repeated click changes nothing, and a pre-order has nothing to take');
    // The pre-orders screen gives the real reason for the source order.
    const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../app/app.js'), 'utf8');
    const start = app.indexOf('function preorderReason('), end = app.indexOf('\n}\n', start) + 2;
    const vm = require('node:vm'), box = { PREPARATION_SHORTAGE_REASONS: [] }; vm.createContext(box); vm.runInContext(app.slice(start, end), box);
    const reasonShown = box.preorderReason(order(holder));
    assert.equal(reasonShown.source, 'transfer'); assert.match(reasonShown.title, new RegExp(`نسخته اتاخدت لطلب ${waiting}`)); assert.match(reasonShown.detail, /محتاجه ضروري/);
    pass('the pre-orders screen says the copy went to another order, with the reason');
    console.log('take reserved copy: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-20).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); }
})();
