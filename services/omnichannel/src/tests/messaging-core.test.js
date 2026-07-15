const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { createApp, buildContainer } = require("../app");
const { env } = require("../config/env");
const { InMemoryRepository } = require("../repositories/in-memory.repository");
const { LocalStorageProvider } = require("../storage/local-storage.provider");
const { MediaService } = require("../services/media.service");

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
    { id: "acc_wa", channelId: "ch_whatsapp", name: "WhatsApp Mock", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, phoneNumberId: "phone-window", configuration: {} },
    { id: "acc_msgr", channelId: "ch_messenger", name: "Messenger Mock", status: "mock_connected", connectionStatus: "mock_connected", isActive: true, pageId: "page-core", configuration: {} }
  ];
  repository.templates.push({ id: "tpl_approved", provider: "whatsapp", channelAccountId: null, templateName: "order_followup", languageCode: "ar", status: "approved", isActive: true, components: {}, variablesSchema: {}, createdAt: new Date(), updatedAt: new Date() });
  const container = buildContainer(repository);
  const app = createApp(container);
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { repository, container, server, baseUrl };
}

async function request(baseUrl, path, { method = "GET", user = { id: "U001", username: "owner", role: "مالك" }, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: signedUser(user), body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

async function seedConversation(container, repository, { accountId = "acc_wa", messageId = `in-${Date.now()}`, text = "hello" } = {}) {
  const account = await repository.findChannelAccount(accountId);
  return container.webhookService.processInbound({
    provider: account.channel.key,
    channelAccount: account,
    externalIdentityId: account.channel.key === "whatsapp" ? "01000000001" : "psid-core",
    phone: account.channel.key === "whatsapp" ? "01000000001" : undefined,
    displayName: "Core Customer",
    externalMessageId: messageId,
    text,
    payload: { test: true }
  });
}

test("secure upload accepts image/pdf and rejects executable and oversized files", async () => {
  const mediaService = new MediaService({ storage: new LocalStorageProvider({ root: path.join(os.tmpdir(), `omni-test-${Date.now()}`) }) });
  const image = await mediaService.saveBase64({ filename: "photo.png", mimeType: "image/png", dataBase64: Buffer.from("fake-png").toString("base64") });
  assert.equal(image.messageType, "image");
  const pdf = await mediaService.saveBase64({ filename: "doc.pdf", mimeType: "application/pdf", dataBase64: Buffer.from("%PDF").toString("base64") });
  assert.equal(pdf.messageType, "document");
  await assert.rejects(() => mediaService.saveBase64({ filename: "run.exe", mimeType: "application/octet-stream", dataBase64: Buffer.from("bad").toString("base64") }), /Executable files/);
  await assert.rejects(() => mediaService.saveBase64({ filename: "large.png", mimeType: "image/png", dataBase64: Buffer.alloc(env.uploadMaxBytes + 1).toString("base64") }), /too large/);
});

test("agent sends image and document mock messages", async () => {
  const { repository, container, server } = buildRuntime();
  try {
    const inbound = await seedConversation(container, repository);
    const user = { id: "U001", permissions: ["omni:send", "omni:admin"] };
    const image = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "image caption", messageType: "image", media: { messageType: "image", mediaStorageKey: "img-key", mediaFilename: "x.png", mediaMimeType: "image/png", mediaSize: 10 }, clientId: "img-1" });
    const doc = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "doc caption", messageType: "document", media: { messageType: "document", mediaStorageKey: "doc-key", mediaFilename: "x.pdf", mediaMimeType: "application/pdf", mediaSize: 10 }, clientId: "doc-1" });
    assert.equal(image.message.status, "sent");
    assert.equal(doc.message.status, "sent");
    assert.equal(repository.messages.some(item => item.messageType === "image"), true);
    assert.equal(repository.messages.some(item => item.messageType === "document"), true);
  } finally { server.close(); }
});

test("incoming mock image and document persist with metadata", async () => {
  const { repository, server, baseUrl } = buildRuntime();
  try {
    const image = await request(baseUrl, "/api/mock/whatsapp/incoming", { method: "POST", body: { channelAccountId: "acc_wa", phone: "01000000001", text: "incoming image", messageType: "image", media: { mediaStorageKey: "incoming-img", mediaFilename: "in.png", mediaMimeType: "image/png", mediaSize: 12, mediaMetadata: { source: "mock" } } } });
    const doc = await request(baseUrl, "/api/mock/messenger/incoming", { method: "POST", body: { channelAccountId: "acc_msgr", psid: "psid-doc", text: "incoming doc", messageType: "document", media: { mediaStorageKey: "incoming-doc", mediaFilename: "in.pdf", mediaMimeType: "application/pdf", mediaSize: 12 } } });
    assert.equal(image.status, 201);
    assert.equal(doc.status, 201);
    assert.equal(repository.messages.some(item => item.messageType === "image" && item.mediaStorageKey === "incoming-img"), true);
    assert.equal(repository.messages.some(item => item.messageType === "document" && item.mediaStorageKey === "incoming-doc"), true);
  } finally { server.close(); }
});

