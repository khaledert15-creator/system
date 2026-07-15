const crypto = require("crypto");
const { getPrisma, disconnectPrisma } = require("../src/config/database");
const { env } = require("../src/config/env");

const BASE = process.env.OMNI_E2E_BASE || "http://127.0.0.1:8775";

function signedUser(user = { id: "U001", username: "owner", role: "ظ…ط§ظ„ظƒ", name: "Owner" }) {
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function ensureTemplate(db, provider = "whatsapp") {
  const found = await db.messageTemplate.findFirst({ where: { provider, templateName: "order_followup", isActive: true } });
  if (found) return found;
  return db.messageTemplate.create({
    data: {
      provider,
      templateName: "order_followup",
      languageCode: "ar",
      status: "approved",
      category: "utility",
      components: { body: "مرحبًا {{name}}، نتابع طلبك {{order_no}}" },
      variablesSchema: { required: ["name", "order_no"] }
    }
  });
}

async function mockInbound(path, body) {
  return api(path, { method: "POST", body });
}

async function upload(filename, mimeType, content) {
  const uploaded = await api("/media/upload", {
    method: "POST",
    body: { filename, mimeType, dataBase64: Buffer.from(content).toString("base64") }
  });
  if (uploaded.status !== 201) throw new Error(`upload failed: ${uploaded.status} ${JSON.stringify(uploaded.body)}`);
  return uploaded.body.media;
}

async function messageByExternalId(db, externalMessageId) {
  return db.message.findFirst({ where: { externalMessageId }, include: { conversation: true } });
}

async function main() {
  const db = getPrisma();
  const stamp = Date.now();
  const account = await ensureAccount({
    channelKey: "whatsapp",
    name: "WhatsApp Messaging Core Test",
    phoneNumber: "+201000000088",
    phoneNumberId: "test-phone-messaging-core"
  });
  await ensureAccount({ channelKey: "messenger", name: "Messenger Messaging Core Test", pageId: "test-page-messaging-core" });
  const template = await ensureTemplate(db);

  await db.channelAccount.update({ where: { id: account.id }, data: { configuration: {} } });

  const inboundId = `runtime-media-in-${stamp}`;
  const inbound = await mockInbound("/mock/whatsapp/incoming", {
    channelAccountId: account.id,
    phone: `010${String(stamp).slice(-8)}`,
    name: "Messaging Core Customer",
    externalMessageId: inboundId,
    text: "صورة مرفقة",
    messageType: "image",
    media: {
      mediaStorageKey: `provider/mock/${stamp}.png`,
      mediaFilename: "provider-image.png",
      mediaMimeType: "image/png",
      mediaSize: 18,
      mediaMetadata: { source: "runtime" }
    }
  });
  const inboundDb = inbound.body.message?.id
    ? await db.message.findUnique({ where: { id: inbound.body.message.id }, include: { conversation: true } })
    : await messageByExternalId(db, inboundId);

  const uploadedImage = await upload("reply.png", "image/png", "fake-png-runtime");
  const mediaDownload = await fetch(`${BASE}${uploadedImage.mediaUrl}`, { headers: signedUser() });
  const imageReply = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: {
      text: "رد بصورة",
      messageType: "image",
      media: uploadedImage,
      caption: "رد بصورة",
      replyToMessageId: inboundDb.id,
      clientMessageId: `runtime-image-${stamp}`
    }
  });

  const beforeNotes = await db.messageDeliveryStatus.count({ where: { message: { conversationId: inboundDb.conversationId } } });
  const internalNote = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: { mode: "internal_note", text: "ملاحظة داخلية لا ترسل للعميل", clientMessageId: `runtime-note-${stamp}` }
  });
  const afterNotes = await db.messageDeliveryStatus.count({ where: { message: { conversationId: inboundDb.conversationId } } });

  await db.conversation.update({
    where: { id: inboundDb.conversationId },
    data: { lastInboundAt: new Date(Date.now() - 26 * 3600000) }
  });
  const blockedOutsideWindow = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: { text: "رسالة خارج نافذة واتساب", clientMessageId: `runtime-block-${stamp}` }
  });
  const templateReply = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: {
      templateId: template.id,
      templateVariables: { name: "عميل", order_no: "ORD-RUNTIME" },
      clientMessageId: `runtime-template-${stamp}`
    }
  });

  await db.conversation.update({
    where: { id: inboundDb.conversationId },
    data: { lastInboundAt: new Date() }
  });
  await db.channelAccount.update({ where: { id: account.id }, data: { configuration: { mockFailureMode: "retryable_once" } } });
  const retryable = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: { text: "اختبار retry", clientMessageId: `runtime-retry-${stamp}` }
  });
  const retryMessageId = retryable.body.message?.id;
  await db.channelAccount.update({ where: { id: account.id }, data: { configuration: {} } });
  await db.outboundMessageJob.updateMany({
    where: { messageId: retryMessageId },
    data: { nextAttemptAt: new Date(Date.now() - 1000), lockedAt: null, lockedBy: null }
  });
  await sleep(3500);
  const retriedMessage = await db.message.findUnique({ where: { id: retryMessageId } });
  const retryJob = await db.outboundMessageJob.findFirst({ where: { messageId: retryMessageId }, orderBy: { createdAt: "desc" } });

  await db.channelAccount.update({ where: { id: account.id }, data: { configuration: { mockFailureMode: "permanent" } } });
  const permanent = await api(`/conversations/${inboundDb.conversationId}/messages`, {
    method: "POST",
    body: { text: "اختبار فشل دائم", clientMessageId: `runtime-permanent-${stamp}` }
  });
  const permanentJobs = await db.outboundMessageJob.count({ where: { messageId: permanent.body.message?.id } });
  await db.channelAccount.update({ where: { id: account.id }, data: { configuration: {} } });

  const closed = await api(`/conversations/${inboundDb.conversationId}/close`, { method: "POST" });
  const reopened = await api(`/conversations/${inboundDb.conversationId}/reopen`, { method: "POST" });
  const released = await api(`/conversations/${inboundDb.conversationId}/release`, { method: "POST" });
  const search = await api(`/conversations?search=${encodeURIComponent("Messaging Core Customer")}`);

  const imageDb = imageReply.body.message?.id ? await db.message.findUnique({ where: { id: imageReply.body.message.id } }) : null;
  const noteDb = internalNote.body.message?.id ? await db.message.findUnique({ where: { id: internalNote.body.message.id } }) : null;
  const templateDb = templateReply.body.message?.id ? await db.message.findUnique({ where: { id: templateReply.body.message.id } }) : null;

  const checks = {
    mockInboundMediaPersisted: inbound.status === 201 && inboundDb?.messageType === "image" && Boolean(inboundDb.mediaStorageKey),
    mediaUploadAndDownloadWork: mediaDownload.status === 200 && Boolean(uploadedImage.mediaStorageKey),
    outboundImageSentWithReplyTo: imageReply.status === 201 && imageDb?.status === "sent" && imageDb?.messageType === "image" && imageDb?.replyToMessageId === inboundDb.id,
    internalNoteNotSentToProvider: internalNote.status === 201 && noteDb?.messageType === "internal_note" && !noteDb.externalMessageId && beforeNotes === afterNotes,
    whatsappWindowBlocksFreeForm: blockedOutsideWindow.status === 400,
    templateAllowedOutsideWindow: templateReply.status === 201 && templateDb?.messageType === "template" && templateDb?.status === "sent",
    retryableCreatesJobAndWorkerCompletes: retryable.status === 201 && retryable.body.message?.status === "retry_pending" && retriedMessage?.status === "sent" && retryJob?.status === "completed",
    permanentFailureDoesNotAutoRetry: permanent.status === 502 && permanent.body.message?.status === "failed" && permanentJobs === 0,
    lifecycleWorks: closed.status === 200 && reopened.status === 200 && released.status === 200,
    searchFindsConversation: search.status === 200 && (search.body.conversations || []).some(item => item.id === inboundDb.conversationId)
  };
  const pass = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({
    pass,
    checks,
    account: { id: account.id, phoneNumberId: account.phoneNumberId },
    conversationId: inboundDb.conversationId,
    messageIds: {
      inbound: inboundDb.id,
      imageReply: imageDb?.id,
      internalNote: noteDb?.id,
      template: templateDb?.id,
      retryable: retryMessageId,
      permanent: permanent.body.message?.id
    },
    retry: { messageStatus: retriedMessage?.status, jobStatus: retryJob?.status, attempts: retryJob?.attemptCount },
    http: {
      inbound: inbound.status,
      imageReply: imageReply.status,
      internalNote: internalNote.status,
      blockedOutsideWindow: blockedOutsideWindow.status,
      templateReply: templateReply.status,
      retryable: retryable.status,
      permanent: permanent.status,
      mediaDownload: mediaDownload.status
    }
  }, null, 2));
  if (!pass) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
}).finally(() => disconnectPrisma().catch(() => {}));
