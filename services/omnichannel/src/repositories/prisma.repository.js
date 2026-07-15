const { eventHash, id } = require("../utils/ids");

function hasExpectedVersion(value) {
  return value !== undefined && value !== null && value !== "";
}

function versionConflict(currentVersion) {
  const error = new Error("Conversation version conflict");
  error.status = 409;
  error.code = "CONFLICT";
  error.details = { currentVersion };
  return error;
}

class PrismaRepository {
  constructor(prisma) {
    this.db = prisma;
  }

  channels() {
    return this.db.channel.findMany({ orderBy: { name: "asc" } });
  }

  findChannelByKey(key) {
    return this.db.channel.findUnique({ where: { key } });
  }

  channelAccounts() {
    return this.db.channelAccount.findMany({ where: { deletedAt: null }, include: { channel: true, credentials: true }, orderBy: { name: "asc" } });
  }

  findChannelAccount(id) {
    return this.db.channelAccount.findFirst({ where: { id, deletedAt: null }, include: { channel: true, credentials: true } });
  }

  findChannelAccountByPhoneNumberId(phoneNumberId) {
    return this.db.channelAccount.findMany({
      where: { phoneNumberId, deletedAt: null, isActive: true },
      include: { channel: true, credentials: true }
    });
  }

  findChannelAccountByPageId(pageId) {
    return this.db.channelAccount.findMany({
      where: { pageId, deletedAt: null, isActive: true },
      include: { channel: true, credentials: true }
    });
  }

  createChannelAccount(data) {
    return this.db.channelAccount.create({ data, include: { channel: true, credentials: true } });
  }

  updateChannelAccount(idValue, data) {
    return this.db.channelAccount.update({ where: { id: idValue }, data, include: { channel: true, credentials: true } });
  }

  async softDeleteChannelAccount(idValue) {
    return this.db.channelAccount.update({
      where: { id: idValue },
      data: { deletedAt: new Date(), isActive: false, status: "deleted", connectionStatus: "disconnected" },
      include: { channel: true, credentials: true }
    });
  }

  async upsertChannelAccountCredential({ channelAccountId, credentialType, encryptedValue, keyVersion }) {
    return this.db.channelAccountCredential.upsert({
      where: { channelAccountId_credentialType: { channelAccountId, credentialType } },
      update: { encryptedValue, keyVersion: keyVersion || "v1", rotatedAt: new Date() },
      create: { channelAccountId, credentialType, encryptedValue, keyVersion: keyVersion || "v1" }
    });
  }

  channelAccountCredential(channelAccountId, credentialType) {
    return this.db.channelAccountCredential.findUnique({
      where: { channelAccountId_credentialType: { channelAccountId, credentialType } }
    });
  }

  async findOrCreateContact({ channelAccountId, provider, externalIdentityId, normalizedPhone, displayName, customerId }) {
    const existingIdentity = await this.db.contactIdentity.findUnique({
      where: { channelAccountId_externalIdentityId: { channelAccountId, externalIdentityId } },
      include: { contact: true }
    });
    if (existingIdentity) return { contact: existingIdentity.contact, identity: existingIdentity, created: false };

    let contact = normalizedPhone
      ? await this.db.contact.findFirst({ where: { primaryPhone: normalizedPhone, deletedAt: null } })
      : null;
    if (!contact) {
      contact = await this.db.contact.create({ data: { displayName: displayName || normalizedPhone || externalIdentityId, primaryPhone: normalizedPhone || null, customerId: customerId || null } });
    } else if (customerId && !contact.customerId) {
      contact = await this.db.contact.update({ where: { id: contact.id }, data: { customerId } });
    }
    const identity = await this.db.contactIdentity.create({
      data: { contactId: contact.id, channelAccountId, provider, externalIdentityId, normalizedPhone: normalizedPhone || null, displayName: displayName || null }
    });
    return { contact, identity, created: true };
  }

