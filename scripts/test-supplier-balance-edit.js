'use strict';
// Direct supplier debt edits (edit-supplier-balance): who may add one through a page save, and that old edits stay.
const assert = require('node:assert/strict');
const H = require('./integration-test-helpers.js');
const pass = name => console.log(`PASS ${name}`);

(async () => {
  let system;
  try {
    const db = H.fixtureDb();
    db.suppliers = [{ id: 'S001', name: 'مورد', phone: '01010000001', balance: 1000 }];
    system = await H.startSystem({ db, name: 'supplier-balance-' });
    const put = async (username, change) => {
      const page = (await system.api('/api/db', { username })).body;
      change(page);
      return system.api('/api/db', { username, method: 'PUT', body: page, headers: { 'If-Match': String(system.readDb().meta.dataRevision) } });
    };
    const edit = (before, after) => page => {
      const supplier = page.suppliers[0];
      supplier.balanceAdjustments = [...(supplier.balanceAdjustments || []), { id: `SBA-${after}`, date: '2026-10-31T00:00:00.000Z', before, after, delta: after - before, reason: 'تسوية', createdBy: 'x', createdByUsername: 'x' }];
      supplier.balance = after;
    };

    let r = await put('accountant', edit(1000, 900));
    assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(system.readDb().suppliers[0].balance, 1000);
    pass('an accountant without the permission cannot edit a supplier debt directly');

    r = await put('manager', edit(1000, 800));
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(system.readDb().suppliers[0].balance, 800);
    pass('a manager edits a supplier debt directly by default');

    r = await put('owner', edit(800, 750));
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(system.readDb().suppliers[0].balanceAdjustments.length, 2);
    pass('the owner edits a supplier debt directly');

    r = await put('owner', page => { page.suppliers[0].balanceAdjustments.shift(); });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, 'SUPPLIER_BALANCE_HISTORY_PROTECTED');
    r = await put('owner', page => { page.suppliers[0].balanceAdjustments[0].reason = 'غير'; });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    pass('old debt edits cannot be removed or changed, even by the owner');

    r = await put('owner', page => { page.settings.permissions.roles['محاسب'] = { views: ['dashboard', 'parties'], actions: ['edit-supplier-balance'] }; });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await put('accountant', edit(750, 700));
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(system.readDb().suppliers[0].balance, 700);
    pass('a role given the permission can edit a supplier debt directly');
  } catch (error) {
    console.error(error); if (system) console.error(system.output().slice(-2000)); process.exitCode = 1;
  } finally {
    system?.stop();
  }
})();
