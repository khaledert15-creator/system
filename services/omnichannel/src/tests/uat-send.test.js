const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createApp, buildContainer } = require("../app");
const { env } = require("../config/env");
const { InMemoryRepository } = require("../repositories/in-memory.repository");

function signedUser(user = { id: "U001", username: "owner", role: "ظ…ط§ظ„ظƒ" }) {
  const header = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.sessionBridgeSecret).update(header).digest("hex");
  return { "X-Omni-User": header, "X-Omni-Signature": signature, "Content-Type": "application/json" };
}

function runtime() {
  const repository = new InMemoryRepository();
  repository.channelsData = [
    { id: "ch_whatsapp", key: "whatsapp", name: "WhatsApp", provider: "meta" },
    { id: "ch_messenger", key: "messenger", name: "Messenger", provider: "meta" }
  ];
  repository.channelAccountsData = [
    { id: "acc_wa", channelId: "ch_whatsapp", name: "WhatsApp Mock", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, phoneNumberId: "uat-phone", configuration: {} },
    { id: "acc_msgr", channelId: "ch_messenger", name: "Messenger Mock", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, pageId: "uat-page", configuration: {} }
  ];
  const container = buildContainer(repository);
  const server = createApp(container).listen(0);
  return { repository, container, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function api(baseUrl, path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...signedUser(), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
}

async function seedConversation(container, repository, accountId, identity) {
  const account = await repository.findChannelAccount(accountId);
  return container.webhookService.processInbound({
    provider: account.channel.key,
    channelAccount: account,
    externalIdentityId: identity,
    phone: account.channel.key === "whatsapp" ? identity : undefined,
    displayName: "UAT Customer",
    externalMessageId: `uat-in-${accountId}-${Date.now()}`,
    text: "hello",
    payload: { uat: true }
  });
}

test("local CORS preflight allows main app origin and session bridge header", async () => {
  const { server, baseUrl } = runtime();
  try {
    const response = await fetch(`${baseUrl}/api/conversations`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:8765",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-session-token"
      }
    });
    assert.equal([200, 204].includes(response.status), true);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:8765");
  } finally {
    server.close();
  }
});

test("WhatsApp and Messenger mock sends persist sentByUserId and sent status", async () => {
  const { repository, container, server, baseUrl } = runtime();
  try {
    const wa = await seedConversation(container, repository, "acc_wa", "01011111111");
    const msgr = await seedConversation(container, repository, "acc_msgr", "psid-uat");
    const waSend = await api(baseUrl, `/api/conversations/${wa.conversation.id}/messages`, { method: "POST", body: { text: "رد واتساب 🌷", clientMessageId: "uat-wa-1" } });
    const msgrSend = await api(baseUrl, `/api/conversations/${msgr.conversation.id}/messages`, { method: "POST", body: { text: "رد ماسنجر 👍", clientMessageId: "uat-msgr-1" } });
    assert.equal(waSend.status, 201);
    assert.equal(msgrSend.status, 201);
    assert.equal(waSend.body.message.sentByUserId, "U001");
    assert.equal(msgrSend.body.message.sentByUserId, "U001");
    assert.equal(waSend.body.message.status, "sent");
    assert.equal(msgrSend.body.message.status, "sent");
  } finally {
    server.close();
  }
});

test("empty message is blocked and repeated clientMessageId does not duplicate", async () => {
  const { repository, container, server, baseUrl } = runtime();
  try {
    const wa = await seedConversation(container, repository, "acc_wa", "01022222222");
    const empty = await api(baseUrl, `/api/conversations/${wa.conversation.id}/messages`, { method: "POST", body: { text: "", clientMessageId: "empty" } });
    assert.equal(empty.status, 400);
    const first = await api(baseUrl, `/api/conversations/${wa.conversation.id}/messages`, { method: "POST", body: { text: "مرة واحدة", clientMessageId: "dup-1" } });
    const second = await api(baseUrl, `/api/conversations/${wa.conversation.id}/messages`, { method: "POST", body: { text: "مرة واحدة", clientMessageId: "dup-1" } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(repository.messages.filter(item => item.clientMessageId === "dup-1").length, 1);
  } finally {
    server.close();
  }
});
