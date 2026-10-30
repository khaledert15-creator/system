"use strict";

// Names the Chatwood contact after the customer of an order booked from a conversation, when Chatwood only has a
// stand-in: Meta's «John Doe» for a Messenger profile it would not share, an empty name, or the phone number. A name an
// employee set is never replaced. The contact also gets the order's phone when it has none (Chatwood refuses a number
// another contact holds; the name is still saved). Best effort: a failure is logged and never touches the order.
const PLACEHOLDER_NAMES = new Set(["john doe"]);

function isPlaceholderName(name) {
  const text = String(name || "").trim();
  return !text || PLACEHOLDER_NAMES.has(text.toLowerCase()) || /^[+\d\s()-]+$/.test(text);
}

const e164 = phone => /^01\d{9}$/.test(String(phone || "")) ? `+20${String(phone).slice(1)}` : "";

async function nameContactFromOrder(config, { contactId, name, phone }, { fetch = globalThis.fetch, log = () => {} } = {}) {
  const customerName = String(name || "").trim();
  if (!config.chatwoodContactsEnabled || !/^\d{1,18}$/.test(String(contactId || "")) || isPlaceholderName(customerName)) return { skipped:true };
  const url = `${config.chatwoodApiUrl}/api/v1/accounts/${config.chatwoodAccountId}/contacts/${contactId}`;
  const call = (method, body) => fetch(url, { method, headers:{ api_access_token:config.chatwoodApiToken, ...(body ? { "Content-Type":"application/json" } : {}) }, body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(config.chatwoodTimeoutMs) });
  try {
    const current = await call("GET");
    if (!current.ok) throw new Error(`contact lookup returned ${current.status}`);
    const body = await current.json();
    const contact = body.payload || body;
    if (!isPlaceholderName(contact.name)) return { skipped:true, reason:"ALREADY_NAMED" };
    const number = contact.phone_number ? "" : e164(phone);
    let result = await call("PATCH", number ? { name:customerName, phone_number:number } : { name:customerName });
    if (!result.ok && number) result = await call("PATCH", { name:customerName });
    if (!result.ok) throw new Error(`contact update returned ${result.status}`);
    log({ operationType:"CHATWOOD_CONTACT_NAMED", contactId:String(contactId) });
    return { ok:true };
  } catch (error) {
    log({ operationType:"CHATWOOD_CONTACT_NAME_FAILED", contactId:String(contactId), message:error.message });
    return { ok:false };
  }
}

module.exports = { isPlaceholderName, nameContactFromOrder };
