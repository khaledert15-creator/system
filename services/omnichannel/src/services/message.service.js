const { clientMessageId } = require("../utils/ids");
const { forbidden, badRequest } = require("../utils/errors");
const { env } = require("../config/env");
const { classifyProviderError } = require("../utils/provider-errors");

const MEDIA_TYPES = new Set(["image", "document", "file", "audio", "video", "location", "contact"]);

class MessageService {
  constructor({ repository, providers, notifications, credentialService = null }) {
    this.repository = repository;
    this.providers = providers;
    this.notifications = notifications;
    this.credentialService = credentialService;
  }

  list(conversationId) {
    return this.repository.listMessages(conversationId);
  }

  assertCanSend(conversation, user) {
    if (!conversation) throw badRequest("Conversation not found");
    if (conversation.assignedUserId && conversation.assignedUserId !== user.id && !user.permissions.includes("omni:admin")) {
      throw forbidden("Conversation is assigned to another agent");
    }
  }

  serviceWindow(conversation) {
    const isWhatsApp = conversation.channelAccount?.channel?.key === "whatsapp";
    if (!isWhatsApp) return { applies: false, allowed: true };
    const lastInboundAt = conversation.lastInboundAt ? new Date(conversation.lastInboundAt) : null;
    const hours = Number(env.whatsappServiceWindowHours || 24);
    const expiresAt = lastInboundAt ? new Date(lastInboundAt.getTime() + hours * 3600000) : null;
    const allowed = Boolean(expiresAt && expiresAt >= new Date());
    return { applies: true, allowed, lastInboundAt, expiresAt, hours };
  }

  async addInbound({ conversation, channelAccount, externalMessageId, text, payload, providerTimestamp, messageType = "text", media = {}, caption = null }) {
    const result = await this.repository.createInboundMessage({
      conversationId: conversation.id,
      channelAccountId: channelAccount.id,
      externalMessageId,
      textContent: text,
      payload,
      providerTimestamp,
      messageType,
      media,
      caption
    });
    if (!result.duplicate) {
      this.notifications.messageCreated({ conversationId: conversation.id, message: result.message });
      this.notifications.conversationUpdated({ conversationId: conversation.id, unread: true });
    }
    return result;
  }

  async createInternalNote({ conversationId, user, text, clientId, replyToMessageId }) {
    const conversation = await this.repository.getConversation(conversationId);
    this.assertCanSend(conversation, user);
    const created = await this.repository.createOutboundMessage({
      conversationId,
      channelAccountId: conversation.channelAccountId,
      userId: user.id,
      textContent: text,
      clientMessageId: clientId || clientMessageId(),
      payload: { internal: true },
      messageType: "internal_note",
      replyToMessageId,
      senderType: "agent",
      status: "sent"
    });
    if (!created.duplicate) {
      await this.repository.createConversationEvent({ conversationId, eventType: "internal_note.created", actorType: "agent", actorUserId: user.id, messageId: created.message.id, payload: {} });
      await this.repository.createActivity({ userId: user.id, action: "internal_note.created", conversationId, messageId: created.message.id });
      this.notifications.messageCreated({ conversationId, message: created.message });
    }
    return created;
  }

  async sendOutbound({ conversationId, user, text = "", clientId, messageType = "text", media = {}, caption = null, replyToMessageId = null, mode = "reply", templateId = null, templateVariables = {} }) {
    if (mode === "internal_note" || messageType === "internal_note") {
      return this.createInternalNote({ conversationId, user, text, clientId, replyToMessageId });
    }
    const conversation = await this.repository.getConversation(conversationId);
    this.assertCanSend(conversation, user);
    const windowState = this.serviceWindow(conversation);
    if (windowState.applies && !windowState.allowed && !templateId) {
      throw badRequest("WhatsApp service window expired. Use an approved template.", { windowState });
    }
    if (!text && !media.mediaStorageKey && !templateId) throw badRequest("Message text or attachment is required");
    const idempotencyKey = clientId || clientMessageId();
    const template = templateId ? await this.repository.findTemplate(templateId) : null;
    if (templateId && !template) throw badRequest("Template not found");
    const effectiveType = template ? "template" : (messageType || (media.mediaStorageKey ? media.messageType : "text"));
    const created = await this.repository.createOutboundMessage({
      conversationId,
      channelAccountId: conversation.channelAccountId,
      userId: user.id,
      textContent: text,
      clientMessageId: idempotencyKey,
      payload: { templateId, templateVariables, windowState },
      messageType: effectiveType,
      media,
      caption,
      replyToMessageId,
      status: "pending"
    });
    if (created.duplicate) return created;
    return this.deliverOutbound({ message: created.message, conversation, user, template, templateVariables, clientMessageId: idempotencyKey });
  }

