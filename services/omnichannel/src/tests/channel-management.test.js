const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createApp, buildContainer } = require("../app");
const { env } = require("../config/env");
const { InMemoryRepository } = require("../repositories/in-memory.repository");

env.verifyWebhookSignatures = false;

function signedUser(user) {
  const header = Buffer.from(JSON.stringify(user)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.sessionBridgeSecret).update(header).digest("hex");
  return { "X-Omni-User": header, "X-Omni-Signature": signature, "Content-Type": "application/json" };
}

function buildRuntime() {
  const repository = new InMemoryRepository();
  repository.channelsData = [
    { id: "ch_whatsapp", key: "whatsapp", name: "WhatsApp", provider: "meta" },
    { id: "ch_messenger", key: "messenger", name: "Messenger", provider: "meta" }
  ];
  repository.channelAccountsData = [
    { id: "acc_wa_2", channelId: "ch_whatsapp", name: "WhatsApp 2", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, phoneNumberId: "test-phone-id-2" },
    { id: "acc_page_1", channelId: "ch_messenger", name: "Page 1", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, pageId: "test-page-1" }
  ];
  const container = buildContainer(repository);
  const app = createApp(container);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { repository, container, server, baseUrl };
}

async function request(baseUrl, path, { method = "GET", user = { id: "U001", username: "owner", role: "مالك" }, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: signedUser(user),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

test("channel account API creates multiple WhatsApp accounts and rejects duplicate phone_number_id", async () => {
  const { server, baseUrl } = buildRuntime();
  try {
    const account3 = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "whatsapp", name: "WhatsApp Test 3", phoneNumber: "+201000000003", phoneNumberId: "test-phone-id-3", status: "mock_connected", connectionMode: "mock" }
    });
    assert.equal(account3.status, 201);
    assert.equal(account3.body.account.phoneNumberId, "test-phone-id-3");
    assert.equal(account3.body.account.credentialsConfigured, false);

    const account4 = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "whatsapp", name: "WhatsApp Test 4", phoneNumber: "+201000000004", phoneNumberId: "test-phone-id-4", status: "mock_connected", connectionMode: "mock" }
    });
    assert.equal(account4.status, 201);

    const duplicate = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "whatsapp", name: "Duplicate", phoneNumberId: "test-phone-id-3" }
    });
    assert.equal(duplicate.status, 409);
  } finally {
    server.close();
  }
});

test("channel account API creates multiple Messenger pages and rejects duplicate page_id", async () => {
  const { server, baseUrl } = buildRuntime();
  try {
    const page2 = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "messenger", name: "Messenger Page 2", pageId: "test-page-2", status: "mock_connected", connectionMode: "mock" }
    });
    assert.equal(page2.status, 201);

    const duplicate = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "messenger", name: "Duplicate Page", pageId: "test-page-2" }
    });
    assert.equal(duplicate.status, 409);
  } finally {
    server.close();
  }
});

test("regular agent cannot create channel accounts", async () => {
  const { server, baseUrl } = buildRuntime();
  try {
    const blocked = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      user: { id: "U004", username: "cashier", role: "كاشير" },
      body: { channelKey: "whatsapp", name: "Blocked", phoneNumberId: "blocked-phone-id" }
    });
    assert.equal(blocked.status, 403);
  } finally {
    server.close();
  }
});

test("test connection mock succeeds, deactivate and soft delete work", async () => {
  const { server, baseUrl } = buildRuntime();
  try {
    const created = await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "whatsapp", name: "Testable", phoneNumberId: "testable-phone-id", status: "mock_connected", connectionMode: "mock" }
    });
    const id = created.body.account.id;
    const tested = await request(baseUrl, `/api/channel-accounts/${id}/test-connection`, { method: "POST" });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.result.connectionStatus, "mock_connected");
    const deactivated = await request(baseUrl, `/api/channel-accounts/${id}/deactivate`, { method: "POST" });
    assert.equal(deactivated.body.account.isActive, false);
    const deleted = await request(baseUrl, `/api/channel-accounts/${id}`, { method: "DELETE" });
    assert.equal(deleted.body.account.deletedAt instanceof Date || Boolean(deleted.body.account.deletedAt), true);
  } finally {
    server.close();
  }
});

