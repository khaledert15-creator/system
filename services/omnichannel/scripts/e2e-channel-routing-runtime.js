const crypto = require("crypto");
const { getPrisma, disconnectPrisma } = require("../src/config/database");
const { env } = require("../src/config/env");

const BASE = process.env.OMNI_E2E_BASE || "http://127.0.0.1:8775";

function signedUser(user = { id: "U001", username: "owner", role: "مالك", name: "Owner" }) {
  const header = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.sessionBridgeSecret).update(header).digest("hex");
  return { "X-Omni-User": header, "X-Omni-Signature": signature, "Content-Type": "application/json" };
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    headers: signedUser(),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

async function webhook(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

async function ensureAccount({ channelKey, name, phoneNumberId, phoneNumber, pageId }) {
  const accounts = (await api("/channel-accounts")).body.accounts || [];
  const existing = accounts.find(account => account.phoneNumberId === phoneNumberId || account.pageId === pageId);
  if (existing) return existing;
  const created = await api("/channel-accounts", {
    method: "POST",
    body: {
      channelKey,
      name,
      phoneNumber,
      phoneNumberId,
      pageId,
      status: "mock_connected",
      connectionMode: "mock",
      isActive: true
    }
  });
  if (created.status !== 201) throw new Error(`create account failed ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.account;
}

function whatsappPayload({ phoneNumberId, messageId, from, text }) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: `Runtime ${from}` } }],
          messages: [{ id: messageId, from, timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }]
        }
      }]
    }]
  };
}

function messengerPayload({ pageId, messageId, psid, text }) {
  return {
    entry: [{
      id: pageId,
      messaging: [{ sender: { id: psid }, timestamp: Date.now(), message: { mid: messageId, text } }]
    }]
  };
}

function whatsappStatusPayload({ phoneNumberId, externalMessageId, status, timestamp = Math.floor(Date.now() / 1000) }) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{
            id: externalMessageId,
            status,
            timestamp: String(timestamp),
            ...(status === "failed" ? { errors: [{ code: 131000, message: "runtime mock failure" }] } : {})
          }]
        }
      }]
    }]
  };
}

async function messageByExternalId(db, externalMessageId) {
  return db.message.findFirst({ where: { externalMessageId }, include: { conversation: true } });
}

async function main() {
  const db = getPrisma();
  const stamp = Date.now();
  const account3 = await ensureAccount({ channelKey: "whatsapp", name: "WhatsApp Test Account 3", phoneNumber: "+201000000003", phoneNumberId: "test-phone-id-3" });
  const account4 = await ensureAccount({ channelKey: "whatsapp", name: "WhatsApp Test Account 4", phoneNumber: "+201000000004", phoneNumberId: "test-phone-id-4" });
  const page2 = await ensureAccount({ channelKey: "messenger", name: "Messenger Page 2", pageId: "test-page-2" });

  const wa3Msg = `runtime-wa3-${stamp}`;
  const wa4Msg = `runtime-wa4-${stamp}`;
  const page2Msg = `runtime-page2-${stamp}`;
  const unknownWaMsg = `runtime-wa-unknown-${stamp}`;
  const unknownPageMsg = `runtime-page-unknown-${stamp}`;

  const wa3 = await webhook("/webhooks/whatsapp", whatsappPayload({ phoneNumberId: "test-phone-id-3", messageId: wa3Msg, from: "01000000003", text: `runtime wa3 ${stamp}` }));
  const wa4 = await webhook("/webhooks/whatsapp", whatsappPayload({ phoneNumberId: "test-phone-id-4", messageId: wa4Msg, from: "01000000004", text: `runtime wa4 ${stamp}` }));
  const unknownWa = await webhook("/webhooks/whatsapp", whatsappPayload({ phoneNumberId: "unknown-phone-id-runtime", messageId: unknownWaMsg, from: "01099999999", text: `runtime unknown wa ${stamp}` }));
  const msgr = await webhook("/webhooks/messenger", messengerPayload({ pageId: "test-page-2", messageId: page2Msg, psid: `psid-runtime-${stamp}`, text: `runtime page2 ${stamp}` }));
  const unknownMsgr = await webhook("/webhooks/messenger", messengerPayload({ pageId: "unknown-page-runtime", messageId: unknownPageMsg, psid: `psid-unknown-${stamp}`, text: `runtime unknown page ${stamp}` }));

  const wa3Db = await messageByExternalId(db, wa3Msg);
  const wa4Db = await messageByExternalId(db, wa4Msg);
  const page2Db = await messageByExternalId(db, page2Msg);
  const unknownWaDb = await messageByExternalId(db, unknownWaMsg);
  const unknownPageDb = await messageByExternalId(db, unknownPageMsg);

  const reply = await api(`/conversations/${wa3Db.conversationId}/messages`, { method: "POST", body: { text: `runtime reply ${stamp}`, clientMessageId: `runtime-client-${stamp}` } });
  const outboundId = reply.body.message?.externalMessageId;
  const delivered = await webhook("/webhooks/whatsapp", whatsappStatusPayload({ phoneNumberId: "test-phone-id-3", externalMessageId: outboundId, status: "delivered", timestamp: 1780000001 }));
  const beforeDuplicateCount = await db.messageDeliveryStatus.count({ where: { messageId: reply.body.message.id, status: "delivered" } });
  const deliveredDuplicate = await webhook("/webhooks/whatsapp", whatsappStatusPayload({ phoneNumberId: "test-phone-id-3", externalMessageId: outboundId, status: "delivered", timestamp: 1780000001 }));
  const afterDuplicateCount = await db.messageDeliveryStatus.count({ where: { messageId: reply.body.message.id, status: "delivered" } });
  const read = await webhook("/webhooks/whatsapp", whatsappStatusPayload({ phoneNumberId: "test-phone-id-3", externalMessageId: outboundId, status: "read", timestamp: 1780000002 }));
  const failed = await webhook("/webhooks/whatsapp", whatsappStatusPayload({ phoneNumberId: "test-phone-id-3", externalMessageId: outboundId, status: "failed", timestamp: 1780000003 }));
  const finalOutbound = await db.message.findUnique({ where: { id: reply.body.message.id } });

  const checks = {
    account3CreatedOrFound: Boolean(account3?.id),
    account4CreatedOrFound: Boolean(account4?.id),
    page2CreatedOrFound: Boolean(page2?.id),
    whatsapp3RoutesCorrectly: wa3.status === 200 && wa3Db?.channelAccountId === account3.id,
    whatsapp4RoutesCorrectly: wa4.status === 200 && wa4Db?.channelAccountId === account4.id,
    whatsappNoCrossRouting: wa3Db?.channelAccountId !== account4.id && wa4Db?.channelAccountId !== account3.id,
    unknownWhatsappIgnored: unknownWa.body?.ignored === true && !unknownWaDb,
    messengerPage2RoutesCorrectly: msgr.status === 200 && page2Db?.channelAccountId === page2.id,
    unknownMessengerIgnored: unknownMsgr.body?.ignored === true && !unknownPageDb,
    outboundUsesConversationAccount: reply.status === 201 && Boolean(outboundId),
    deliveredStatusWorks: delivered.status === 200,
    deliveredDuplicateIdempotent: deliveredDuplicate.status === 200 && beforeDuplicateCount === afterDuplicateCount,
    readStatusWorks: read.status === 200,
    failedStatusWorks: failed.status === 200 && finalOutbound?.status === "failed"
  };
  const pass = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    pass,
    checks,
    accounts: {
      whatsapp3: { id: account3.id, phoneNumberId: account3.phoneNumberId },
      whatsapp4: { id: account4.id, phoneNumberId: account4.phoneNumberId },
      messengerPage2: { id: page2.id, pageId: page2.pageId }
    },
    http: {
      wa3: wa3.status,
      wa4: wa4.status,
      unknownWa: unknownWa.status,
      messenger: msgr.status,
      unknownMessenger: unknownMsgr.status,
      delivered: delivered.status,
      deliveredDuplicate: deliveredDuplicate.status,
      read: read.status,
      failed: failed.status
    }
  }, null, 2));
  if (!pass) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
}).finally(() => disconnectPrisma().catch(() => {}));
