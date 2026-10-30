'use strict';
// After an order is booked from a Chatwood conversation, the System names the conversation's contact after the
// customer when Chatwood has only a stand-in («John Doe», empty, a phone number), adds the phone when the contact has
// none, never replaces a real name, and never lets a Chatwood failure touch the booking. Isolated System + mock
// Store + mock Chatwood API.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const H = require('./integration-test-helpers.js');
const ChatwoodContact = require('../app/chatwood-contact.js');

const TOKEN = 'chatwood-test-token-123456';

async function startMockChatwood(contacts) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const match = req.url.match(/^\/api\/v1\/accounts\/7\/contacts\/(\d+)$/);
    requests.push({ method:req.method, contactId:match?.[1], token:req.headers.api_access_token, body:body ? JSON.parse(body) : null });
    const contact = match && contacts[match[1]];
    const reply = (status, payload) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.headers.api_access_token !== TOKEN) return reply(401, { error:'unauthorized' });
    if (!contact || contact.broken) return reply(contact ? 500 : 404, { error:'nope' });
    if (req.method === 'GET') return reply(200, { payload:{ id:Number(match[1]), ...contact } });
    const update = JSON.parse(body);
    if (update.phone_number === '+201088880008') return reply(422, { message:'Phone number has already been taken' });
    Object.assign(contact, update);
    return reply(200, { payload:{ id:Number(match[1]), ...contact } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base:`http://127.0.0.1:${server.address().port}`, requests, contacts, close:() => new Promise(resolve => server.close(resolve)) };
}

(async () => {
  let system, store, chatwood;
  try {
    // ---- The rule, without a server.
    assert.deepEqual(['', '  ', 'John Doe', 'john doe', '+20 101 111 0001', '01011110001'].map(ChatwoodContact.isPlaceholderName), [true, true, true, true, true, true]);
    assert.deepEqual(['منى عادل', 'Ahmed', 'John'].map(ChatwoodContact.isPlaceholderName), [false, false, false]);
    const events = [];
    const offline = { chatwoodContactsEnabled:true, chatwoodApiUrl:'http://127.0.0.1:9', chatwoodAccountId:'7', chatwoodApiToken:TOKEN, chatwoodTimeoutMs:500 };
    const failed = await ChatwoodContact.nameContactFromOrder(offline, { contactId:'1', name:'منى', phone:'01077770007' }, { fetch:async () => { throw new Error('connect refused'); }, log:event => events.push(event) });
    assert.deepEqual([failed.ok, events[0].operationType, events[0].contactId], [false, 'CHATWOOD_CONTACT_NAME_FAILED', '1']);
    assert.ok(!JSON.stringify(events).includes('01077770007'), 'phones are not logged');
    assert.deepEqual(await ChatwoodContact.nameContactFromOrder({ ...offline, chatwoodContactsEnabled:false }, { contactId:'1', name:'منى' }), { skipped:true });
    console.log('PASS placeholder names are recognised; a failure is logged without phones and reported, never thrown');

    chatwood = await startMockChatwood({
      9200:{ name:'John Doe', phone_number:null },          // Messenger: placeholder, no phone
      9300:{ name:'+201033330003', phone_number:null },      // a phone number as the name
      9400:{ name:'', phone_number:null },                   // empty name; its phone is taken by another contact
      9001:{ name:'أحمد سمير', phone_number:'+201011110001' }, // WhatsApp contact named by an agent
      9500:{ broken:true },                                   // Chatwood fails
    });
    store = await H.startMockStore();
    const messenger = (id, contactId) => H.chatwoodConversation(id, { channel:'Channel::FacebookPage', contactId, contactPhone:null });
    store.state.conversations.set('8200', messenger('8200', '9200'));
    store.state.conversations.set('8300', messenger('8300', '9300'));
    store.state.conversations.set('8400', messenger('8400', '9400'));
    store.state.conversations.set('8500', messenger('8500', '9500'));
    store.state.conversations.set('8001', H.chatwoodConversation('8001'));
    system = await H.startSystem({ env:H.integrationEnv(store, { CHATWOOD_API_URL:chatwood.base, CHATWOOD_ACCOUNT_ID:'7', CHATWOOD_API_TOKEN:TOKEN }), name:'chatwood-contact-name-' });
    const context = async (conversationId, contactId) => (await system.api(`/api/integration/v1/panel/customer?${new URLSearchParams({ conversationId, contactId })}`)).body.orderContext.token;
    const book = async (conversationId, contactId, customerName, phone) => {
      const r = await system.api('/api/orders/quick', { method:'POST', body:{ duplicateOverrideReason:'اختبار', customerName, phone, governorate:'القاهرة', city:'مدينة نصر', address:'شارع الاختبار 5', shippingCost:35, lines:[{ bookId:'B0001', qty:1 }], requestId:crypto.randomUUID(), chatwoodContext:await context(conversationId, contactId) } });
      assert.equal(r.status, 201, r.text);
      return r.body.order;
    };
    const patches = id => chatwood.requests.filter(row => row.method === 'PATCH' && row.contactId === id);

    await book('8200', '9200', 'منى عادل', '01077770007');
    await H.until(() => chatwood.contacts[9200].name === 'منى عادل', 'Messenger contact named');
    assert.equal(chatwood.contacts[9200].phone_number, '+201077770007');
    assert.ok(chatwood.requests.every(row => row.token === TOKEN));
    console.log('PASS a «John Doe» Messenger contact takes the customer name and the typed phone');

    await book('8300', '9300', 'سارة محمود', '01033330003');
    await H.until(() => chatwood.contacts[9300].name === 'سارة محمود', 'phone-named contact renamed');
    console.log('PASS a contact named only by a phone number is renamed');

    await book('8400', '9400', 'هالة فؤاد', '01088880008');
    await H.until(() => chatwood.contacts[9400].name === 'هالة فؤاد', 'contact named despite a taken phone');
    assert.deepEqual([patches('9400').length, chatwood.contacts[9400].phone_number], [2, null]);
    console.log('PASS a phone another contact holds is left out; the name is still saved');

    await book('8001', '9001', 'اسم من الطلب', '01022220002');
    await H.until(() => chatwood.requests.some(row => row.method === 'GET' && row.contactId === '9001'), 'named contact read');
    await H.sleep(200);
    assert.deepEqual([patches('9001').length, chatwood.contacts[9001].name], [0, 'أحمد سمير']);
    console.log('PASS a name an agent set is never replaced');

    const kept = await book('8500', '9500', 'عميل', '01099990009');
    await H.until(() => system.output().includes('CHATWOOD_CONTACT_NAME_FAILED'), 'failure logged');
    assert.equal(system.readDb().onlineOrders.find(row => row.id === kept.id).chatwootContactId, '9500');
    console.log('PASS a Chatwood failure is logged and the booking stands');
    console.log('chatwood contact name tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
    await chatwood?.close();
  }
})();
