'use strict';
// The courier did not pick the parcel up, so the shipment is cancelled at the carrier and the order needs a new
// tracking code. «إلغاء الشحنة وإصدار كود جديد» keeps the order, its invoice and its books (a pre-order waiting for the
// same book does not get them) and the order is shipped again with the new code. Also checks the shortcut and the
// warning shown when someone tries to cancel the whole order instead.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const H = require('./integration-test-helpers.js');
const pass = name => console.log(`PASS ${name}`);

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.books = [{ id: 'B1', name: 'مندليف كيميا 3ث', price: 150, cost: 60, stock: 1, reservedStock: 0, supplierId: 'S001' }];
    db.inventoryBatches = [{ id: 'BATCH-B1', productId: 'B1', bookId: 'B1', qty: 1, quantity: 1, remainingQty: 1, unitCost: 60, createdAt: '2026-10-01T00:00:00.000Z' }];
    system = await H.startSystem({ db, name: 'reship-' });
    const order = id => system.readDb().onlineOrders.find(row => row.id === id);
    const create = async (phone, key) => {
      const r = await system.api('/api/orders/quick', { username: 'cashier', method: 'POST', body: { phone, customerName: `عميل ${key}`, governorate: 'القاهرة', city:'مدينة نصر', address: 'شارع', shippingCompany: 'البريد المصري', requestId: key, lines: [{ bookId: 'B1', qty: 1 }] } });
      await system.api(`/api/orders/${r.body.order.id}/confirm`, { username: 'cashier', method: 'POST', body: {} });
      return r.body.order.id;
    };
    const shipped = await create('01011110001', 'a');
    for (const [route, method, body] of [['prepare/start', 'POST', {}], ['prepare/checklist', 'PATCH', { doneBookIds: ['B1'] }], ['prepare/complete', 'POST', { packedWeightGrams: 900 }], ['ship', 'POST', { trackingNumber: 'EN111111111EG' }]]) {
      const r = await system.api(`/api/orders/${shipped}/${route}`, { username: 'owner', method, body });
      assert.ok([200, 201].includes(r.status), `${route}: ${r.text}`);
    }
    const waiting = await create('01011110002', 'b');
    assert.equal(order(waiting).workflowStage, 'awaiting_stock');
    const invoice = order(shipped).saleId, shipmentId = order(shipped).shipmentId;
    assert.ok(invoice && shipmentId);

    let r = await system.api(`/api/shipping/shipments/${shipmentId}/cancel`, { username: 'owner', method: 'POST', body: { carrierCancelled: true, reason: 'المندوب نسي الكرتونة', resolution: 'revise_shipment', postalChargeStatus: 'not_charged', postalChargeReason: 'ما اتشحنش' } });
    assert.equal(r.status, 200, r.text);
    const back = order(shipped);
    assert.equal(back.workflowStage, 'awaiting_shipping'); assert.equal(back.saleId, invoice, 'the invoice is kept'); assert.equal(back.shipmentId, null);
    assert.equal(system.readDb().sales.find(sale => sale.id === invoice).status !== 'ملغاة', true);
    assert.equal(order(waiting).workflowStage, 'awaiting_stock', 'the waiting pre-order does not get the book');
    assert.equal(system.readDb().books[0].stock, 0, 'the copy stays with the parcel');
    pass('cancelling only the shipment keeps the order, its invoice and its book');

    r = await system.api(`/api/orders/${shipped}/ship`, { username: 'owner', method: 'POST', body: { trackingNumber: 'EN222222222EG' } });
    assert.ok([200, 201].includes(r.status), r.text);
    assert.equal(order(shipped).tracking || order(shipped).trackingNumber, 'EN222222222EG');
    assert.deepEqual(order(shipped).previousTrackingNumbers.map(row => row.trackingNumber), ['EN111111111EG']);
    pass('the order is shipped again with the new code, and the old code is kept in its history');

    // The shortcut and the warning on the screens.
    const source = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
    const fn = name => { const start = source.indexOf(`function ${name}(`); let depth = 0, i = source.indexOf('{', source.indexOf(')', start)); for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; } return source.slice(start, i + 1); };
    const box = { PRE_HANDOVER_SHIPMENT_STATUSES: ['', 'shipped', 'created', 'pending', 'label_created'], allowed: new Set(['order.shipping']), current: null };
    vm.createContext(box);
    vm.runInContext(`const canAction=a=>allowed.has(a);const onlineOrderWorkflowStage=o=>o.stage;const activeOrderShipment=()=>current;${fn('reshipShipment')}`, box);
    box.current = { id: 'SH-1', normalizedStatus: 'shipped' };
    assert.equal(box.reshipShipment({ stage: 'shipped' }).id, 'SH-1');
    box.current = { id: 'SH-2', normalizedStatus: 'in_transit' };
    assert.equal(box.reshipShipment({ stage: 'shipped' }), null, 'not once the carrier has the parcel');
    box.current = { id: 'SH-3', normalizedStatus: 'shipped' }; box.allowed.clear();
    assert.equal(box.reshipShipment({ stage: 'shipped' }), null, 'needs a shipping permission');
    assert.ok(fn('onlineOrderMoreActions').includes('إلغاء الشحنة وإصدار كود جديد'));
    assert.ok(fn('cancelOnlineOrder').includes('هتشحن الطلب تاني بكود جديد؟ متلغيش الطلب'));
    assert.ok(fn('saveAndConfirmQuickOrder').includes('reservedCopiesFor(confirmedOrder)'), 'after confirming a pre-order the screen offers to take a reserved copy');
    pass('shortcut in «⋯ المزيد», warning in the cancel dialog, and the offer after confirming a pre-order');
    console.log('reship with a new code: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-20).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); }
})();