test("WhatsApp webhook routes by phone_number_id and does not fallback for unknown accounts", async () => {
  const { repository, server, baseUrl } = buildRuntime();
  try {
    await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "whatsapp", name: "WhatsApp Test 3", phoneNumberId: "test-phone-id-3", status: "mock_connected", connectionMode: "mock" }
    });
    const payload = {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "test-phone-id-3" }, contacts: [{ profile: { name: "WA3 Customer" } }], messages: [{ id: "wamid-test-3", from: "01000000003", timestamp: "1780000000", text: { body: "hello 3" } }] } }] }]
    };
    const response = await fetch(`${baseUrl}/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    const conversation = repository.conversations.find(item => item.subject === "hello 3");
    const account = repository.channelAccountsData.find(item => item.name === "WhatsApp Test 3");
    assert.equal(conversation.channelAccountId, account.id);

    const unknown = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "unknown-phone-id" }, messages: [{ id: "wamid-unknown", from: "01099999999", text: { body: "unknown" } }] } }] }] })
    });
    const unknownBody = await unknown.json();
    assert.equal(unknownBody.ignored, true);
    assert.equal(repository.conversations.some(item => item.subject === "unknown"), false);
  } finally {
    server.close();
  }
});

test("Messenger webhook routes by page_id and does not fallback for unknown pages", async () => {
  const { repository, server, baseUrl } = buildRuntime();
  try {
    await request(baseUrl, "/api/channel-accounts", {
      method: "POST",
      body: { channelKey: "messenger", name: "Messenger Page 2", pageId: "test-page-2", status: "mock_connected", connectionMode: "mock" }
    });
    const response = await fetch(`${baseUrl}/webhooks/messenger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ id: "test-page-2", messaging: [{ sender: { id: "psid-page-2" }, timestamp: 1780000000000, message: { mid: "mid-page-2", text: "hello page 2" } }] }] })
    });
    assert.equal(response.status, 200);
    const conversation = repository.conversations.find(item => item.subject === "hello page 2");
    const account = repository.channelAccountsData.find(item => item.name === "Messenger Page 2");
    assert.equal(conversation.channelAccountId, account.id);

    const unknown = await fetch(`${baseUrl}/webhooks/messenger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ id: "unknown-page", messaging: [{ sender: { id: "psid-unknown" }, message: { mid: "mid-unknown", text: "unknown page" } }] }] })
    });
    const unknownBody = await unknown.json();
    assert.equal(unknownBody.ignored, true);
    assert.equal(repository.conversations.some(item => item.subject === "unknown page"), false);
  } finally {
    server.close();
  }
});

test("WhatsApp delivered/read/failed status callbacks update message idempotently", async () => {
  const { repository, server, baseUrl } = buildRuntime();
  try {
    const inboundPayload = { provider: "whatsapp", channelAccount: await repository.findChannelAccount("acc_wa_2"), externalIdentityId: "01000000001", phone: "01000000001", displayName: "Customer", externalMessageId: "incoming-for-status", text: "need reply", payload: {} };
    const container = buildContainer(repository);
    const inbound = await container.webhookService.processInbound(inboundPayload);
    const sent = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user: { id: "U001", permissions: ["omni:send", "omni:admin"] }, text: "reply", clientId: "status-client-1" });
    const externalMessageId = sent.message.externalMessageId;

    for (const status of ["delivered", "read", "failed"]) {
      const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "test-phone-id-2" }, statuses: [{ id: externalMessageId, status, timestamp: "1780000001", errors: status === "failed" ? [{ code: 131000, message: "mock failure" }] : undefined }] } }] }] };
      const first = await fetch(`${baseUrl}/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      assert.equal(first.status, 200);
      const before = repository.deliveryStatuses.length;
      const second = await fetch(`${baseUrl}/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      assert.equal(second.status, 200);
      assert.equal(repository.deliveryStatuses.length, before);
    }
    const message = repository.messages.find(item => item.id === sent.message.id);
    assert.equal(message.status, "failed");
  } finally {
    server.close();
  }
});
