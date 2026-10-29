const ARABIC_MONTHS = {
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10,
  نوفمبر: 11, ديسمبر: 12
};

function westernDigits(value) {
  return String(value || "").replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function eventDate(dateText, timeText) {
  const date = westernDigits(dateText).trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (!date || !ARABIC_MONTHS[date[2]]) return "";
  const time = westernDigits(timeText).match(/(\d{1,2}):(\d{2})/);
  let hour = time ? Number(time[1]) : 0;
  const minute = time ? Number(time[2]) : 0;
  if (/مساء/.test(timeText) && hour < 12) hour += 12;
  if (/صباح/.test(timeText) && hour === 12) hour = 0;
  const parsed = new Date(Number(date[3]), ARABIC_MONTHS[date[2]] - 1, Number(date[1]), hour, minute);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

// The result page has five stages. Only the last, «اكتمال الطلب», says where the parcel finally ended; texts in
// «التسليم» (the delivery stage) such as handing it to the courier or a delivery attempt are not a delivery.
const STAGES = ["التسجيل", "الشحن", "النقل والمعالجة", "التسليم", "اكتمال الطلب"];
const COMPLETION_STAGE = "اكتمال الطلب";
const DELIVERY_STAGE = "التسليم";

function stageName(value) {
  const text = String(value || "").trim();
  return STAGES.includes(text) ? text : "";
}

function normalizeStatus(text, stage = "") {
  const value = String(text || "").toLowerCase();
  const returning = /مرتجع|إرجاع|ارجاع|عودة|returned|return/.test(value);
  if (stage === COMPLETION_STAGE) return returning ? "returned" : "delivered";
  if (/محاولة/.test(value)) return "delivery_attempt_1";
  if (returning) return "returned";
  if (/التسليم والتحصيل/.test(value)) return "delivered";
  if (/تم\s+(?:ال)?تسليم|delivered/.test(value)) return stage ? "out_for_delivery" : "delivered";
  if (stage === DELIVERY_STAGE) return "out_for_delivery";
  if (/مندوب التوصيل|خارج للتسليم|خرج للتوصيل|out for delivery/.test(value)) return "out_for_delivery";
  if (/تسجيل|استلام|استلم|registered|accepted/.test(value)) return "registered";
  if (/النقل|مرحلة النقل|في الطريق|معالجة|الشحن|transit/.test(value)) return "in_transit";
  return "unknown";
}

function parseEgyptPostSteps(steps, trackingNumber) {
  if (!Array.isArray(steps)) return [];
  return steps.map(step => {
    const fields = (Array.isArray(step?.fields) ? step.fields : []).map(value => String(value || "").trim());
    const detail = fields[1] || "";
    const dateIndex = fields.findIndex((value, index) => index > 1 && /^\d{1,2}\s+\S+\s+\d{4}$/.test(westernDigits(value)));
    if (!detail || dateIndex < 0) return null;
    const at = eventDate(fields[dateIndex], fields[dateIndex + 1] || "");
    const stage = stageName(fields[0]);
    const normalizedStatus = normalizeStatus(detail, stage);
    if (!at || normalizedStatus === "unknown") return null;
    return {
      trackingNumber,
      statusText: detail,
      normalizedStatus,
      ...(stage ? { stage } : {}),
      location: fields.slice(2, dateIndex).filter(Boolean).join("، "),
      eventAt: at
    };
  }).filter(Boolean);
}

// The site's GetShipmentDetails JSON as the same rows its result page shows: stage, status, office, city, date, time.
// `status` is the stage's place (1–5) in the page's row of stages.
function stepsFromShipmentDetails(body) {
  const rows = body?.data?.data;
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && row.itemStatus && row.date).map(row => {
    const stage = /اكتمال/.test(String(row.mainStatus || "")) ? COMPLETION_STAGE : (STAGES[Number(row.status) - 1] || "");
    return { fields: [stage, row.itemStatus, row.location, row.city, row.date, row.time].map(value => String(value || "").trim()) };
  });
}

module.exports = { parseEgyptPostSteps, stepsFromShipmentDetails, eventDate, normalizeStatus, STAGES, COMPLETION_STAGE };