  async findOrCreateConversation({ channelAccountId, contactId, customerId, onlineOrderId, saleId, shipmentId, subject }) {
    const existing = await this.db.conversation.findFirst({
      where: { channelAccountId, contactId, deletedAt: null, status: { not: "closed" } },
      orderBy: { updatedAt: "desc" }
    });
    if (existing) return { conversation: existing, created: false };
    const conversation = await this.db.conversation.create({
      data: {
        channelAccountId,
        contactId,
        customerId: customerId || null,
        onlineOrderId: onlineOrderId || null,
        saleId: saleId || null,
        shipmentId: shipmentId || null,
        subject: subject || null,
        lastMessageAt: new Date()
      }
    });
    await this.db.conversationParticipant.create({ data: { conversationId: conversation.id, participantType: "contact", contactId } });
    return { conversation, created: true };
  }

  async listConversations(filters = {}) {
    const where = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
    if (filters.channelAccountId) where.channelAccountId = filters.channelAccountId;
    if (filters.priority) where.priority = filters.priority;
    if (filters.unread === "true") where.unreadCount = { gt: 0 };
    if (filters.from || filters.to) where.lastMessageAt = { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) };
    if (filters.search) {
      const search = String(filters.search);
      where.OR = [
        { contact: { displayName: { contains: search, mode: "insensitive" } } },
        { contact: { primaryPhone: { contains: search, mode: "insensitive" } } },
        { messages: { some: { textContent: { contains: search, mode: "insensitive" } } } }
      ];
    }
    return this.db.conversation.findMany({
      where,
      include: { contact: true, channelAccount: { include: { channel: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: Math.min(Number(filters.limit || 50), 100)
    });
  }

  getConversation(id) {
    return this.db.conversation.findFirst({ where: { id, deletedAt: null }, include: { contact: true, channelAccount: { include: { channel: true } } } });
  }

  listMessages(conversationId) {
    return this.db.message.findMany({ where: { conversationId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  }

  async createInboundMessage({ conversationId, channelAccountId, externalMessageId, textContent, payload, providerTimestamp, messageType = "text", media = {}, caption = null, replyToMessageId = null }) {
    if (externalMessageId) {
      const existing = await this.db.message.findFirst({ where: { channelAccountId, externalMessageId } });
      if (existing) return { message: existing, duplicate: true };
    }
    const message = await this.db.message.create({
      data: {
        conversationId,
        channelAccountId,
        direction: "inbound",
        senderType: "customer",
        externalMessageId: externalMessageId || null,
        messageType,
        textContent,
        caption,
        replyToMessageId,
        mediaUrl: media.mediaUrl || null,
        mediaStorageKey: media.mediaStorageKey || null,
        mediaFilename: media.mediaFilename || null,
        mediaMimeType: media.mediaMimeType || null,
        mediaSize: media.mediaSize || null,
        mediaMetadata: media.mediaMetadata || {},
        payload: payload || {},
        status: "delivered",
        providerTimestamp: providerTimestamp || new Date()
      }
    });
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), lastInboundAt: new Date(), unreadCount: { increment: 1 }, status: "waiting_agent", version: { increment: 1 } }
    });
    return { message, duplicate: false };
  }

  async createOutboundMessage({ conversationId, channelAccountId, userId, textContent, clientMessageId, payload, messageType = "text", media = {}, caption = null, replyToMessageId = null, senderType = "agent", status = "pending" }) {
    const existing = clientMessageId ? await this.db.message.findFirst({ where: { conversationId, clientMessageId } }) : null;
    if (existing) return { message: existing, duplicate: true };
    const message = await this.db.message.create({
      data: {
        conversationId,
        channelAccountId,
        direction: "outbound",
        senderType,
        sentByUserId: userId,
        textContent,
        clientMessageId,
        payload: payload || {},
        status,
        messageType,
        caption,
        replyToMessageId,
        mediaUrl: media.mediaUrl || null,
        mediaStorageKey: media.mediaStorageKey || null,
        mediaFilename: media.mediaFilename || null,
        mediaMimeType: media.mediaMimeType || null,
        mediaSize: media.mediaSize || null,
        mediaMetadata: media.mediaMetadata || {}
      }
    });
    return { message, duplicate: false };
  }

  updateMessageStatus(messageId, data) {
    return this.db.message.update({ where: { id: messageId }, data });
  }

  createDeliveryStatus(data) {
    return this.db.messageDeliveryStatus.create({ data });
  }

  findMessageByExternalId({ channelAccountId, externalMessageId }) {
    return this.db.message.findFirst({ where: { channelAccountId, externalMessageId, deletedAt: null } });
  }

  getMessageWithConversation(messageId) {
    return this.db.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { contact: true, channelAccount: { include: { channel: true, credentials: true } } } } } });
  }

  async createDeliveryStatusIdempotent(data) {
    const existing = await this.db.messageDeliveryStatus.findFirst({
      where: {
        messageId: data.messageId,
        status: data.status,
        providerStatus: data.providerStatus,
        providerTimestamp: data.providerTimestamp || null,
        errorCode: data.errorCode || null
      }
    });
    if (existing) return { deliveryStatus: existing, duplicate: true };
    const deliveryStatus = await this.createDeliveryStatus(data);
    return { deliveryStatus, duplicate: false };
  }

  async createOutboundJob({ messageId, maxAttempts = 3, nextAttemptAt = new Date(), status = "pending", lastError = null, errorCode = null }) {
    return this.db.outboundMessageJob.create({ data: { messageId, maxAttempts, nextAttemptAt, status, lastError, errorCode } });
  }

  async jobForMessage(messageId) {
    return this.db.outboundMessageJob.findFirst({ where: { messageId }, orderBy: { createdAt: "desc" } });
  }

  async claimNextOutboundJob({ workerId, staleBefore = new Date(Date.now() - 5 * 60 * 1000) }) {
    const job = await this.db.outboundMessageJob.findFirst({
      where: {
        status: { in: ["pending", "retry"] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }]
      },
      orderBy: { nextAttemptAt: "asc" }
    });
    if (!job) return null;
    const result = await this.db.outboundMessageJob.updateMany({
      where: { id: job.id, status: job.status, lockedAt: job.lockedAt },
      data: { status: "processing", lockedAt: new Date(), lockedBy: workerId, lastAttemptAt: new Date(), attemptCount: { increment: 1 } }
    });
    if (result.count !== 1) return null;
    return this.db.outboundMessageJob.findUnique({ where: { id: job.id }, include: { message: { include: { conversation: { include: { contact: true, channelAccount: { include: { channel: true, credentials: true } } } } } } } });
  }

  updateOutboundJob(idValue, data) {
    return this.db.outboundMessageJob.update({ where: { id: idValue }, data });
  }

  async updateConversationStatus({ conversationId, status, userId, action }) {
    const data = { status, version: { increment: 1 } };
    if (status === "closed") {
      data.closedAt = new Date();
      data.closedByUserId = userId || null;
    }
    if (action === "release") data.assignedUserId = null;
    const conversation = await this.db.conversation.update({ where: { id: conversationId }, data });
    const assignmentAction = action === "release" ? "released" : action;
    if (assignmentAction) await this.db.conversationAssignment.create({ data: { conversationId, assignedByUserId: userId || null, action: assignmentAction, fromUserId: conversation.assignedUserId || null } }).catch(() => null);
    return conversation;
  }

  createTemplate(data) {
    return this.db.messageTemplate.create({ data });
  }

  listTemplates(filters = {}) {
    return this.db.messageTemplate.findMany({
      where: {
        isActive: true,
        ...(filters.channelAccountId ? { OR: [{ channelAccountId: filters.channelAccountId }, { channelAccountId: null }] } : {}),
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.status ? { status: filters.status } : {})
      },
      orderBy: { templateName: "asc" }
    });
  }

  findTemplate(idValue) {
    return this.db.messageTemplate.findFirst({ where: { id: idValue, isActive: true } });
  }

  async claimConversation({ conversationId, userId, expectedVersion }) {
    const conversation = await this.db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return null;
    if (hasExpectedVersion(expectedVersion)) {
      const result = await this.db.conversation.updateMany({
        where: { id: conversationId, version: Number(expectedVersion), deletedAt: null },
        data: { assignedUserId: userId, status: "claimed", unreadCount: 0, version: { increment: 1 } }
      });
      if (result.count !== 1) {
        const current = await this.db.conversation.findUnique({ where: { id: conversationId } });
        throw versionConflict(current?.version);
      }
      const updated = await this.db.conversation.findUnique({ where: { id: conversationId } });
      await this.db.conversationAssignment.create({ data: { conversationId, assignedToUserId: userId, assignedByUserId: userId, toUserId: userId, action: "claimed" } });
      return updated;
    }
    const updated = await this.db.conversation.update({
      where: { id: conversationId },
      data: { assignedUserId: userId, status: "claimed", unreadCount: 0, version: { increment: 1 } }
    });
    await this.db.conversationAssignment.create({ data: { conversationId, assignedToUserId: userId, assignedByUserId: userId, toUserId: userId, action: "claimed" } });
    return updated;
  }

  async assignConversation({ conversationId, assignedByUserId, toUserId, reason, expectedVersion }) {
    const current = await this.db.conversation.findUnique({ where: { id: conversationId } });
    if (!current) return null;
    if (hasExpectedVersion(expectedVersion)) {
      const result = await this.db.conversation.updateMany({
        where: { id: conversationId, version: Number(expectedVersion), deletedAt: null },
        data: { assignedUserId: toUserId, status: "assigned", version: { increment: 1 } }
      });
      if (result.count !== 1) {
        const latest = await this.db.conversation.findUnique({ where: { id: conversationId } });
        throw versionConflict(latest?.version);
      }
      const updated = await this.db.conversation.findUnique({ where: { id: conversationId } });
      await this.db.conversationAssignment.create({ data: { conversationId, assignedToUserId: toUserId, assignedByUserId, fromUserId: current?.assignedUserId || null, toUserId, action: "assigned", reason: reason || null } });
      return updated;
    }
    const updated = await this.db.conversation.update({ where: { id: conversationId }, data: { assignedUserId: toUserId, status: "assigned", version: { increment: 1 } } });
    await this.db.conversationAssignment.create({ data: { conversationId, assignedToUserId: toUserId, assignedByUserId, fromUserId: current?.assignedUserId || null, toUserId, action: "assigned", reason: reason || null } });
    return updated;
  }

  createConversationEvent(data) {
    return this.db.conversationEvent.create({ data });
  }

  async createWebhookEvent({ provider, channelAccountId, externalEventId, eventType, rawPayload, signatureValid }) {
    const hash = eventHash(rawPayload);
    try {
      return await this.db.webhookEvent.create({
        data: { provider, channelAccountId: channelAccountId || null, externalEventId: externalEventId || null, eventHash: hash, eventType, rawPayload, signatureValid: Boolean(signatureValid) }
      });
    } catch (error) {
      const existing = await this.db.webhookEvent.findFirst({
        where: { OR: [{ eventHash: hash }, ...(externalEventId ? [{ externalEventId }] : [])] }
      });
      return existing ? { ...existing, duplicate: true } : Promise.reject(error);
    }
  }

  updateWebhookEvent(id, data) {
    return this.db.webhookEvent.update({ where: { id }, data });
  }

  createActivity(data) {
    return this.db.agentActivityLog.create({ data });
  }

  async listSavedReplies({ q, scope, channelType, userId, teamKey, includeInactive = false } = {}) {
    const where = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(scope ? { scope } : {}),
      ...(channelType ? { OR: [{ channelType }, { channelType: null }] } : {}),
      OR: [
        { scope: "global" },
        ...(teamKey ? [{ scope: "team", teamKey }] : [{ scope: "team" }]),
        ...(userId ? [{ scope: "personal", ownerUserId: userId }] : [])
      ]
    };
    if (q) {
      const search = String(q).replace(/^\//, "");
      where.AND = [{
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { shortcut: { contains: search, mode: "insensitive" } },
          { content: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } }
        ]
      }];
    }
    return this.db.savedReply.findMany({ where, orderBy: [{ usageCount: "desc" }, { title: "asc" }], take: 100 });
  }

  findSavedReply(idValue) {
    return this.db.savedReply.findFirst({ where: { id: idValue, deletedAt: null } });
  }

  createSavedReply(data) {
    return this.db.savedReply.create({ data });
  }

  updateSavedReply(idValue, data) {
    return this.db.savedReply.update({ where: { id: idValue }, data });
  }

  softDeleteSavedReply(idValue) {
    return this.db.savedReply.update({ where: { id: idValue }, data: { deletedAt: new Date(), isActive: false } });
  }

  markSavedReplyUsed(idValue) {
    return this.db.savedReply.update({ where: { id: idValue }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
  }

  async shortcutExists({ shortcut, scope, ownerUserId, teamKey, excludeId }) {
    return this.db.savedReply.findFirst({
      where: {
        shortcut,
        scope,
        ownerUserId: ownerUserId || null,
        teamKey: teamKey || null,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });
  }

  listAutomationRules({ triggerType, includeInactive = false } = {}) {
    return this.db.automationRule.findMany({
      where: {
        deletedAt: null,
        ...(triggerType ? { triggerType } : {}),
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });
  }

  findAutomationRule(idValue) {
    return this.db.automationRule.findFirst({ where: { id: idValue, deletedAt: null } });
  }

  createAutomationRule(data) {
    return this.db.automationRule.create({ data });
  }

  updateAutomationRule(idValue, data) {
    return this.db.automationRule.update({ where: { id: idValue }, data });
  }

  softDeleteAutomationRule(idValue) {
    return this.db.automationRule.update({ where: { id: idValue }, data: { deletedAt: new Date(), isActive: false } });
  }

  createAutomationRun(data) {
    return this.db.automationRun.create({ data });
  }

  updateAutomationRun(idValue, data) {
    return this.db.automationRun.update({ where: { id: idValue }, data });
  }

  async cooldownActive({ automationRuleId, cooldownKey }) {
    const active = await this.db.automationCooldown.findUnique({
      where: { automationRuleId_cooldownKey: { automationRuleId, cooldownKey } }
    });
    return Boolean(active && active.expiresAt > new Date());
  }

  async setCooldown({ automationRuleId, cooldownKey, seconds }) {
    const expiresAt = new Date(Date.now() + Math.max(Number(seconds || 0), 0) * 1000);
    return this.db.automationCooldown.upsert({
      where: { automationRuleId_cooldownKey: { automationRuleId, cooldownKey } },
      update: { expiresAt },
      create: { automationRuleId, cooldownKey, expiresAt }
    });
  }

  async listBusinessHours() {
    return this.db.businessHours.findMany({ orderBy: { name: "asc" } });
  }

  async activeBusinessHours() {
    return this.db.businessHours.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  }

  async upsertBusinessHours({ id: idValue, name, timezone, schedule, isActive }) {
    if (idValue) return this.db.businessHours.update({ where: { id: idValue }, data: { name, timezone, schedule, isActive } });
    return this.db.businessHours.create({ data: { name, timezone, schedule, isActive } });
  }

  async dashboardSummary({ from, to } = {}) {
    const dateFilter = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const [total, open, unassigned, unread, closed] = await Promise.all([
      this.db.conversation.count({ where: dateFilter }),
      this.db.conversation.count({ where: { ...dateFilter, status: { not: "closed" } } }),
      this.db.conversation.count({ where: { ...dateFilter, status: "unassigned" } }),
      this.db.conversation.count({ where: { ...dateFilter, unreadCount: { gt: 0 } } }),
      this.db.conversation.count({ where: { ...dateFilter, status: "closed" } })
    ]);
    return { total, open, unassigned, unread, closed };
  }
}

module.exports = { PrismaRepository };
