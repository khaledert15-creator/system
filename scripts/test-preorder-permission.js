'use strict';
// «يسمح بالحجز المسبق» is changed only with book.preorder.manage, and the change reaches the Store catalog at once.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');

(async () => {
  let system, store;
  try {
    store = await H.startMockStore();
    system = await H.startSystem({ env:H.integrationEnv(store), name:'preorder-permission-' });
    const save = async (username, mutate) => {
      const token = await system.login(username);
      const revision = (await (await fetch(`${system.base}/api/live-revision`, { headers:{ 'X-Session-Token':token } })).json()).revision;
      const db = (await system.api('/api/db', { username })).body;
      mutate(db);
      return system.api('/api/db', { username, method:'PUT', body:db, headers:{ 'If-Match':revision } });
    };
    const catalogBook = async id => (await (await H.signedFetch(system.base, '/api/integration/v1/catalog')).json()).books.find(book => book.id === id);

    assert.equal((await catalogBook('B0001')).allowPreorder, false);
    let r = await save('cashier', db => { db.books.find(book => book.id === 'B0001').allowPreorder = true; });
    assert.equal(r.status, 403, r.text); assert.equal(r.body.code, 'PREORDER_PERMISSION_DENIED'); assert.equal(r.body.bookId, 'B0001');
    r = await save('warehouse', db => { db.books.find(book => book.id === 'B0003').allowPreorder = false; });
    assert.equal(r.status, 403, 'turning it off is also restricted');
    assert.equal((await catalogBook('B0001')).allowPreorder, false);
    console.log('PASS other roles cannot change the pre-order permission');

    r = await save('cashier', db => { db.books.find(book => book.id === 'B0001').shelf = 'رف QA'; });
    assert.equal(r.status, 200, r.text);
    console.log('PASS other book edits by other roles are unaffected');

    r = await save('manager', db => { db.books.find(book => book.id === 'B0001').allowPreorder = true; });
    assert.equal(r.status, 200, r.text);
    assert.equal((await catalogBook('B0001')).allowPreorder, true, 'the Store catalog shows the new value immediately');
    r = await save('owner', db => { db.books.find(book => book.id === 'B0001').allowPreorder = false; });
    assert.equal(r.status, 200, r.text);
    assert.equal((await catalogBook('B0001')).allowPreorder, false);
    console.log('PASS owner and manager change it and the integration catalog reflects it');

    // A role customised with the action may change it.
    r = await save('owner', db => { db.settings.permissions = { roles:{ 'كاشير':{ actions:['book.preorder.manage'] } }, users:{} }; });
    assert.equal(r.status, 200, r.text);
    r = await save('cashier', db => { db.books.find(book => book.id === 'B0001').allowPreorder = true; });
    assert.equal(r.status, 200, r.text);
    console.log('PASS a role granted book.preorder.manage may change it');
    console.log('preorder permission tests passed');
  } catch (error) {
    console.error(`FAIL ${error.stack || error.message}`);
    if (system) console.error(system.output().slice(-2000));
    process.exitCode = 1;
  } finally {
    system?.stop();
    await store?.close();
  }
})();
