'use strict';
// The order form inside the Chatwood panel (beside the conversation): suggestions read from the customer's messages,
// the form data endpoint, the editable-order endpoint with its block reasons, and an order created and paid through
// the same calls the panel makes (linked to the conversation by the verified context token).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const H = require('./integration-test-helpers.js');
const S = require('../app/integrations/chatwood-suggest.js');
const pass = name => console.log(`PASS ${name}`);

const books = [['B016', 'مندليف كيميا 3ث'], ['B036', 'نيوتن اسأله 3ث'], ['B037', 'نيوتن اسأله 2ث'], ['B011', 'الوافي رياضيات 3ث'], ['B013', 'المعاصر انجليزي 3ث'], ['B041', 'الامتحان فيزياء 3ث'], ['B040', 'الامتحان فيزياء 2ث']].map(([id, name]) => ({ id, name }));
const message = (content, type = 0, extra = {}) => ({ content, message_type: type, created_at: message.at = (message.at || 0) + 1, ...extra });

{
  const found = S.extract([
    message('السلام عليكم'), message('عندنا نيوتن تانية وتالتة ومعاصر', 1), message('ملاحظة داخلية: انجليزي', 0, { private: true }),
    message('عاوز كيمياء تالتة ثانوي ونيوتن'), message('ومعاهم فيزيا الامتحان'), message('الاسم: أحمد محمود علي'),
    message('العنوان: مدينة نصر شارع عباس العقاد عمارة 12'), message('رقمي التاني ٠١١٢٣٤٥٦٧٨٩')
  ], { books, knownPhone: '01011110001' });
  assert.equal(found.name, 'أحمد محمود علي');
  assert.deepEqual(found.phones, ['01123456789']);
  assert.equal(found.governorate, 'القاهرة'); assert.equal(found.city, 'مدينة نصر');
  assert.equal(found.address, 'مدينة نصر شارع عباس العقاد عمارة 12', 'the «العنوان:» label is dropped');
  assert.deepEqual(found.books.map(book => book.id).sort(), ['B016', 'B036', 'B041'], 'grade from the conversation picks the 3ث editions; staff and private messages are ignored');
  pass('suggestions from the customer messages only, with the conversation grade');
}
{
  // Real shapes from WhatsApp: one message with a line each, and one line with labels.
  let found = S.extract([message('عايزه نسخه واحده\nجونير رأفت شحاته\n01200011420\n01204768335\nمحافظة المنيا مركز ابو قرقاص مدينه الفكريه عماره الميري بجانب البنك الزراعي')], { books, knownPhone: '01204768335' });
  assert.equal(found.name, 'جونير رأفت شحاته'); assert.deepEqual(found.phones, ['01200011420']); assert.equal(found.governorate, 'المنيا');
  assert.match(found.address, /^محافظة المنيا مركز ابو قرقاص/);
  found = S.extract([message('الاسم: علاء حسن خيرالدين رقم موبايل: 01501580147 رقم تاني 01515377135 العنوان: الجيزة فيصل شارع العشرين عمارة 5')], { books, knownPhone: '01501580147' });
  assert.equal(found.name, 'علاء حسن خيرالدين', 'the name stops before «رقم»');
  assert.equal(found.address, 'الجيزة فيصل شارع العشرين عمارة 5', 'only the part after «العنوان»');
  assert.equal(found.governorate, 'الجيزة'); assert.equal(found.city, 'فيصل'); assert.deepEqual(found.phones, ['01515377135']);
  assert.equal(S.extract([message('العنوان مدينة نصر شارع عباس العقاد')], { books }).address, 'مدينة نصر شارع عباس العقاد', 'the «العنوان» label is dropped without a colon too');
  pass('line-by-line and labelled messages give the right name, phones and address');
}
{
  const search = query => S.searchBooks(query, books, 3).map(book => book.id);
  assert.deepEqual(search('نيوت').sort(), ['B036', 'B037']);
  assert.deepEqual(search('فيزياء 3 ثانوي'), ['B041']);
  assert.deepEqual(search('انجلش'), ['B013']);
  assert.deepEqual(search('ماث تالتة ثانوي'), ['B011']);
  assert.deepEqual(search('الوافى'), ['B011']);
  assert.deepEqual(search('زززز'), []);
  pass('book search tolerates partial words, slang and grade wording');
}

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    store.state.conversations.set('30', H.chatwoodConversation(30, { contactId: '9001', contactPhone: '01011110001' }));
    const db = H.fixtureDb();
    db.books = [{ id: 'B0001', name: 'رياضيات 3ث', price: 100, cost: 60, stock: 5, reservedStock: 1, countHoldQty: 1, supplierId: 'S001' }, { id: 'B0002', name: 'فيزياء 3ث', price: 80, cost: 40, stock: 10, reservedStock: 0, supplierId: 'S001' }, { id: 'B0009', name: 'محذوف', price: 1, stock: 1, deletedAt: '2026-10-01T00:00:00.000Z' }];
    db.inventoryBatches = db.books.filter(book => !book.deletedAt).map(book => ({ id: `BATCH-${book.id}`, productId: book.id, bookId: book.id, qty: book.stock, quantity: book.stock, remainingQty: book.stock, unitCost: book.cost, createdAt: '2026-10-01T00:00:00.000Z' }));
    db.settings.shippingRules = { defaultCost: 60, byGovernorate: { 'القاهرة': 35 } };
    system = await H.startSystem({ db, env: { ...H.integrationEnv(store), CHATWOOD_ORIGIN: 'https://chat.example.test' }, name: 'panel-form-' });

    let r = await system.api('/api/integration/v1/panel/order-form', { username: 'warehouse' });
    assert.equal(r.status, 403);
    assert.equal((await system.api('/api/integration/v1/panel/order-form', { token: '' })).status, 401);
    r = await system.api('/api/integration/v1/panel/order-form', { username: 'cashier' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.books.map(book => [book.id, book.available]), [['B0001', 3], ['B0002', 10]], 'free to sell now; deleted books left out');
    assert.equal(r.body.shippingRules.byGovernorate['القاهرة'], 35);
    assert.equal(r.body.defaultShippingCompany, 'البريد المصري');
    assert.ok(r.body.cashAccounts.length && r.body.permissions.receive && r.body.permissions.confirm && !r.body.permissions.discount);
    pass('form data: free stock, shipping rules, carriers, cash accounts and permissions');

    const panel = await system.api('/api/integration/v1/panel/customer?phone=01011110001&conversationId=30&contactId=9001', { username: 'cashier' });
    assert.equal(panel.status, 200, panel.text);
    assert.ok(panel.body.orderContext?.ok && panel.body.orderContext.token, 'a verified conversation gives the form its context token');
    const body = { requestId: 'panel-test-1', chatwoodContext: panel.body.orderContext.token, phone: '01011110001', customerName: 'أحمد', governorate: 'القاهرة', city: 'مدينة نصر', address: 'شارع 1', shippingCompany: 'البريد المصري', shippingCost: 35,
      lines: [{ bookId: 'B0001', qty: 2, discount: 0, discountType: 'percent', discountScope: 'unit' }], orderDiscount: 0, paymentPlan: 'advance_cod', paymentMethod: 'مقدم + الباقي عند الاستلام', paidAmount: 100, paymentConfirmed: true, cashAccountId: 'CA-003', receiptMethod: 'InstaPay' };
    r = await system.api('/api/orders/quick', { username: 'cashier', method: 'POST', body });
    assert.equal(r.status, 201, r.text);
    const id = r.body.order.id;
    r = await system.api(`/api/orders/${id}/confirm`, { username: 'cashier', method: 'POST', body: {} });
    assert.equal(r.status, 200, r.text);
    const saved = system.readDb().onlineOrders.find(order => order.id === id);
    assert.equal(saved.chatwootConversationId, '30'); assert.equal(saved.chatwoodLink.source, 'verified-context');
    assert.equal(saved.total, 235); assert.equal(saved.paidAmount, 100);
    assert.equal(system.readDb().orderPayments.filter(item => item.orderId === id).length, 1);
    pass('an order made from the panel is linked to the conversation and records the deposit once');

    // Discounts as the panel sends them: per copy and on the order, only with «تعديل خصم النظام».
    const discounted = { ...body, chatwoodContext: '', requestId: 'panel-test-2', paymentPlan: 'cash_on_delivery', paidAmount: 0, paymentConfirmed: false, lines: [{ bookId: 'B0002', qty: 2, discount: 10, discountType: 'percent', discountScope: 'unit' }], orderDiscount: 20, orderDiscountType: 'amount' };
    r = await system.api('/api/orders/quick', { username: 'cashier', method: 'POST', body: discounted });
    assert.equal(r.status, 403, 'the cashier cannot add a discount');
    assert.equal((await system.api('/api/integration/v1/panel/order-form', { username: 'owner' })).body.permissions.discount, true);
    r = await system.api('/api/orders/quick', { username: 'owner', method: 'POST', body: discounted });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.order.total, 2 * 72 - 20 + 35, '10% off each copy, 20 off the order, shipping added');
    pass('book and order discounts follow the discount permission');

    // Required deposit for WhatsApp orders: its own setting (the website's until set), saved on each new order.
    assert.equal(system.readDb().onlineOrders.find(order => order.id === id).depositRequired, 100, 'starts as the website default');
    const revision = String(system.readDb().meta.dataRevision);
    assert.equal((await system.api('/api/settings/whatsapp-deposit', { username: 'cashier', method: 'PUT', body: { depositDefault: 70, expectedRevision: revision } })).status, 403);
    r = await system.api('/api/settings/whatsapp-deposit', { username: 'owner', method: 'PUT', body: { depositDefault: 70, expectedRevision: revision } });
    assert.equal(r.status, 200, r.text);
    assert.equal(system.readDb().settings.whatsappOrders.depositDefault, 70); assert.equal(system.readDb().settings.websiteOrders?.depositDefault ?? 100, 100, 'the website default is untouched');
    assert.equal((await system.api('/api/integration/v1/panel/order-form', { username: 'cashier' })).body.depositRequired, 70);
    r = await system.api('/api/orders/quick', { username: 'owner', method: 'POST', body: { ...body, chatwoodContext: '', requestId: 'panel-test-3', paymentPlan: 'cash_on_delivery', paidAmount: 0, paymentConfirmed: false } });
    assert.equal(r.body.order.depositRequired, 70);
    pass('WhatsApp orders have their own required deposit, saved on each new order');

    // A further payment: recorded once, never above the total, and the order follows.
    const pay = extra => system.api(`/api/orders/${id}/payments`, { username: 'cashier', method: 'POST', body: { amount: 50, cashAccountId: 'CA-003', paymentMethod: 'InstaPay', operationKey: 'second-1', ...extra } });
    assert.equal((await system.api(`/api/orders/${id}/payments`, { username: 'warehouse', method: 'POST', body: { amount: 50, cashAccountId: 'CA-003', operationKey: 'x' } })).status, 403);
    r = await pay(); assert.equal(r.status, 201, r.text);
    assert.equal(r.body.order.paidAmount, 150); assert.equal(r.body.order.remainingAmount, 85);
    r = await pay(); assert.equal(r.status, 200); assert.equal(r.body.existing, true);
    const after = system.readDb();
    assert.equal(after.orderPayments.filter(item => item.orderId === id && item.status !== 'reversed').length, 2);
    assert.equal(after.cash.filter(item => item.orderId === id && item.category === 'دفعة طلب').length, 2, 'one cash row per payment');
    r = await pay({ amount: 500, operationKey: 'too-much' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'AMOUNT_EXCEEDS_REMAINING');
    r = await pay({ cashAccountId: '', operationKey: 'no-account' }); assert.equal(r.status, 400);
    pass('a further payment is recorded once, within the remaining amount, with its cash row');

    r = await system.api(`/api/integration/v1/panel/order?id=${id}`, { username: 'warehouse' });
    assert.equal(r.status, 403);
    r = await system.api(`/api/integration/v1/panel/order?id=${id}`, { username: 'cashier' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.editBlock, '');
    assert.match(r.body.cancelBlock, /دفعة/, 'a paid order is cancelled from the System with the refund');
    assert.deepEqual(r.body.order.lines.map(line => [line.bookId, line.qty, line.reserved]), [['B0001', 2, 2]]);
    assert.equal(r.body.order.paidAmount, 150); assert.equal(r.body.order.packed, false); assert.equal(r.body.order.website, false);
    assert.equal((await system.api('/api/integration/v1/panel/order?id=ORD-9999', { username: 'cashier' })).status, 404);
    pass('editable order with its reserved copies and the reasons edit/cancel are not offered');

    const delivered = system.readDb();
    Object.assign(delivered.onlineOrders.find(order => order.id === id), { workflowStage: 'delivered', status: 'تم التسليم' });
    fs.writeFileSync(system.dbFile, JSON.stringify(delivered));
    r = await system.api(`/api/integration/v1/panel/order?id=${id}`, { username: 'cashier' });
    assert.match(r.body.editBlock, /اتسلّم/); assert.match(r.body.cancelBlock, /مرتجع/);
    pass('a delivered order says why it cannot be edited or cancelled');

    const html = (await (await fetch(`${system.base}/integrations/chatwood-panel`)).text());
    for (const src of ['/order-finance.js?v=', '/integrations/chatwood-suggest.js?v=', '/integrations/chatwood-panel.js?v=']) assert.ok(html.includes(src), src);
    const suggest = await fetch(`${system.base}/integrations/chatwood-suggest.js`);
    assert.equal(suggest.status, 200);
    const finance = await fetch(`${system.base}/order-finance.js`);
    assert.equal(finance.status, 200);
    pass('the panel page loads the suggestions and the System price calculation with the build version');

    const panelSource = fs.readFileSync(path.join(__dirname, '../app/integrations/chatwood-panel.js'), 'utf8');
    for (const call of ['/api/integration/v1/panel/order-form', '/reopen-for-edit', '/quick`, { method: "PATCH"', 'customerRequestedEdit', '/cancel`', 'chatwoot-dashboard-app:fetch-info']) assert.ok(panelSource.includes(call), call);
    pass('the panel form uses the System order endpoints');
    console.log('chatwood panel form: all checks passed');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().split('\n').slice(-20).join('\n')); process.exitCode = 1;
  } finally { system?.stop(); await store?.close(); }
})();
