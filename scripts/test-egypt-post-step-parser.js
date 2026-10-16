const assert = require("node:assert/strict");
const { parseEgyptPostSteps } = require("../services/local-tracking-rpa/tracking-parser");

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

console.log("Egypt Post step parser: passed");
