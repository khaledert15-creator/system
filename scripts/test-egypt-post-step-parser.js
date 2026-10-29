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

// ENO50626795EG (2026-10-28): an attempt in the delivery stage, «اكتمال الطلب» not reached yet.
const attempt = parseEgyptPostSteps([
  { fields: ["التسجيل", "تم تسجيل الشحنة", "المركز اللوجيستى بأبو كبير", "الشرقية", "18 أكتوبر 2026", "07:18 مساءً"] },
  { fields: ["الشحن", "تم استلام الشحنه من الجهة", "المركز اللوجيستى بأبو كبير", "الشرقية", "19 أكتوبر 2026", "03:36 مساءً"] },
  { fields: ["النقل والمعالجة", "تم وصول الشحنة الى المكتب", "منطقة توزيع ادكو", "البحيرة", "26 أكتوبر 2026", "11:04 صباحاً"] },
  { fields: ["التسليم", "تم إجراء محاولة توزيع", "منطقة توزيع ادكو", "البحيرة", "28 أكتوبر 2026", "02:18 مساءً"] },
  { fields: ["اكتمال الطلب"] }
], "ENO50626795EG");
assert.equal(attempt.length, 4, "the attempt is kept, not dropped as unknown");
assert.equal(attempt[3].normalizedStatus, "delivery_attempt_1");
assert.equal(attempt[3].stage, "التسليم");
assert.ok(!attempt.some(item => item.normalizedStatus === "delivered"));

// «تسليم» in the delivery stage is the courier, not the customer; only «اكتمال الطلب» delivers.
const beforeCompletion = parseEgyptPostSteps([{ fields: ["التسليم", "تم تسليم الشحنة لمندوب التوزيع", "منطقة توزيع أولاد صقر", "الشرقية", "28 أكتوبر 2026", "09:00 صباحاً"] }], trackingNumber);
assert.equal(beforeCompletion[0].normalizedStatus, "out_for_delivery");
const completedAtWarehouse = parseEgyptPostSteps([{ fields: ["اكتمال الطلب", "تم التسليم", "منطقة توزيع أولاد صقر", "الشرقية", "29 أكتوبر 2026", "10:00 صباحاً"] }], trackingNumber);
assert.equal(completedAtWarehouse[0].normalizedStatus, "delivered");
assert.equal(completedAtWarehouse[0].stage, "اكتمال الطلب");
// The JSON reply names the stage by its place: 4 = «التسليم», 5 = «اكتمال الطلب».
const jsonStages = parseEgyptPostSteps(stepsFromShipmentDetails({ data: { data: [
  { status: 4, date: "28 أكتوبر 2026", time: "02:18 مساءً", city: "البحيرة", location: "منطقة توزيع ادكو", itemStatus: "تم تسليم الشحنة لمندوب التوزيع", mainStatus: "التسليم" },
  { status: 5, date: "29 أكتوبر 2026", time: "02:18 مساءً", city: "البحيرة", location: "منطقة توزيع ادكو", itemStatus: "تم التسليم والتحصيل", mainStatus: "اكتمال الطلب" }
] } }), trackingNumber);
assert.deepEqual(jsonStages.map(item => [item.stage, item.normalizedStatus]), [["التسليم", "out_for_delivery"], ["اكتمال الطلب", "delivered"]]);

console.log("Egypt Post step parser: passed");
