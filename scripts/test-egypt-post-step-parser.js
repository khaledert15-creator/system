const assert = require("node:assert/strict");
const { parseEgyptPostSteps, stepsFromShipmentDetails } = require("../services/local-tracking-rpa/tracking-parser");

const trackingNumber = "ENO50548717EG";
const steps = [
  { fields: ["التسجيل", "تم تسجيل الشحنة", "المركز اللوجيستى بأبو كبير", "الشرقية", "15 أكتوبر 2026", "11:46 مساءً"] },
  { fields: ["الشحن", "تم استلام الشحنه من الجهة", "المركز اللوجيستى بأبو كبير", "الشرقية", "16 أكتوبر 2026", "11:58 صباحاً"] },
  { fields: ["النقل والمعالجة", "الشحنة في مرحلة النقل", "المركز اللوجيستى بأبو كبير", "الشرقية", "16 أكتوبر 2026", "12:05 مساءً"] },
  { fields: ["التسليم", "اكتمال الطلب"] }
];

const timeline = parseEgyptPostSteps(steps, trackingNumber);
assert.equal(timeline.length, 3);
assert.deepEqual(timeline.map(item => item.normalizedStatus), ["registered", "registered", "in_transit"]);
assert.equal(timeline[2].location, "المركز اللوجيستى بأبو كبير، الشرقية");
assert.equal(timeline[2].eventAt, parseEgyptPostSteps(steps, trackingNumber)[2].eventAt);
assert.ok(timeline.every(item => item.trackingNumber === trackingNumber));

const delivered = parseEgyptPostSteps([
  { fields: ["اكتمال الطلب", "تم التسليم والتحصيل", "منطقة توزيع قحافة", "الغربية", "28 يوليو 2026", "02:27 مساءً"] }
], trackingNumber);
assert.equal(delivered.length, 1);
assert.equal(delivered[0].normalizedStatus, "delivered");

// The site's GetShipmentDetails reply (captured 2026-10-24) gives the same events as the result page text.
const reply = { data: { barcode: "ENO50884920EG", case: 1, data: [
  { status: 1, date: "24 أكتوبر 2026", time: "02:40 صباحاً", country: " مصر", city: "الشرقية", location: "المركز اللوجيستى بأبو كبير", itemStatus: "تم تسجيل الشحنة", mainStatus: "جاري التجهيز للشحن", isCurrent: false, isFinished: true },
  { status: 2, date: "24 أكتوبر 2026", time: "02:35 مساءً", country: " مصر", city: "الشرقية", location: "المركز اللوجيستى بأبو كبير", itemStatus: "تم استلام الشحنه من الجهة ", mainStatus: "تم استلام الشحنة ", isCurrent: false, isFinished: true },
  { status: 3, date: "24 أكتوبر 2026", time: "03:10 مساءً", country: " مصر", city: "الشرقية", location: "المركز اللوجيستى بأبو كبير", itemStatus: "الشحنة في مرحلة النقل", mainStatus: "في المعالجة البريدية ", isCurrent: true, isFinished: false },
  { status: 4, date: null, time: null, country: null, city: null, location: null, itemStatus: null, mainStatus: null, isCurrent: false, isFinished: false }
] }, success: true, errorMessages: [] };
const pageSteps = [
  { fields: ["التسجيل", "تم تسجيل الشحنة", "المركز اللوجيستى بأبو كبير", "الشرقية", "24 أكتوبر 2026", "02:40 صباحاً"] },
  { fields: ["الشحن", "تم استلام الشحنه من الجهة", "المركز اللوجيستى بأبو كبير", "الشرقية", "24 أكتوبر 2026", "02:35 مساءً"] },
  { fields: ["النقل والمعالجة", "الشحنة في مرحلة النقل", "المركز اللوجيستى بأبو كبير", "الشرقية", "24 أكتوبر 2026", "03:10 مساءً"] },
  { fields: ["التسليم"] }
];
assert.deepEqual(parseEgyptPostSteps(stepsFromShipmentDetails(reply), "ENO50884920EG"), parseEgyptPostSteps(pageSteps, "ENO50884920EG"), "JSON and page text give identical events");
assert.equal(parseEgyptPostSteps(stepsFromShipmentDetails(reply), "ENO50884920EG").length, 3);
assert.deepEqual(stepsFromShipmentDetails({ data: { barcode: "ENO10914048EG", case: 2, data: [] }, success: true }), []);
assert.deepEqual(stepsFromShipmentDetails({ data: null, success: false, errorMessages: ["Something went wrong"] }), []);

console.log("Egypt Post step parser: passed");
