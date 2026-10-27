'use strict';
// An order exported to the carrier may already be with Egypt Post before its tracking code arrives (2026-10-27:
// ORD-0481 was exported, reopened for editing, put back on the packing list and packed and shipped a second time).
// - reopening it for editing, or back to packing, is refused until the employee confirms the parcel is still here and
//   gives a reason; a weight correction (which clears the export for a new one) does not lift that;
// - with the confirmation it reopens as before, and the reason is kept on the order and in the audit;
// - the Chatwood panel does not offer to edit it.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.books = [{ id:'B0001', name:'رياضيات', price:100, cost:60, stock:20, reservedStock:0, supplierId:'S001' }];
    db.inventoryBatches = [{ id:'BATCH-B0001', productId:'B0001', bookId:'B0001', qty:20, quantity:20, remainingQty:20, unitCost:60, createdAt:'2026-10-01T00:00:00.000Z' }];
    system = await H.startSystem({ db, name:'carrier-export-reopen-' });
    const order = id => system.readDb().onlineOrders.find(row => row.id === id);
    const create = async (requestId, phone) => {
      let r = await system.api('/api/orders/quick', { username:'cashier', method:'POST', body:{ phone, customerName:`عميل ${requestId}`, duplicateOverrideReason:'طلب منفصل للاختبار', governorate:'القاهرة', city:'مدينة نصر', address:'شارع 1', shippingCompany:'البريد المصري', requestId, lines:[{ bookId:'B0001', qty:1 }] } });
      assert.ok([200, 201].includes(r.status), r.text);
      const id = r.body.order.id;
      assert.equal((await system.api(`/api/orders/${id}/confirm`, { username:'cashier', method:'POST', body:{} })).status, 200);
      r = await system.api(`/api/orders/${id}/prepare/start`, { username:'warehouse', method:'POST', body:{} }); assert.equal(r.status, 200, r.text);
      r = await system.api(`/api/orders/${id}/prepare/checklist`, { username:'warehouse', method:'PATCH', body:{ doneBookIds:['B0001'] } }); assert.equal(r.status, 200, r.text);
      r = await system.api(`/api/orders/${id}/prepare/complete`, { username:'warehouse', method:'POST', body:{ packedWeightGrams:900 } }); assert.equal(r.status, 200, r.text);
      return id;
    };
    const exportToCarrier = async ids => {
      const r = await system.api('/api/orders/shipping/export', { username:'shipping', method:'POST', body:{ orderIds:ids } });
      assert.equal(r.status, 200, r.text);
    };

    // ---- A packed order that was never exported still reopens with the usual confirmation.
    const plain = await create('plain-1', '01011110000');
    let r = await system.api(`/api/orders/${plain}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'plain' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(order(plain).workflowStage, 'awaiting_preparation');
    console.log('PASS a packed order that was not exported reopens as before');

    // ---- Exported: refused, nothing changes.
    const id = await create('exported-1', '01011112222');
    await exportToCarrier([id]);
    const exported = order(id);
    assert.ok(exported.shippingExport?.batchId); assert.ok(exported.carrierExportedAt);
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k1' } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'ORDER_EXPORTED_TO_CARRIER');
    r = await system.api(`/api/orders/${id}/prepare/reopen`, { username:'warehouse', method:'POST', body:{} });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.code, 'ORDER_EXPORTED_TO_CARRIER');
    assert.equal(order(id).saleId, exported.saleId); assert.equal(order(id).workflowStage, 'awaiting_shipping');
    assert.equal(system.readDb().sales.find(sale => sale.id === exported.saleId).status, 'معتمدة');
    console.log('PASS an exported order is not reopened for editing or for packing');

    // ---- The confirmation alone, or a reason alone, is not enough.
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k2', parcelNotWithCarrier:true, exportOverrideReason:'' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_EXPORTED_TO_CARRIER');
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k3', exportOverrideReason:'العميل غيّر كتاب' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_EXPORTED_TO_CARRIER');
    console.log('PASS reopening needs both the parcel confirmation and a reason');

    // ---- A weight correction clears the export (for a new one) but the order still counts as exported.
    r = await system.api(`/api/orders/${id}/packed-weight`, { username:'warehouse', method:'PATCH', body:{ packedWeightGrams:1200 } });
    assert.equal(r.status, 200, r.text);
    assert.equal(order(id).shippingExport, null); assert.ok(order(id).carrierExportedAt);
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k4' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_EXPORTED_TO_CARRIER');
    console.log('PASS a weight correction does not lift the block');

    // ---- The panel does not offer to edit it.
    r = await system.api(`/api/integration/v1/panel/order?id=${id}`, { username:'cashier' });
    if (r.status === 200) { assert.match(r.body.editBlock, /اتصدّر لشركة الشحن/); console.log('PASS the Chatwood panel refuses to edit an exported order'); }
    else console.log(`SKIP panel order returned ${r.status} (${r.body?.code || ''})`);

    // ---- With the confirmation and a reason it reopens, and the reason is recorded.
    r = await system.api(`/api/orders/${id}/reopen-for-edit`, { username:'cashier', method:'POST', body:{ confirm:true, operationKey:'k5', parcelNotWithCarrier:true, exportOverrideReason:'العميل غيّر كتاب قبل المندوب' } });
    assert.equal(r.status, 200, r.text);
    const reopened = order(id);
    assert.equal(reopened.workflowStage, 'awaiting_preparation'); assert.equal(reopened.saleId, '');
    assert.equal(reopened.carrierExportedAt, null); assert.equal(reopened.shippingExport, null);
    assert.equal(reopened.reopenedForEdit.at(-1).carrierExportOverride, 'العميل غيّر كتاب قبل المندوب');
    const audit = system.readDb().audit.filter(row => row.entityId === id && row.action === 'إعادة فتح الطلب للتعديل').at(-1);
    assert.match(String(audit.details), /الطرد لسه عندنا: العميل غيّر كتاب قبل المندوب/);
    console.log('PASS with the confirmation and a reason the order reopens and the reason is recorded');

    // ---- Back to packing (no editing) behaves the same way.
    const second = await create('exported-2', '01011113333');
    await exportToCarrier([second]);
    r = await system.api(`/api/orders/${second}/prepare/reopen`, { username:'warehouse', method:'POST', body:{ parcelNotWithCarrier:true, exportOverrideReason:'الطرد اتفتح للمراجعة' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(order(second).workflowStage, 'awaiting_preparation'); assert.equal(order(second).carrierExportedAt, null);
    console.log('PASS back to packing with the confirmation and a reason');

    console.log('carrier export reopen: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-30).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); }
})();
