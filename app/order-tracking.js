"use strict";

// Customer order tracking for the Store's /track page (signed POST /api/integration/v1/track).
// The customer gives a reference (ORD-…, the carrier tracking code or the website order number) and a phone; an
// order is returned only when both match. The reply carries no name, address, phone, cost or staff field.

const STEP_ORDER = ["received", "preparing", "packed", "shipped", "out_for_delivery", "delivered"];
const MAX_EVENTS = 40;

const asciiDigits = value => String(value ?? "").replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
const normalizeReference = value => asciiDigits(value).trim().toUpperCase().replace(/[\s‎‏]+/g, "");
const round = value => Math.round(Number(value || 0) * 100) / 100;
const orderNumberOf = value => { const match = /^ORD-?0*(\d{1,9})$/.exec(value); return match ? Number(match[1]) : null; };

function orderShipments(db, order) {
  return (db.shipments || []).filter(item => item && !item.deletedAt && (item.id === order.shipmentId || item.onlineOrderId === order.id));
}

function activeShipment(shipments) {
  return shipments.find(item => !item.cancelledAt && item.shippingStatus !== "cancelled" && item.normalizedStatus !== "cancelled") || null;
}

function referenceMatches(db, order, reference) {
  const number = orderNumberOf(reference);
  if (number !== null && orderNumberOf(String(order.id || "").toUpperCase()) === number) return true;
  if ([order.websiteOrderNumber, order.parentWebsiteOrderNumber].some(value => value && normalizeReference(value) === reference)) return true;
  return orderShipments(db, order).some(shipment => [shipment.trackingNumber, shipment.tracking, ...(Array.isArray(shipment.previousTrackingNumbers) ? shipment.previousTrackingNumbers : [])]
    .some(value => value && normalizeReference(value) === reference))
    || [order.trackingNumber, order.tracking].some(value => value && normalizeReference(value) === reference);
}

function phoneMatches(db, order, phone, normalizePhone) {
  const customer = (db.customers || []).find(item => item && item.id === order.customerId);
  const phones = [order.phone, order.alternativePhone, order.customerWhatsAppPhone, customer?.phone, customer?.alternativePhone, ...orderShipments(db, order).map(item => item.phone || item.customerPhone)];
  return phones.some(value => value && normalizePhone(value) === phone);
}

function customerStep(order, shipment) {
  const stage = String(order.workflowStage || "");
  const shipmentStatus = String(shipment?.normalizedStatus || shipment?.shippingStatus || "");
  if (order.cancelledAt || stage === "cancelled" || order.status === "ملغي") return "cancelled";
  if (order.status === "مرتجع" || stage === "returned" || shipmentStatus === "returned") return "returned";
  if (stage === "delivered" || shipmentStatus === "delivered") return "delivered";
  if (shipmentStatus === "out_for_delivery") return "out_for_delivery";
  if (shipment || stage === "shipped") return "shipped";
  if (order.saleId || order.preparedAt || order.packedAt) return "packed";
  if (stage === "awaiting_stock") return "preorder";
  if (order.confirmedAt || ["awaiting_preparation", "preparing", "needs_review"].includes(stage)) return "preparing";
  return "received";
}

function shipmentEvents(db, shipment) {
  if (!shipment) return [];
  const seen = new Set();
  return (db.trackingHistory || [])
    .filter(event => event && (event.shipmentId === shipment.id || (shipment.trackingNumber && event.trackingNumber === shipment.trackingNumber)) && event.normalizedStatus !== "unknown" && event.statusText)
    .filter(event => { const key = event.eventFingerprint || `${event.eventAt}|${event.statusText}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => String(b.eventAt || b.fetchedAt || "").localeCompare(String(a.eventAt || a.fetchedAt || "")))
    .slice(0, MAX_EVENTS)
    .map(event => ({ text:String(event.statusText), location:String(event.location || ""), at:event.eventAt || event.fetchedAt || null, status:String(event.normalizedStatus || "") }));
}

function trackedOrder(db, order) {
  const books = new Map((db.books || []).map(book => [book.id, book]));
  const shipments = orderShipments(db, order);
  const shipment = activeShipment(shipments);
  const step = customerStep(order, shipment);
  const events = shipmentEvents(db, shipment);
  const deliveredEvent = events.find(event => event.status === "delivered");
  const lines = (Array.isArray(order.lines) ? order.lines : []).filter(line => Number(line?.qty) > 0)
    .map(line => ({ name:String(books.get(line.bookId)?.name || "كتاب"), qty:Number(line.qty) }));
  const waiting = step === "preorder" ? (Array.isArray(order.backorderLines) ? order.backorderLines : [])
    .filter(line => Number(line?.qty) > 0).map(line => ({ name:String(books.get(line.bookId)?.name || "كتاب"), qty:Number(line.qty) })) : [];
  const total = round(order.total), paid = round(order.paidAmount);
  const remaining = Number.isFinite(Number(order.remainingAmount)) && order.remainingAmount !== "" && order.remainingAmount != null ? round(order.remainingAmount) : round(Math.max(0, total - paid));
  return {
    orderId:String(order.id), websiteOrderNumber:order.websiteOrderNumber || order.parentWebsiteOrderNumber || "", splitPart:order.splitPart || null,
    step, stepIndex:STEP_ORDER.indexOf(step),
    createdAt:order.createdAt || order.date || null, confirmedAt:order.confirmedAt || null, packedAt:order.preparedAt || order.packedAt || null,
    shippedAt:shipment?.shippedAt || order.shippedAt || null, deliveredAt:shipment?.deliveredAt || order.deliveredAt || deliveredEvent?.at || null,
    cancelledAt:step === "cancelled" ? order.cancelledAt || null : null,
    lines, waiting,
    total, shippingFee:round(order.shippingFee ?? order.shippingCost), paid, remaining,
    shipment:shipment ? {
      carrier:String(shipment.company || shipment.carrier || ""), trackingNumber:String(shipment.trackingNumber || shipment.tracking || ""),
      status:String(shipment.normalizedStatus || shipment.shippingStatus || ""), statusText:String(shipment.lastStatusText || shipment.currentStatus || shipment.status || ""),
      location:String(shipment.currentLocation || shipment.lastEvent?.location || ""), lastUpdateAt:shipment.lastMovementAt || shipment.lastEvent?.eventAt || shipment.lastTrackedAt || null
    } : null,
    events,
    updatedAt:order.updatedAt || null
  };
}

// Both the reference and the phone must match the same order. A wrong phone looks exactly like an unknown reference.
function trackOrders(db, input, { normalizePhone }) {
  const reference = normalizeReference(input?.reference);
  const phone = normalizePhone(input?.phone || "");
  if (reference.length < 4 || reference.length > 80 || !phone) return [];
  return (db.onlineOrders || [])
    .filter(order => order && !order.deletedAt && order.id && referenceMatches(db, order, reference) && phoneMatches(db, order, phone, normalizePhone))
    .sort((a, b) => (Number(a.splitPart) || 0) - (Number(b.splitPart) || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
    .slice(0, 5)
    .map(order => trackedOrder(db, order));
}

module.exports = { trackOrders, normalizeReference, customerStep, STEP_ORDER };
