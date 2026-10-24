'use strict';
// Customer tracking for the Store's /track page: signed POST /api/integration/v1/track, reference + phone together,
// customer-safe reply (no name, address, phone or cost), carrier events newest first.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');
const OrderTracking = require('../app/order-tracking.js');

const track = (base, body, options = {}) => H.signedFetch(base, '/api/integration/v1/track', { method:'POST', body:JSON.stringify(body), headers:{ 'Content-Type':'application/json' }, ...options });

(async () => {
  const servers = [];
  try {
    const db = H.fixtureDb();
    db.customers.push({ id:'C0001', name:'عميل سري', phone:'01001234567', alternativePhone:'01112223333' });
    const base = { customerId:'C0001', customerName:'عميل سري', address:'شارع سري 5', governorate:'القاهرة', city:'مدينة نصر', createdAt:'2026-10-10T10:00:00.000Z', updatedAt:'2026-10-12T10:00:00.000Z' };
    db.onlineOrders.push(
      { ...base, id:'ORD-0007', phone:'01001234567', workflowStage:'shipped', status:'تم الشحن', confirmedAt:'2026-10-10T11:00:00.000Z', preparedAt:'2026-10-11T09:00:00.000Z', saleId:'INV-0001', shipmentId:'SH-0001', total:235, shippingFee:35, paidAmount:100, remainingAmount:135, lines:[{ bookId:'B0001', qty:2 }, { bookId:'B0002', qty:1 }] },
      { ...base, id:'ORD-0008', phone:'01001234567', workflowStage:'awaiting_stock', status:'حجز مسبق', confirmedAt:'2026-10-10T11:00:00.000Z', total:100, paidAmount:50, lines:[{ bookId:'B0003', qty:1 }], backorderLines:[{ bookId:'B0003', qty:1 }] },
      { ...base, id:'ORD-0009', phone:'01009998888', workflowStage:'draft', status:'مسودة', total:10, lines:[] },
      { ...base, id:'ORD-0010', phone:'01001234567', workflowStage:'cancelled', status:'ملغي', cancelledAt:'2026-10-12T00:00:00.000Z', total:10, lines:[], deletedAt:null },
      { ...base, id:'ORD-0011', phone:'01001234567', workflowStage:'shipped', status:'تم الشحن', deletedAt:'2026-10-12T00:00:00.000Z', lines:[] }
    );
    db.shipments.push({ id:'SH-0001', onlineOrderId:'ORD-0007', trackingNumber:'ENO50549198EG', previousTrackingNumbers:['ENO11111111EG'], normalizedStatus:'out_for_delivery', lastStatusText:'الشحنة مع مندوب التوصيل', currentLocation:'منطقة توزيع ابو حماد', company:'البريد المصري', phone:'01001234567', customer:'عميل سري', address:'شارع سري 5', cost:50, shippedAt:'2026-10-11T12:00:00.000Z' });
    db.trackingHistory = [
      { id:'T1', shipmentId:'SH-0001', trackingNumber:'ENO50549198EG', statusText:'تم تسجيل الشحنة', normalizedStatus:'shipped', location:'مكتب القاهرة', eventAt:'2026-10-11T12:00:00.000Z', eventFingerprint:'a' },
      { id:'T2', shipmentId:'SH-0001', trackingNumber:'ENO50549198EG', statusText:'تم تسجيل الشحنة', normalizedStatus:'shipped', location:'مكتب القاهرة', eventAt:'2026-10-11T12:00:00.000Z', eventFingerprint:'a' },
      { id:'T3', shipmentId:'SH-0001', trackingNumber:'ENO50549198EG', statusText:'الشحنة مع مندوب التوصيل', normalizedStatus:'out_for_delivery', location:'منطقة توزيع ابو حماد', eventAt:'2026-10-13T08:00:00.000Z', eventFingerprint:'b' },
      { id:'T4', shipmentId:'SH-0001', trackingNumber:'ENO50549198EG', statusText:'غير واضح', normalizedStatus:'unknown', eventAt:'2026-10-13T09:00:00.000Z', eventFingerprint:'c' }
    ];

    // ---- Pure module.
    const normalizePhone = value => { const d = String(value).replace(/\D/g, ''); return /^01\d{9}$/.test(d) ? d : ''; };
    const find = (reference, phone) => OrderTracking.trackOrders(db, { reference, phone }, { normalizePhone });
    assert.equal(find('ORD-0007', '01001234567').length, 1);
    assert.equal(find('ord-7', '01001234567')[0].orderId, 'ORD-0007', 'order number without padding');
    assert.equal(find('ORD-٠٠٠٧', '01001234567').length, 1, 'Arabic digits');
    assert.equal(find('eno50549198eg', '01001234567')[0].orderId, 'ORD-0007', 'tracking code, any case');
    assert.equal(find('ENO11111111EG', '01001234567').length, 1, 'previous tracking code');
    assert.equal(find('ORD-0007', '01112223333').length, 1, 'customer alternative phone');
    assert.equal(find('ORD-0007', '01009998888').length, 0, 'wrong phone looks like no order');
    assert.equal(find('ORD-0099', '01001234567').length, 0);
    assert.equal(find('ORD-0011', '01001234567').length, 0, 'deleted order hidden');
    assert.equal(find('', '01001234567').length, 0);
    assert.equal(find('ORD-0007', '').length, 0);
    console.log('PASS reference and phone must both match (order no., tracking code, previous code, alt phone)');

    const shipped = find('ORD-0007', '01001234567')[0];
    assert.equal(shipped.step, 'out_for_delivery');
    assert.deepEqual(shipped.lines, [{ name:'كتاب B0001', qty:2 }, { name:'كتاب B0002', qty:1 }]);
    assert.equal(shipped.total, 235); assert.equal(shipped.paid, 100); assert.equal(shipped.remaining, 135);
    assert.equal(shipped.shipment.trackingNumber, 'ENO50549198EG');
    assert.deepEqual(shipped.events.map(event => event.text), ['الشحنة مع مندوب التوصيل', 'تم تسجيل الشحنة'], 'newest first, duplicates and unknown dropped');
    const text = JSON.stringify(shipped);
    for (const secret of ['عميل سري', 'شارع سري', '01001234567', 'مدينة نصر', '"cost"', 'INV-0001']) assert.ok(!text.includes(secret), `reply must not include ${secret}`);
    assert.equal(find('ORD-0008', '01001234567')[0].step, 'preorder');
    assert.deepEqual(find('ORD-0008', '01001234567')[0].waiting, [{ name:'كتاب B0003', qty:1 }]);
    assert.equal(find('ORD-0010', '01001234567')[0].step, 'cancelled');
    assert.equal(find('ORD-0009', '01009998888')[0].step, 'received');
    console.log('PASS customer-safe reply with steps, books, totals and carrier events');

    // ---- HTTP: signed only, POST body, rate-limited.
    const on = await H.startSystem({ db, env:H.integrationEnv(null), name:'tracking-' }); servers.push(on);
    let r = await fetch(on.base + '/api/integration/v1/track', { method:'POST', body:JSON.stringify({ reference:'ORD-0007', phone:'01001234567' }) });
    assert.equal(r.status, 401, 'unsigned request refused');
    r = await track(on.base, { reference:'ORD-0007', phone:'01001234567' });
    assert.equal(r.status, 200);
    let body = await r.json();
    assert.equal(body.ok, true); assert.equal(body.orders.length, 1); assert.equal(body.orders[0].step, 'out_for_delivery');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    r = await track(on.base, { reference:'ORD-0007', phone:'01009998888' });
    assert.deepEqual((await r.json()).orders, []);
    r = await H.signedFetch(on.base, '/api/integration/v1/track', { method:'POST', body:'not json' });
    assert.equal(r.status, 400);
    console.log('PASS signed POST /api/integration/v1/track (401 unsigned, 400 bad body, empty for wrong phone)');
    let limited = 0;
    for (let i = 0; i < 125; i += 1) { r = await track(on.base, { reference:'ORD-0099', phone:'01001234567' }); if (r.status === 429) limited += 1; await r.arrayBuffer(); }
    assert.ok(limited > 0, 'global per-minute cap');
    console.log('PASS tracking endpoint is rate limited');
    console.log('PASS order tracking checks completed');
  } finally {
    for (const server of servers) server.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
