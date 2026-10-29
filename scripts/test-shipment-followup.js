'use strict';
// Follow-up rules for the shipping employee: when a parcel needs a complaint, when an open complaint needs a
// follow-up, and when "delivered" really means it came back to our warehouse.
const assert = require('node:assert/strict');
const F = require('../app/shipment-followup.js');

const at = text => new Date(text).getTime();
const task = (shipment, options = {}) => F.followUpTask({ id:'SH-1', governorate:'القاهرة', ...shipment }, { statusCode:'in_transit', ...options });

// Fridays are not counted. Thursday 10:00 → Saturday 10:00 Cairo is 48 h on the clock but 24 h of post work.
assert.equal(Math.round(F.hoursWithoutFridays(at('2026-10-22T10:00:00+03:00'), at('2026-10-24T10:00:00+03:00'))), 24);
assert.equal(Math.round(F.hoursWithoutFridays(at('2026-10-19T10:00:00+03:00'), at('2026-10-21T10:00:00+03:00'))), 48);
console.log('PASS hours leave out Fridays');

assert.equal(F.regionOf('أسيوط').key, 'upper');
assert.equal(F.regionOf('اسيوط').key, 'upper', 'spelling without hamza');
assert.equal(F.regionOf('الشرقية').key, 'lower');
assert.equal(F.regionOf('').key, 'lower');
console.log('PASS governorates split into Lower and Upper Egypt');

// Lower Egypt: due after 48 working hours; Upper Egypt waits 72.
const shippedMonday = '2026-10-19T10:00:00+03:00';
assert.equal(task({ shippedAt:shippedMonday }, { now:at('2026-10-21T09:00:00+03:00') }), null);
let result = task({ shippedAt:shippedMonday }, { now:at('2026-10-21T11:00:00+03:00') });
assert.equal(result.kind, 'complaint-due'); assert.equal(result.trigger, 'late'); assert.match(result.reason, /وجه بحري/);
assert.equal(task({ shippedAt:shippedMonday, governorate:'سوهاج' }, { now:at('2026-10-21T11:00:00+03:00') }), null);
assert.equal(task({ shippedAt:shippedMonday, governorate:'سوهاج' }, { now:at('2026-10-22T11:00:00+03:00') }).kind, 'complaint-due');
// The post's first tracking event starts the clock when it is known.
assert.equal(task({ shippedAt:shippedMonday }, { now:at('2026-10-21T11:00:00+03:00'), startedAt:'2026-10-20T10:00:00+03:00' }), null);
console.log('PASS 48 h for Lower Egypt and 72 h for Upper Egypt');

// A delivery attempt asks for a complaint at once; "customer was not home" clears it until something new happens.
result = task({ shippedAt:'2026-10-28T10:00:00+03:00', lastMovementAt:'2026-10-28T15:00:00+03:00' }, { statusCode:'delivery_attempt_1', now:at('2026-10-28T16:00:00+03:00') });
assert.equal(result.kind, 'complaint-due'); assert.equal(result.trigger, 'attempt');
assert.equal(task({ shippedAt:'2026-10-28T10:00:00+03:00', lastMovementAt:'2026-10-28T15:00:00+03:00', complaintWaivedAt:'2026-10-28T16:00:00+03:00' }, { statusCode:'delivery_attempt_1', now:at('2026-10-28T17:00:00+03:00') }), null);
assert.equal(task({ shippedAt:'2026-10-28T10:00:00+03:00', lastMovementAt:'2026-10-29T12:00:00+03:00', complaintWaivedAt:'2026-10-28T16:00:00+03:00' }, { statusCode:'delivery_attempt_2', now:at('2026-10-29T13:00:00+03:00') }).kind, 'complaint-due', 'a new attempt after the waiver');
console.log('PASS a delivery attempt needs a complaint unless the employee recorded why not');

