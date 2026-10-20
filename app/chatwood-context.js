"use strict";

// Verified Chatwood conversation context for quick orders. The System never trusts a conversation id sent by the
// browser: the Store vouches for the conversation (facts it records from Chatwood's signed webhooks), and the System
// then gives the browser a short-lived token, signed with a key derived from the integration secret and bound to the
// employee. Quick orders take their owner (conversation, contact, WhatsApp number) only from such a token.
const crypto = require("crypto");

const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const WHATSAPP_CHANNEL = "Channel::Whatsapp";
const ID_PATTERN = /^\d{1,18}$/;

const MESSAGES = {
  CHATWOOD_CONTEXT_INVALID:"سياق محادثة Chatwood غير صالح. افتح الطلب من تبويب المحادثة تاني أو كمّل من غير محادثة.",
  CHATWOOD_CONTEXT_EXPIRED:"انتهت صلاحية سياق محادثة Chatwood. افتح الطلب من تبويب المحادثة تاني أو كمّل من غير محادثة.",
  CHATWOOD_CONTEXT_OTHER_USER:"سياق المحادثة ده متعمل لموظف تاني. افتح الطلب من تبويب المحادثة بحسابك.",
  CHATWOOD_CONTEXT_UNAVAILABLE:"ربط المحادثات غير مفعّل على السيستم دلوقتي.",
};

const contextKey = secret => crypto.createHmac("sha256", String(secret)).update("maktabaa:chatwood-context:v1").digest();
const sign = (secret, body) => crypto.createHmac("sha256", contextKey(secret)).update(body).digest();

function issueContextToken(secret, { conversationId, contactId = "", customerWhatsAppPhone = "", inboxId = null, username }, now = Date.now()) {
  if (!secret || !ID_PATTERN.test(String(conversationId || "")) || !username) throw new Error("A verified conversation and an employee are required");
  const body = Buffer.from(JSON.stringify({ v:1, c:String(conversationId), ct:String(contactId || ""), w:String(customerWhatsAppPhone || ""), i:inboxId ?? null, u:String(username), iat:now, exp:now + CONTEXT_TTL_MS })).toString("base64url");
  return { token:`${body}.${sign(secret, body).toString("base64url")}`, expiresAt:new Date(now + CONTEXT_TTL_MS).toISOString() };
}

function verifyContextToken(secret, token, username, now = Date.now()) {
  const text = String(token || "");
  const parts = text.split(".");
  if (!secret || parts.length !== 2 || text.length > 1024) return { ok:false, code:"CHATWOOD_CONTEXT_INVALID" };
  const given = Buffer.from(parts[1], "base64url"), expected = sign(secret, parts[0]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok:false, code:"CHATWOOD_CONTEXT_INVALID" };
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok:false, code:"CHATWOOD_CONTEXT_INVALID" }; }
  if (payload?.v !== 1 || !ID_PATTERN.test(String(payload.c || "")) || !Number.isFinite(payload.exp)) return { ok:false, code:"CHATWOOD_CONTEXT_INVALID" };
  if (payload.u !== String(username || "")) return { ok:false, code:"CHATWOOD_CONTEXT_OTHER_USER" };
  if (!(now < payload.exp)) return { ok:false, code:"CHATWOOD_CONTEXT_EXPIRED" };
  return { ok:true, context:{
    chatwootConversationId:payload.c, chatwootContactId:ID_PATTERN.test(String(payload.ct || "")) ? payload.ct : "",
    customerWhatsAppPhone:/^01\d{9}$/.test(String(payload.w || "")) ? payload.w : "", inboxId:Number.isInteger(payload.i) ? payload.i : null,
    issuedAt:new Date(payload.iat).toISOString(), expiresAt:new Date(payload.exp).toISOString(),
  } };
}

const contextMessage = code => MESSAGES[code] || MESSAGES.CHATWOOD_CONTEXT_INVALID;

function maskPhone(phone) {
  const value = String(phone || "");
  return /^01\d{9}$/.test(value) ? `${value.slice(0, 4)}****${value.slice(-3)}` : "";
}

// What the Store reported about a conversation, checked: only WhatsApp conversations carry an order owner, and the
// contact the browser saw must be the contact the Store knows (a stale or forged id is refused, never trusted).
function checkConversation(conversation, { expectedContactId = "", normalizePhone = value => value } = {}) {
  if (!conversation || !ID_PATTERN.test(String(conversation.conversationId || ""))) return { ok:false, status:404, code:"CONVERSATION_NOT_FOUND", message:"المحادثة دي مش معروفة للسيستم لسه. لازم يكون فيها رسالة بعد تفعيل الربط." };
  if (conversation.channel !== WHATSAPP_CHANNEL) return { ok:false, status:422, code:"CONVERSATION_NOT_WHATSAPP", message:"المحادثة دي مش محادثة واتساب، فمينفعش يتربط بيها طلب." };
  const contactId = ID_PATTERN.test(String(conversation.contactId || "")) ? String(conversation.contactId) : "";
  if (!contactId) return { ok:false, status:422, code:"CONVERSATION_WITHOUT_CONTACT", message:"المحادثة دي من غير جهة اتصال معروفة." };
  if (expectedContactId && String(expectedContactId) !== contactId) return { ok:false, status:409, code:"CONTACT_MISMATCH", message:"جهة الاتصال مش مطابقة للمحادثة. حدّث التبويب وحاول تاني." };
  const whatsapp = normalizePhone(conversation.contactPhone || "");
  return { ok:true, identity:{ chatwootConversationId:String(conversation.conversationId), chatwootContactId:contactId, customerWhatsAppPhone:/^01\d{9}$/.test(whatsapp) ? whatsapp : "", inboxId:Number.isInteger(conversation.inboxId) ? conversation.inboxId : null }, lastMessageAt:conversation.lastMessageAt || null, mentions:Array.isArray(conversation.mentions) ? conversation.mentions : [] };
}

module.exports = { CONTEXT_TTL_MS, WHATSAPP_CHANNEL, issueContextToken, verifyContextToken, contextMessage, maskPhone, checkConversation };
