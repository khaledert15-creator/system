(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ShipmentFollowUp = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // What the shipping employee has to do with an open parcel, worked out from its tracking and complaints:
  //   warehouse-return     — the post marked it "delivered" at our own warehouse: it came back to us.
  //   complaint-follow-up  — a complaint is open and the parcel is still not delivered a day later.
  //   complaint-due        — a delivery attempt, or 48 h (Lower Egypt) / 72 h (Upper Egypt) on the road; Fridays
  //                          are not counted because the post does not deliver on Fridays.
  const UPPER_EGYPT = ["الفيوم", "بني سويف", "المنيا", "أسيوط", "سوهاج", "قنا", "الأقصر", "أسوان", "البحر الأحمر", "الوادي الجديد", "شمال سيناء", "جنوب سيناء", "مطروح"];
  const DEFAULTS = Object.freeze({ lowerEgyptHours:48, upperEgyptHours:72, followUpHours:24, escalateAfter:3, warehousePlaces:["أولاد صقر"] });
  const HOUR = 3600000, DAY = 24 * HOUR;
  const ATTEMPTS = ["delivery_attempt_1", "delivery_attempt_2", "delivery_attempt_3"];
  const CLOSED = ["closed", "resolved"];

  function normalizeText(value) {
    return String(value || "")
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .replace(/\s+/g, " ").trim();
  }
  const UPPER_SET = new Set(UPPER_EGYPT.map(normalizeText));

  function placesList(value) {
    const list = Array.isArray(value) ? value : String(value || "").split(/[,،\n]/);
    return list.map(item => String(item).trim()).filter(Boolean);
  }

  function settingsFrom(tracking = {}) {
    const positive = (value, fallback) => Number(value) > 0 ? Number(value) : fallback;
    const places = placesList(tracking.warehousePlaces);
    return {
      lowerEgyptHours: positive(tracking.lowerEgyptComplaintHours, DEFAULTS.lowerEgyptHours),
      upperEgyptHours: positive(tracking.upperEgyptComplaintHours, DEFAULTS.upperEgyptHours),
      followUpHours: positive(tracking.complaintFollowUpHours, DEFAULTS.followUpHours),
      escalateAfter: positive(tracking.complaintEscalateAfter, DEFAULTS.escalateAfter),
      warehousePlaces: places.length ? places : DEFAULTS.warehousePlaces.slice()
    };
  }

  function regionOf(governorate) {
    return UPPER_SET.has(normalizeText(governorate)) ? { key:"upper", label:"وجه قبلي" } : { key:"lower", label:"وجه بحري" };
  }

  const cairoParts = typeof Intl === "object" ? new Intl.DateTimeFormat("en-US", { timeZone:"Africa/Cairo", hourCycle:"h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : null;
  function cairoOffset(ms) {
    if (!cairoParts) return 2 * HOUR;
    const parts = Object.fromEntries(cairoParts.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    return local - Math.floor(ms / 60000) * 60000;
  }

  // Hours between two moments, leaving out every Friday (Cairo time).
  function hoursWithoutFridays(fromMs, toMs) {
    if (!(toMs > fromMs)) return 0;
    const offset = cairoOffset(toMs), start = fromMs + offset, end = toMs + offset;
    let total = end - start;
    for (let day = Math.floor(start / DAY); day * DAY < end; day++) {
      if (new Date(day * DAY).getUTCDay() !== 5) continue;
      total -= Math.max(0, Math.min(end, (day + 1) * DAY) - Math.max(start, day * DAY));
    }
    return total / HOUR;
  }

  function time(value) {
    const ms = new Date(value || "").getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  // A "delivered" event whose place is our warehouse is the parcel coming back to us. When the customer lives in
  // that same place the event is ambiguous, so it is flagged for a person to check instead of being turned around.
  function warehouseDelivery(event = {}, shipment = {}, places = DEFAULTS.warehousePlaces) {
    const text = normalizeText(`${event.location || ""} ${event.statusText || ""} ${event.office || ""}`);
    const place = placesList(places).find(item => text.includes(normalizeText(item)));
    if (!place) return null;
    const address = normalizeText(`${shipment.city || ""} ${shipment.address || ""}`);
    return { place, ambiguous: address.includes(normalizeText(place)) };
  }

  function isOpenComplaint(item = {}) {
    return !CLOSED.includes(item.status || item.complaintStatus || "open") && !item.closedAt;
  }

  function followUpTask(shipment = {}, { statusCode = "", complaints = [], now = Date.now(), settings = {}, lastEvent = null, startedAt = "" } = {}) {
    const rules = settings.lowerEgyptHours ? settings : settingsFrom(settings);
    if (shipment.deletedAt || shipment.refusedAt || shipment.cancelledAt || statusCode === "returned" || statusCode === "cancelled") return null;
    const own = complaints.filter(item => item.shipmentId === shipment.id);
    if (statusCode === "delivered") {
      const event = lastEvent || shipment.lastEvent;
      const warehouse = event && !shipment.warehouseDeliveryConfirmedAt ? warehouseDelivery(event, shipment, rules.warehousePlaces) : null;
      if (!warehouse) return null;
      return {
        kind: "warehouse-return",
        reason: warehouse.ambiguous ? `اتسلمت في ${warehouse.place}، والعميل نفسه من هناك: اتأكد هل دي تسليم ولا مرتجع` : `البريد كاتب «تم التسليم» في ${warehouse.place} (المخزن): الطرد رجع لنا`,
        ambiguous: warehouse.ambiguous,
        collected: Boolean(shipment.collectionId)
      };
    }
    const open = own.filter(isOpenComplaint).sort((a, b) => time(b.createdAt || b.openedAt) - time(a.createdAt || a.openedAt))[0];
    if (open) {
      const followUps = Array.isArray(open.followUps) ? open.followUps : [];
      const last = Math.max(time(open.createdAt || open.openedAt), ...followUps.map(item => time(item.at)));
      const dueAt = last + rules.followUpHours * HOUR;
      const escalated = followUps.length >= rules.escalateAfter;
      return {
        kind: now >= dueAt ? "complaint-follow-up" : "complaint-waiting",
        complaint: open, dueAt, followUps: followUps.length, escalated,
        reason: escalated ? `شكوى ${open.complaintNumber || open.complaintReference || ""}: ${followUps.length} متابعات من غير تسليم، محتاجة تصعيد` : `شكوى ${open.complaintNumber || open.complaintReference || ""} مفتوحة والطرد لسه ما اتسلمش`
      };
    }
    // A closed complaint or a recorded "customer was not home" starts the clock again.
    const lastClosed = Math.max(0, ...own.map(item => time(item.closedAt || item.resolvedAt)));
    const restartAt = Math.max(lastClosed, time(shipment.complaintWaivedAt));
    if (ATTEMPTS.includes(statusCode)) {
      const attemptAt = time(shipment.lastMovementAt || (lastEvent || shipment.lastEvent || {}).eventAt) || now;
      if (!restartAt || attemptAt > restartAt) return { kind:"complaint-due", trigger:"attempt", reason:"محاولة تسليم: كلّم العميل، ولو محدش جاله قدّم شكوى" };
    }
    const start = Math.max(time(startedAt || shipment.shippedAt || shipment.createdAt), restartAt);
    if (!start) return null;
    const region = regionOf(shipment.governorate);
    const limit = region.key === "upper" ? rules.upperEgyptHours : rules.lowerEgyptHours;
    const hours = hoursWithoutFridays(start, now);
    if (hours < limit) return null;
    return { kind:"complaint-due", trigger:"late", hours:Math.floor(hours), region:region.label, reason:`متأخرة ${Math.floor(hours)} ساعة (${region.label}، الحد ${limit} ساعة من غير الجمعة)` };
  }

  return { UPPER_EGYPT, DEFAULTS, normalizeText, settingsFrom, regionOf, hoursWithoutFridays, warehouseDelivery, isOpenComplaint, followUpTask, placesList };
});