  async deliverOutbound({ message, conversation, user, template = null, templateVariables = {}, clientMessageId: idempotencyKey }) {
    const provider = this.providers.forAccount(conversation.channelAccount);
    try {
      await this.repository.updateMessageStatus(message.id, { status: "sending" });
      const accessToken = this.credentialService ? await this.credentialService.accessTokenForAccount(conversation.channelAccountId) : null;
      let sent;
      if (template) {
        sent = await provider.sendTemplate({ channelAccount: conversation.channelAccount, conversation, template, variables: templateVariables, clientMessageId: idempotencyKey, credentials: { accessToken } });
      } else if (MEDIA_TYPES.has(message.messageType) || message.mediaStorageKey) {
        sent = await provider.sendMedia({ channelAccount: conversation.channelAccount, conversation, message, clientMessageId: idempotencyKey, credentials: { accessToken } });
      } else {
        sent = await provider.sendText({ channelAccount: conversation.channelAccount, conversation, text: message.textContent || "", clientMessageId: idempotencyKey, credentials: { accessToken } });
      }
      const updated = await this.repository.updateMessageStatus(message.id, {
        status: "sent",
        externalMessageId: sent.externalMessageId,
        payload: { ...(message.payload || {}), provider: sent.raw || {} }
      });
      await this.repository.createDeliveryStatus({ messageId: updated.id, status: "sent", providerStatus: "sent", rawPayload: sent.raw || {} });
      await this.repository.createConversationEvent({ conversationId: conversation.id, eventType: "message.sent", actorType: "agent", actorUserId: user?.id || message.sentByUserId, messageId: updated.id, payload: { clientMessageId: idempotencyKey, externalMessageId: sent.externalMessageId || null } });
      await this.repository.createActivity({ userId: user?.id || message.sentByUserId || "system", action: "message.sent", conversationId: conversation.id, messageId: updated.id });
      this.notifications.messageCreated({ conversationId: conversation.id, message: updated });
      return { message: updated, duplicate: false };
    } catch (error) {
      const classification = classifyProviderError(error);
      if (classification.retryable) {
        const updated = await this.repository.updateMessageStatus(message.id, { status: "retry_pending", payload: { ...(message.payload || {}), error: error.message, retryable: true } });
        await this.repository.createDeliveryStatus({ messageId: message.id, status: "retry_pending", providerStatus: "retry_pending", errorCode: classification.code, errorMessage: error.message, rawPayload: {} });
        if (!await this.repository.jobForMessage(message.id)) {
          await this.repository.createOutboundJob({ messageId: message.id, maxAttempts: Number(env.retryMaxAttempts || 3), nextAttemptAt: new Date(Date.now() + 1000), status: "retry", lastError: error.message, errorCode: classification.code });
        }
        return { message: updated, duplicate: false, retry: true, error: error.message };
      }
      const failed = await this.repository.updateMessageStatus(message.id, { status: "failed", payload: { ...(message.payload || {}), error: error.message, permanent: true } });
      await this.repository.createDeliveryStatus({ messageId: message.id, status: "failed", providerStatus: "failed", errorCode: classification.code, errorMessage: error.message, rawPayload: {} });
      return { message: failed, duplicate: false, error: error.message };
    }
  }

  async retryMessage({ messageId, user = null, manual = false }) {
    const message = await this.repository.getMessageWithConversation(messageId);
    if (!message) throw badRequest("Message not found");
    const conversation = message.conversation || await this.repository.getConversation(message.conversationId);
    if (manual && user) await this.repository.createActivity({ userId: user.id, action: "message.manual_retry", conversationId: message.conversationId, messageId });
    return this.deliverOutbound({ message, conversation, user: user || { id: message.sentByUserId || "retry-worker", permissions: ["omni:admin"] }, clientMessageId: message.clientMessageId });
  }

  async simulateStatus({ messageId, status }) {
    const message = await this.repository.updateMessageStatus(messageId, { status });
    await this.repository.createDeliveryStatus({ messageId, status, providerStatus: status, rawPayload: { mock: true } });
    this.notifications.messageCreated({ conversationId: message.conversationId, message });
    return message;
  }

  async applyProviderStatus({ channelAccount, externalMessageId, status, providerStatus, providerTimestamp, errorCode, errorMessage, rawPayload }) {
    if (!externalMessageId) return { ignored: true, reason: "missing_external_message_id" };
    const message = await this.repository.findMessageByExternalId({ channelAccountId: channelAccount.id, externalMessageId });
    if (!message) return { ignored: true, reason: "message_not_found" };
    const normalized = ["sent", "delivered", "read", "failed"].includes(status) ? status : "sent";
    const delivery = await this.repository.createDeliveryStatusIdempotent({
      messageId: message.id,
      status: normalized,
      providerStatus: providerStatus || normalized,
      providerTimestamp: providerTimestamp || new Date(),
      errorCode: errorCode || null,
      errorMessage: errorMessage || null,
      rawPayload: rawPayload || {}
    });
    const updated = await this.repository.updateMessageStatus(message.id, {
      status: normalized,
      ...(normalized === "failed" ? { payload: { ...(message.payload || {}), error: errorMessage || errorCode || "provider_failed" } } : {})
    });
    this.notifications.messageCreated({ conversationId: message.conversationId, message: updated });
    return { message: updated, duplicate: delivery.duplicate };
  }
}

module.exports = { MessageService, MEDIA_TYPES };