// An open complaint is followed up a day later, then every day; three follow-ups without delivery escalate.
const complaint = { id:'CMP-1', shipmentId:'SH-1', complaintNumber:'C-77', status:'open', createdAt:'2026-10-28T10:00:00+03:00' };
result = task({ shippedAt:shippedMonday }, { complaints:[complaint], now:at('2026-10-28T20:00:00+03:00') });
assert.equal(result.kind, 'complaint-waiting');
result = task({ shippedAt:shippedMonday }, { complaints:[complaint], now:at('2026-10-29T10:30:00+03:00') });
assert.equal(result.kind, 'complaint-follow-up'); assert.equal(result.escalated, false);
const followed = { ...complaint, followUps:[1, 2, 3].map(day => ({ at:`2026-10-${28 + day}T11:00:00+03:00`, note:'x' })) };
assert.equal(task({ shippedAt:shippedMonday }, { complaints:[followed], now:at('2026-10-31T12:00:00+03:00') }).kind, 'complaint-waiting');
result = task({ shippedAt:shippedMonday }, { complaints:[followed], now:at('2026-11-01T12:00:00+03:00') });
assert.equal(result.kind, 'complaint-follow-up'); assert.equal(result.escalated, true);
// A closed complaint restarts the clock instead of asking for a new complaint at once.
assert.equal(task({ shippedAt:shippedMonday }, { complaints:[{ ...complaint, status:'closed', closedAt:'2026-10-29T10:00:00+03:00' }], now:at('2026-10-29T12:00:00+03:00') }), null);
console.log('PASS open complaints are followed up daily and escalate after three follow-ups');

// "Delivered" at the warehouse is a return; when the customer lives in the same town a person decides.
const warehouseEvent = { statusText:'تم التسليم', location:'مكتب بريد أولاد صقر - الشرقية' };
assert.deepEqual(F.warehouseDelivery(warehouseEvent, { city:'الزقازيق' }), { place:'أولاد صقر', ambiguous:false });
assert.equal(F.warehouseDelivery(warehouseEvent, { city:'اولاد صقر' }).ambiguous, true);
assert.equal(F.warehouseDelivery({ statusText:'تم التسليم', location:'مكتب بريد الزقازيق' }, {}), null);
assert.equal(F.warehouseDelivery({ ...warehouseEvent, stage:'التسليم' }, {}), null, 'only «اكتمال الطلب» decides');
assert.equal(F.warehouseDelivery({ ...warehouseEvent, stage:'اكتمال الطلب' }, {}).place, 'أولاد صقر');
assert.equal(task({ lastEvent:warehouseEvent }, { statusCode:'delivered' }).checkStage, true, 'older events without a stage ask the employee to check');
assert.equal(task({ lastEvent:{ ...warehouseEvent, stage:'اكتمال الطلب' } }, { statusCode:'delivered' }).checkStage, false);
result = task({ lastEvent:warehouseEvent, collectionId:'COL-1' }, { statusCode:'delivered' });
assert.equal(result.kind, 'warehouse-return'); assert.equal(result.collected, true);
assert.equal(task({ lastEvent:warehouseEvent, warehouseDeliveryConfirmedAt:'2026-10-29' }, { statusCode:'delivered' }), null);
assert.equal(task({ lastEvent:{ statusText:'تم التسليم', location:'الزقازيق' } }, { statusCode:'delivered' }), null);
assert.equal(task({ shippedAt:shippedMonday }, { statusCode:'returned', now:at('2026-11-10T10:00:00+03:00') }), null);
console.log('PASS delivered at the warehouse is a return, delivered parcels need nothing');

assert.deepEqual(F.settingsFrom({ warehousePlaces:'أولاد صقر، فاقوس', lowerEgyptComplaintHours:36 }).warehousePlaces, ['أولاد صقر', 'فاقوس']);
assert.equal(F.settingsFrom({ lowerEgyptComplaintHours:36 }).lowerEgyptHours, 36);
assert.equal(F.settingsFrom({}).upperEgyptHours, 72);
console.log('PASS settings: hours and warehouse places are editable');
