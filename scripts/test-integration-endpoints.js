'use strict';
// HMAC endpoints the Store calls (§2), the website deposit setting, server-owned fields in PUT /api/db and the
// frame-ancestors policy of the Chatwood panel page.
const assert = require('node:assert/strict'), http = require('node:http');
const H = require('./integration-test-helpers.js');

function openEvents(base, { now } = {}) {
  const pathWithQuery = '/api/integration/v1/events';
  const headers = H.IntegrationAuth.signedHeaders({ secret:H.SECRET, keyId:'store-v1', method:'GET', pathWithQuery, now });
  const events = [];
  let resolveStatus;
  const statusPromise = new Promise(resolve => { resolveStatus = resolve; });
  const req = http.request(base + pathWithQuery, { headers }, res => {
    resolveStatus(res.statusCode);
    let buffer = '';
    res.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = frame.split('\n').find(line => line.startsWith('data:'));
        if (data) events.push({ event:(frame.split('\n').find(line => line.startsWith('event:')) || '').slice(6).trim(), data:JSON.parse(data.slice(5)) });
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return { events, status:statusPromise, close:() => req.destroy() };
}

(async () => {
  const servers = [];
  try {
    // ---- Integration disabled: every integration endpoint answers 503, nothing else changes.
    const off = await H.startSystem({ env:{ INTEGRATION_SHARED_SECRET:undefined, STORE_INTEGRATION_BASE_URL:undefined }, name:'integration-off-' }); servers.push(off);
    let r = await H.signedFetch(off.base, '/api/integration/v1/catalog');
    assert.equal(r.status, 503); assert.equal((await r.json()).code, 'INTEGRATION_DISABLED');
    assert.equal((await off.api('/api/website-orders')).body.code, 'INTEGRATION_DISABLED');
    assert.equal((await off.api('/api/integration/v1/panel/customer?phone=01001234567')).status, 503);
    assert.equal((await off.api('/api/health', { token:'' })).status, 200);
    console.log('PASS integration disabled → 503 INTEGRATION_DISABLED');

    // ---- Integration enabled.
    const db = H.fixtureDb();
    db.books[0].reservedStock = 2; db.books[0].countHoldQty = 1; // available = 5 - 2 - 1 = 2
    db.onlineOrders.push({ id:'ORD-0007', websiteOrderNumber:'MK261020-00007', websiteOrderId:7, integrationId:'2b0d6a5e-1111-4a2b-9c3d-000000000007', customerId:'C0001', customerName:'x', phone:'01001234567', workflowStage:'shipped', status:'تم الشحن', total:235, paidAmount:100, remainingAmount:135, paymentStatus:'partially_paid', depositAmount:100, shipmentId:'SH-0001', chatwootConversationId:'55', createdAt:'2026-10-10T10:00:00.000Z', updatedAt:'2026-10-10T10:00:00.000Z', lines:[] });
    db.onlineOrders.push({ id:'ORD-0008', customerId:'C0001', customerName:'x', phone:'01001234567', workflowStage:'draft', status:'مسودة', total:10, createdAt:'2026-10-10T10:00:00.000Z', updatedAt:'2026-10-10T10:00:00.000Z', lines:[] });
    db.shipments.push({ id:'SH-0001', onlineOrderId:'ORD-0007', trackingNumber:'EG123456789EG', normalizedStatus:'in_transit', company:'البريد المصري', updatedAt:'2026-10-12T08:00:00.000Z' });
    const on = await H.startSystem({ db, env:H.integrationEnv(null), name:'integration-on-' }); servers.push(on);

    r = await fetch(on.base + '/api/integration/v1/catalog');
    assert.equal(r.status, 401); assert.equal((await r.json()).code, 'INTEGRATION_AUTH_FAILED');
    r = await H.signedFetch(on.base, '/api/integration/v1/catalog', { secret:'wrong-secret-0123456789abcdef0123456789' });
    assert.equal(r.status, 401);
    r = await H.signedFetch(on.base, '/api/integration/v1/catalog', { keyId:'system-v1' });
    assert.equal(r.status, 401, 'the System does not accept its own key id from the peer');
    r = await H.signedFetch(on.base, '/api/integration/v1/catalog', { now:Date.now() - 301000 });
    assert.equal(r.status, 401, 'stale timestamp');
    const nonce = `replay-${Date.now()}-abcdef`;
    r = await H.signedFetch(on.base, '/api/integration/v1/catalog', { nonce });
    assert.equal(r.status, 200);
    r = await H.signedFetch(on.base, '/api/integration/v1/catalog', { nonce });
    assert.equal(r.status, 401, 'replayed nonce');
    const tampered = H.IntegrationAuth.signedHeaders({ secret:H.SECRET, keyId:'store-v1', method:'GET', pathWithQuery:'/api/integration/v1/catalog' });
    r = await fetch(on.base + '/api/integration/v1/website-orders/links', { headers:tampered });
    assert.equal(r.status, 401, 'a signature for another path is refused');
    assert.ok(!on.output().includes(H.SECRET), 'secret never logged');
    console.log('PASS signed endpoints reject missing, bad, wrong-key, stale, replayed and re-pathed signatures');

    r = await H.signedFetch(on.base, '/api/integration/v1/catalog');
    const catalog = await r.json();
    assert.equal(catalog.ok, true); assert.match(catalog.revision, /^\d+$/); assert.equal(catalog.settings.websiteDepositDefault, 100);
    const b1 = catalog.books.find(book => book.id === 'B0001');
    assert.deepEqual(Object.keys(b1).sort(), ['allowPreorder', 'available', 'barcode', 'countHoldQty', 'deleted', 'extraBarcode', 'id', 'name', 'price', 'reservedStock', 'sku', 'stock', 'updatedAt'].sort());
    assert.equal(b1.available, 2); assert.equal(b1.allowPreorder, false); assert.equal(b1.price, 100);
    assert.ok(!/"cost"|purchaseListPrice|lastPurchasePrice|supplierId/.test(JSON.stringify(catalog)), 'no cost or supplier fields');
    assert.equal(catalog.books.find(book => book.id === 'B0003').allowPreorder, true);
    assert.equal(catalog.books.find(book => book.id === 'B0099').deleted, true, 'deleted books are listed as deleted');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    console.log('PASS catalog has no cost/supplier fields and available = stock − reserved − countHold');

    r = await H.signedFetch(on.base, '/api/integration/v1/website-orders/links');
    let links = await r.json();
    assert.equal(links.links.length, 1, 'only orders that came from the website');
    assert.deepEqual({ ...links.links[0], updatedAt:undefined }, { websiteOrderNumber:'MK261020-00007', websiteOrderId:7, integrationId:'2b0d6a5e-1111-4a2b-9c3d-000000000007', salesOrderId:'ORD-0007', workflowStage:'shipped', status:'تم الشحن', total:235, depositAmount:100, paidAmount:100, remainingAmount:135, paymentStatus:'partially_paid', shipment:{ id:'SH-0001', trackingNumber:'EG123456789EG', status:'in_transit', statusLabel:'في مرحلة نقل', carrier:'البريد المصري' }, cancelled:false, chatwootConversationId:'55', updatedAt:undefined });
    assert.equal(links.links[0].updatedAt, '2026-10-12T08:00:00.000Z', 'updatedAt includes shipment changes');
    r = await H.signedFetch(on.base, `/api/integration/v1/website-orders/links?updatedSince=${encodeURIComponent('2026-10-13T00:00:00.000Z')}`);
    assert.equal((await r.json()).links.length, 0);
    r = await H.signedFetch(on.base, `/api/integration/v1/website-orders/links?updatedSince=${encodeURIComponent('2026-10-12T08:00:00.000Z')}`);
    assert.equal((await r.json()).links.length, 1);
    r = await H.signedFetch(on.base, '/api/integration/v1/website-orders/links?updatedSince=not-a-date');
    assert.equal(r.status, 400);
    console.log('PASS website-orders/links lists website orders with shipment and honours updatedSince');

    // ---- SSE: revision on connect, then after a successful write.
    const stream = openEvents(on.base);
    assert.equal(await stream.status, 200);
    await H.until(() => stream.events.length >= 1, 'first SSE event');
    assert.equal(stream.events[0].event, 'revision');
    const startRevision = Number(stream.events[0].data.revision);
    const badStream = openEvents(on.base, { now:Date.now() - 400000 });
    assert.equal(await badStream.status, 401); badStream.close();

    // ---- Website deposit default (owner/manager, audited, 0–10000, expectedRevision).
    const revision = String(on.readDb().meta.dataRevision);
    assert.equal((await on.api('/api/settings/website-deposit', { method:'PUT', token:'', body:{ depositDefault:150, expectedRevision:revision } })).status, 401);
    assert.equal((await on.api('/api/settings/website-deposit', { username:'cashier', method:'PUT', body:{ depositDefault:150, expectedRevision:revision } })).status, 403);
    assert.equal((await on.api('/api/settings/website-deposit', { username:'accountant', method:'PUT', body:{ depositDefault:150, expectedRevision:revision } })).status, 403);
    assert.equal((await on.api('/api/settings/website-deposit', { username:'manager', method:'PUT', body:{ depositDefault:150 } })).status, 428);
    assert.equal((await on.api('/api/settings/website-deposit', { username:'manager', method:'PUT', body:{ depositDefault:150, expectedRevision:'999' } })).body.code, 'DB_REVISION_CONFLICT');
    assert.equal((await on.api('/api/settings/website-deposit', { username:'manager', method:'PUT', body:{ depositDefault:10001, expectedRevision:revision } })).status, 400);
    assert.equal((await on.api('/api/settings/website-deposit', { username:'manager', method:'PUT', body:{ depositDefault:-1, expectedRevision:revision } })).status, 400);
    const saved = await on.api('/api/settings/website-deposit', { username:'manager', method:'PUT', body:{ depositDefault:150, expectedRevision:revision } });
    assert.equal(saved.status, 200, saved.text); assert.equal(saved.body.depositDefault, 150); assert.equal(saved.body.previous, 100);
    let stored = on.readDb();
    assert.equal(stored.settings.websiteOrders.depositDefault, 150);
    assert.ok(stored.audit.some(row => row.operationType === 'WEBSITE_DEPOSIT_DEFAULT_CHANGED' && row.username === 'manager'), 'audited');
    assert.equal((await (await H.signedFetch(on.base, '/api/integration/v1/catalog')).json()).settings.websiteDepositDefault, 150);
    console.log('PASS website deposit default: owner/manager only, 428 without revision, 409 stale, 0–10000, audited');

    await H.until(() => stream.events.some(event => Number(event.data.revision) > startRevision), 'SSE event after write');
    assert.equal(Number(stream.events.at(-1).data.revision), Number(stored.meta.dataRevision));
    stream.close();
    console.log('PASS events stream sends the revision on connect and after a successful write');

    // ---- PUT /api/db cannot change server-owned website fields.
    const full = await on.api('/api/db');
    const client = full.body;
    client.settings.websiteOrders = { depositDefault:1 };
    client.onlineOrders.find(order => order.id === 'ORD-0007').websiteOrderNumber = 'MK261020-99999';
    client.onlineOrders.find(order => order.id === 'ORD-0008').websiteOrderNumber = 'MK261020-88888';
    client.onlineOrders.push({ id:'ORD-0009', customerId:'C0001', customerName:'y', phone:'01001234567', workflowStage:'draft', status:'مسودة', websiteOrderNumber:'MK261020-77777', total:0, lines:[] });
    const put = await on.api('/api/db', { method:'PUT', body:client, headers:{ 'If-Match':full.headers.get('x-db-revision') } });
    assert.equal(put.status, 200, put.text);
    stored = on.readDb();
    assert.equal(stored.settings.websiteOrders.depositDefault, 150);
    assert.equal(stored.onlineOrders.find(order => order.id === 'ORD-0007').websiteOrderNumber, 'MK261020-00007');
    assert.equal(stored.onlineOrders.find(order => order.id === 'ORD-0008').websiteOrderNumber, undefined);
    assert.equal(stored.onlineOrders.find(order => order.id === 'ORD-0009').websiteOrderNumber, undefined);
    console.log('PASS PUT /api/db keeps the deposit default and website link fields server-owned');

    // ---- frame-ancestors: only the panel page may be framed by Chatwood.
    let page = await fetch(on.base + '/integrations/chatwood-panel');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self' https://chat.maktabaa.com");
    assert.equal(page.headers.get('x-frame-options'), null);
    assert.match(await page.text(), /<meta name="chatwood-origin" content="https:\/\/chat\.maktabaa\.com">/);
    page = await fetch(on.base + '/');
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self'"); assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    page = await fetch(on.base + '/integrations/chatwood-panel.html');
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self'", 'the raw static file is not framable');
    assert.equal((await fetch(on.base + '/integrations/chatwood-panel.js')).status, 200);
    const custom = await H.startSystem({ env:{ ...H.integrationEnv(null), CHATWOOD_ORIGIN:'https://chat.example.test' }, name:'integration-origin-' }); servers.push(custom);
    page = await fetch(custom.base + '/integrations/chatwood-panel');
    assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self' https://chat.example.test");
    assert.equal((await fetch(custom.base + '/')).headers.get('content-security-policy'), "frame-ancestors 'self'");
    console.log("PASS panel page allows frame-ancestors CHATWOOD_ORIGIN; every other page keeps 'self'");
    console.log('PASS integration endpoint checks completed');
  } finally {
    for (const server of servers) server.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