test("reply-to is stored and internal note is not sent to provider", async () => {
  const { repository, container, server } = buildRuntime();
  try {
    const inbound = await seedConversation(container, repository);
    const user = { id: "U001", permissions: ["omni:send", "omni:admin"] };
    const reply = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "replying", replyToMessageId: inbound.message.id, clientId: "reply-to-1" });
    assert.equal(reply.message.replyToMessageId, inbound.message.id);
    const beforeDelivery = repository.deliveryStatuses.length;
    const note = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "internal only", mode: "internal_note", clientId: "note-1" });
    assert.equal(note.message.messageType, "internal_note");
    assert.equal(note.message.sentByUserId, "U001");
    assert.equal(note.message.externalMessageId || null, null);
    assert.equal(repository.deliveryStatuses.length, beforeDelivery);
  } finally { server.close(); }
});

test("WhatsApp service window allows inside, blocks outside, and template mock succeeds", async () => {
  const { repository, container, server } = buildRuntime();
  try {
    const inbound = await seedConversation(container, repository);
    const user = { id: "U001", permissions: ["omni:send", "omni:admin"] };
    const inside = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "inside window", clientId: "inside-window" });
    assert.equal(inside.message.status, "sent");
    const conversation = repository.conversations.find(item => item.id === inbound.conversation.id);
    conversation.lastInboundAt = new Date(Date.now() - 26 * 3600000);
    await assert.rejects(() => container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "outside window", clientId: "outside-window" }), /service window expired/);
    const template = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "", templateId: "tpl_approved", templateVariables: { name: "Core", order_no: "ORD" }, clientId: "tpl-1" });
    assert.equal(template.message.messageType, "template");
    assert.equal(template.message.status, "sent");
  } finally { server.close(); }
});

test("retryable failure creates job, worker retries, permanent failure does not auto retry", async () => {
  const { repository, container, server } = buildRuntime();
  try {
    const inbound = await seedConversation(container, repository);
    const user = { id: "U001", permissions: ["omni:send", "omni:admin"] };
    repository.channelAccountsData.find(item => item.id === "acc_wa").configuration.mockFailureMode = "retryable_once";
    const retryable = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "retry me", clientId: "retry-1" });
    assert.equal(retryable.message.status, "retry_pending");
    assert.equal(repository.jobs.length, 1);
    repository.channelAccountsData.find(item => item.id === "acc_wa").configuration.mockFailureMode = "";
    repository.jobs[0].nextAttemptAt = new Date(Date.now() - 1000);
    const workerResult = await container.retryJob.run({ limit: 1 });
    assert.equal(workerResult.processed, 1);
    assert.equal(repository.messages.find(item => item.id === retryable.message.id).status, "sent");

    repository.channelAccountsData.find(item => item.id === "acc_wa").configuration.mockFailureMode = "permanent";
    const permanent = await container.messageService.sendOutbound({ conversationId: inbound.conversation.id, user, text: "fail permanently", clientId: "perm-1" });
    assert.equal(permanent.message.status, "failed");
    assert.equal(repository.jobs.filter(item => item.messageId === permanent.message.id).length, 0);
  } finally { server.close(); }
});

test("conversation lifecycle and server-side search/filter work", async () => {
  const { repository, container, server, baseUrl } = buildRuntime();
  try {
    const inbound = await seedConversation(container, repository, { text: "searchable phone case" });
    const closed = await request(baseUrl, `/api/conversations/${inbound.conversation.id}/close`, { method: "POST" });
    assert.equal(closed.body.conversation.status, "closed");
    const reopened = await request(baseUrl, `/api/conversations/${inbound.conversation.id}/reopen`, { method: "POST" });
    assert.equal(reopened.body.conversation.status, "waiting_agent");
    const released = await request(baseUrl, `/api/conversations/${inbound.conversation.id}/release`, { method: "POST" });
    assert.equal(released.body.conversation.assignedUserId || null, null);
    const search = await request(baseUrl, `/api/conversations?search=searchable`);
    assert.equal(search.body.conversations.some(item => item.id === inbound.conversation.id), true);
    const filtered = await request(baseUrl, `/api/conversations?channelAccountId=acc_wa`);
    assert.equal(filtered.body.conversations.every(item => item.channelAccountId === "acc_wa"), true);
  } finally { server.close(); }
});
