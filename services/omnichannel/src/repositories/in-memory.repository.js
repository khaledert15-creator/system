const { id, eventHash } = require("../utils/ids");

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

class InMemoryRepository {
  constructor() {
    this.channelsData = [];
    this.channelAccountsData = [];
    this.contacts = [];
    this.identities = [];
    this.conversations = [];
    this.messages = [];
    this.assignments = [];
    this.webhookEvents = [];
    this.deliveryStatuses = [];
    this.activities = [];
    this.credentials = [];
    this.jobs = [];
    this.templates = [];
    this.savedReplies = [];
    this.automationRules = [];
    this.automationRuns = [];
    this.businessHours = [];
    this.automationCooldowns = [];
  }

  async channels() { return this.channelsData; }
  async findChannelByKey(key) { return this.channelsData.find(channel => channel.key === key); }
  async channelAccounts() { return this.channelAccountsData.filter(account => !account.deletedAt).map(account => ({ ...account, channel: this.channelsData.find(c => c.id === account.channelId), credentials: this.credentials.filter(item => item.channelAccountId === account.id) })); }
  async findChannelAccount(idValue) { return (await this.channelAccounts()).find(account => account.id === idValue); }
  async findChannelAccountByPhoneNumberId(phoneNumberId) { return (await this.channelAccounts()).filter(account => account.phoneNumberId === phoneNumberId && account.isActive !== false); }
  async findChannelAccountByPageId(pageId) { return (await this.channelAccounts()).filter(account => account.pageId === pageId && account.isActive !== false); }
  async createChannelAccount(data) {
    const account = { id: data.id || id("acc"), createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data };
    this.channelAccountsData.push(account);
    return this.findChannelAccount(account.id);
  }
  async updateChannelAccount(idValue, data) {
    const account = this.channelAccountsData.find(item => item.id === idValue);
    Object.assign(account, data, { updatedAt: new Date() });
    return this.findChannelAccount(idValue);
  }
  async softDeleteChannelAccount(idValue) {
    const account = this.channelAccountsData.find(item => item.id === idValue);
    Object.assign(account, { deletedAt: new Date(), isActive: false, status: "deleted", connectionStatus: "disconnected", updatedAt: new Date() });
    return { ...account, channel: this.channelsData.find(c => c.id === account.channelId), credentials: this.credentials.filter(item => item.channelAccountId === account.id) };
  }
  async upsertChannelAccountCredential({ channelAccountId, credentialType, encryptedValue, keyVersion }) {
    let credential = this.credentials.find(item => item.channelAccountId === channelAccountId && item.credentialType === credentialType);
    if (credential) Object.assign(credential, { encryptedValue, keyVersion, rotatedAt: new Date(), updatedAt: new Date() });
    else {
      credential = { id: id("cred"), channelAccountId, credentialType, encryptedValue, keyVersion, createdAt: new Date(), updatedAt: new Date() };
      this.credentials.push(credential);
    }
    return credential;
  }
  async channelAccountCredential(channelAccountId, credentialType) {
    return this.credentials.find(item => item.channelAccountId === channelAccountId && item.credentialType === credentialType) || null;
  }

  async findOrCreateContact({ channelAccountId, provider, externalIdentityId, normalizedPhone, displayName, customerId }) {
    let identity = this.identities.find(item => item.channelAccountId === channelAccountId && item.externalIdentityId === externalIdentityId);
    if (identity) return { contact: this.contacts.find(item => item.id === identity.contactId), identity, created: false };
    let contact = normalizedPhone ? this.contacts.find(item => item.primaryPhone === normalizedPhone) : null;
    if (!contact) {
      contact = { id: id("contact"), displayName: displayName || normalizedPhone || externalIdentityId, primaryPhone: normalizedPhone || null, customerId: customerId || null, createdAt: new Date(), updatedAt: new Date() };
      this.contacts.push(contact);
    }
    identity = { id: id("identity"), contactId: contact.id, channelAccountId, provider, externalIdentityId, normalizedPhone, displayName, createdAt: new Date(), updatedAt: new Date() };
    this.identities.push(identity);
    return { contact, identity, created: true };
  }

  async findOrCreateConversation({ channelAccountId, contactId, customerId, onlineOrderId, saleId, shipmentId, subject }) {
    let conversation = this.conversations.find(item => item.channelAccountId === channelAccountId && item.contactId === contactId && item.status !== "closed");
    if (conversation) return { conversation, created: false };
    conversation = { id: id("conv"), channelAccountId, contactId, customerId, onlineOrderId, saleId, shipmentId, subject, status: "unassigned", priority: "normal", unreadCount: 0, version: 1, lastMessageAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    this.conversations.push(conversation);
    return { conversation, created: true };
  }

  async listConversations(filters = {}) {
    return this.conversations.filter(conversation => {
      if (filters.status && conversation.status !== filters.status) return false;
      if (filters.assignedUserId && conversation.assignedUserId !== filters.assignedUserId) return false;
      if (filters.channelAccountId && conversation.channelAccountId !== filters.channelAccountId) return false;
      if (filters.unread === "true" && !(conversation.unreadCount > 0)) return false;
      if (filters.search) {
        const contact = this.contacts.find(item => item.id === conversation.contactId) || {};
        const text = this.messages.filter(item => item.conversationId === conversation.id).map(item => item.textContent || item.caption || "").join(" ");
        const haystack = `${contact.displayName || ""} ${contact.primaryPhone || ""} ${text}`.toLowerCase();
        if (!haystack.includes(String(filters.search).toLowerCase())) return false;
      }
      return true;
    }).map(conversation => ({
      ...conversation,
      contact: this.contacts.find(contact => contact.id === conversation.contactId),
      channelAccount: { ...this.channelAccountsData.find(account => account.id === conversation.channelAccountId), channel: this.channelsData.find(c => c.id === this.channelAccountsData.find(account => account.id === conversation.channelAccountId)?.channelId) },
      messages: this.messages.filter(message => message.conversationId === conversation.id).slice(-1)
    })).sort((a, b) => new Date(b.lastMessageAt || b.updatedAt) - new Date(a.lastMessageAt || a.updatedAt));
  }

  async getConversation(conversationId) {
    const conversation = this.conversations.find(item => item.id === conversationId);
    const account = this.channelAccountsData.find(item => item.id === conversation?.channelAccountId);
    return conversation ? { ...conversation, contact: this.contacts.find(contact => contact.id === conversation.contactId), channelAccount: { ...account, channel: this.channelsData.find(c => c.id === account?.channelId) } } : null;
  }

  async listMessages(conversationId) {
    return this.messages.filter(item => item.conversationId === conversationId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async createInboundMessage({ conversationId, channelAccountId, externalMessageId, textContent, payload, providerTimestamp, messageType = "text", media = {}, caption = null, replyToMessageId = null }) {
    const existing = externalMessageId && this.messages.find(item => item.channelAccountId === channelAccountId && item.externalMessageId === externalMessageId);
    if (existing) return { message: existing, duplicate: true };
    const message = { id: id("msg"), conversationId, channelAccountId, direction: "inbound", senderType: "customer", externalMessageId, textContent, payload, status: "delivered", providerTimestamp: providerTimestamp || new Date(), messageType, caption, replyToMessageId, ...media, createdAt: new Date(), updatedAt: new Date() };
    this.messages.push(message);
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (conversation) Object.assign(conversation, { unreadCount: (conversation.unreadCount || 0) + 1, status: "waiting_agent", lastMessageAt: new Date(), lastInboundAt: new Date(), version: conversation.version + 1, updatedAt: new Date() });
    return { message, duplicate: false };
  }

  async createOutboundMessage({ conversationId, channelAccountId, userId, textContent, clientMessageId, payload, messageType = "text", media = {}, caption = null, replyToMessageId = null, senderType = "agent", status = "pending" }) {
    const existing = clientMessageId && this.messages.find(item => item.conversationId === conversationId && item.clientMessageId === clientMessageId);
    if (existing) return { message: existing, duplicate: true };
    const message = { id: id("msg"), conversationId, channelAccountId, direction: "outbound", senderType, sentByUserId: userId, textContent, clientMessageId, payload, status, messageType, caption, replyToMessageId, ...media, createdAt: new Date(), updatedAt: new Date() };
    this.messages.push(message);
    return { message, duplicate: false };
  }

  async updateMessageStatus(messageId, data) {
    const message = this.messages.find(item => item.id === messageId);
    Object.assign(message, data, { updatedAt: new Date() });
    return message;
  }

  async createDeliveryStatus(data) { this.deliveryStatuses.push({ id: id("delivery"), ...data, createdAt: new Date() }); }
  async findMessageByExternalId({ channelAccountId, externalMessageId }) {
    return this.messages.find(item => item.channelAccountId === channelAccountId && item.externalMessageId === externalMessageId) || null;
  }
  async getMessageWithConversation(messageId) {
    const message = this.messages.find(item => item.id === messageId);
    if (!message) return null;
    return { ...message, conversation: await this.getConversation(message.conversationId) };
  }
  async createDeliveryStatusIdempotent(data) {
    const existing = this.deliveryStatuses.find(item => item.messageId === data.messageId && item.status === data.status && item.providerStatus === data.providerStatus && String(item.providerTimestamp || "") === String(data.providerTimestamp || "") && (item.errorCode || null) === (data.errorCode || null));
    if (existing) return { deliveryStatus: existing, duplicate: true };
    const deliveryStatus = { id: id("delivery"), ...data, createdAt: new Date() };
    this.deliveryStatuses.push(deliveryStatus);
    return { deliveryStatus, duplicate: false };
  }

  async createOutboundJob({ messageId, maxAttempts = 3, nextAttemptAt = new Date(), status = "pending", lastError = null, errorCode = null }) {
    const job = { id: id("job"), messageId, status, attemptCount: 0, maxAttempts, nextAttemptAt, lastError, errorCode, createdAt: new Date(), updatedAt: new Date() };
    this.jobs.push(job);
    return job;
  }
  async jobForMessage(messageId) {
    return [...this.jobs].reverse().find(item => item.messageId === messageId) || null;
  }
  async claimNextOutboundJob({ workerId }) {
    const job = this.jobs.find(item => ["pending", "retry"].includes(item.status) && new Date(item.nextAttemptAt) <= new Date() && !item.lockedAt);
    if (!job) return null;
    Object.assign(job, { status: "processing", lockedAt: new Date(), lockedBy: workerId, lastAttemptAt: new Date(), attemptCount: job.attemptCount + 1 });
    const message = this.messages.find(item => item.id === job.messageId);
    const conversation = await this.getConversation(message.conversationId);
    return { ...job, message: { ...message, conversation } };
  }
  async updateOutboundJob(idValue, data) {
    const job = this.jobs.find(item => item.id === idValue);
    Object.assign(job, data, { updatedAt: new Date() });
    return job;
  }
  async updateConversationStatus({ conversationId, status, userId, action }) {
    const conversation = this.conversations.find(item => item.id === conversationId);
    Object.assign(conversation, { status, version: (conversation.version || 1) + 1, updatedAt: new Date() });
    if (status === "closed") Object.assign(conversation, { closedAt: new Date(), closedByUserId: userId });
    if (action === "release") conversation.assignedUserId = null;
    return conversation;
  }
  async createTemplate(data) {
    const template = { id: id("tpl"), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.templates.push(template);
    return template;
  }
  async listTemplates(filters = {}) {
    return this.templates.filter(item => item.isActive !== false && (!filters.channelAccountId || !item.channelAccountId || item.channelAccountId === filters.channelAccountId) && (!filters.provider || item.provider === filters.provider) && (!filters.status || item.status === filters.status));
  }
  async findTemplate(idValue) {
    return this.templates.find(item => item.id === idValue && item.isActive !== false) || null;
  }

  async claimConversation({ conversationId, userId, expectedVersion }) {
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (!conversation) return null;
    if (hasExpectedVersion(expectedVersion) && conversation.version !== Number(expectedVersion)) throw versionConflict(conversation.version);
    Object.assign(conversation, { assignedUserId: userId, status: "claimed", unreadCount: 0, version: conversation.version + 1, updatedAt: new Date() });
    this.assignments.push({ id: id("assign"), conversationId, assignedToUserId: userId, assignedByUserId: userId, action: "claimed", createdAt: new Date() });
    return conversation;
  }

  async assignConversation({ conversationId, assignedByUserId, toUserId, reason, expectedVersion }) {
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (hasExpectedVersion(expectedVersion) && conversation.version !== Number(expectedVersion)) throw versionConflict(conversation.version);
    Object.assign(conversation, { assignedUserId: toUserId, status: "assigned", version: conversation.version + 1, updatedAt: new Date() });
    this.assignments.push({ id: id("assign"), conversationId, assignedByUserId, assignedToUserId: toUserId, action: "assigned", reason, createdAt: new Date() });
    return conversation;
  }

  async createConversationEvent(data) { return data; }

  async createWebhookEvent({ provider, channelAccountId, externalEventId, eventType, rawPayload, signatureValid }) {
    const hash = eventHash(rawPayload);
    const existing = this.webhookEvents.find(item => item.eventHash === hash || (externalEventId && item.externalEventId === externalEventId));
    if (existing) return { ...existing, duplicate: true };
    const event = { id: id("webhook"), provider, channelAccountId, externalEventId, eventHash: hash, eventType, rawPayload, signatureValid, status: "received", receivedAt: new Date() };
    this.webhookEvents.push(event);
    return event;
  }

  async updateWebhookEvent(idValue, data) {
    const event = this.webhookEvents.find(item => item.id === idValue);
    Object.assign(event, data);
    return event;
  }

  async createActivity(data) { this.activities.push({ id: id("activity"), ...data, createdAt: new Date() }); }
  async listSavedReplies({ q, scope, channelType, userId, teamKey, includeInactive = false } = {}) {
    const search = q ? String(q).replace(/^\//, "").toLowerCase() : "";
    return this.savedReplies
      .filter(item => !item.deletedAt && (includeInactive || item.isActive !== false))
      .filter(item => !scope || item.scope === scope)
      .filter(item => !channelType || !item.channelType || item.channelType === channelType)
      .filter(item => item.scope === "global" || (item.scope === "team" && (!teamKey || item.teamKey === teamKey)) || (item.scope === "personal" && item.ownerUserId === userId))
      .filter(item => !search || `${item.title} ${item.shortcut} ${item.content} ${item.category || ""}`.toLowerCase().includes(search))
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || String(a.title).localeCompare(String(b.title)))
      .slice(0, 100);
  }
  async findSavedReply(idValue) { return this.savedReplies.find(item => item.id === idValue && !item.deletedAt) || null; }
  async createSavedReply(data) {
    const reply = { id: id("reply"), usageCount: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.savedReplies.push(reply);
    return reply;
  }
  async updateSavedReply(idValue, data) {
    const reply = this.savedReplies.find(item => item.id === idValue);
    Object.assign(reply, data, { updatedAt: new Date() });
    return reply;
  }
  async softDeleteSavedReply(idValue) {
    return this.updateSavedReply(idValue, { deletedAt: new Date(), isActive: false });
  }
  async markSavedReplyUsed(idValue) {
    const reply = this.savedReplies.find(item => item.id === idValue);
    Object.assign(reply, { usageCount: (reply.usageCount || 0) + 1, lastUsedAt: new Date(), updatedAt: new Date() });
    return reply;
  }
  async shortcutExists({ shortcut, scope, ownerUserId, teamKey, excludeId }) {
    return this.savedReplies.find(item => !item.deletedAt && item.id !== excludeId && item.shortcut === shortcut && item.scope === scope && (item.ownerUserId || null) === (ownerUserId || null) && (item.teamKey || null) === (teamKey || null)) || null;
  }
  async listAutomationRules({ triggerType, includeInactive = false } = {}) {
    return this.automationRules
      .filter(item => !item.deletedAt && (includeInactive || item.isActive !== false))
      .filter(item => !triggerType || item.triggerType === triggerType)
      .sort((a, b) => (a.priority || 100) - (b.priority || 100));
  }
  async findAutomationRule(idValue) { return this.automationRules.find(item => item.id === idValue && !item.deletedAt) || null; }
  async createAutomationRule(data) {
    const rule = { id: id("rule"), isActive: true, priority: 100, channelScope: "all", cooldownSeconds: 0, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.automationRules.push(rule);
    return rule;
  }
  async updateAutomationRule(idValue, data) {
    const rule = this.automationRules.find(item => item.id === idValue);
    Object.assign(rule, data, { updatedAt: new Date() });
    return rule;
  }
  async softDeleteAutomationRule(idValue) {
    return this.updateAutomationRule(idValue, { deletedAt: new Date(), isActive: false });
  }
  async createAutomationRun(data) {
    const run = { id: id("run"), status: "pending", matched: false, actionsExecuted: [], startedAt: new Date(), createdAt: new Date(), ...data };
    this.automationRuns.push(run);
    return run;
  }
  async updateAutomationRun(idValue, data) {
    const run = this.automationRuns.find(item => item.id === idValue);
    Object.assign(run, data);
    return run;
  }
  async cooldownActive({ automationRuleId, cooldownKey }) {
    const active = this.automationCooldowns.find(item => item.automationRuleId === automationRuleId && item.cooldownKey === cooldownKey);
    return Boolean(active && active.expiresAt > new Date());
  }
  async setCooldown({ automationRuleId, cooldownKey, seconds }) {
    let cooldown = this.automationCooldowns.find(item => item.automationRuleId === automationRuleId && item.cooldownKey === cooldownKey);
    if (!cooldown) {
      cooldown = { id: id("cooldown"), automationRuleId, cooldownKey, createdAt: new Date() };
      this.automationCooldowns.push(cooldown);
    }
    cooldown.expiresAt = new Date(Date.now() + Math.max(Number(seconds || 0), 0) * 1000);
    return cooldown;
  }
  async listBusinessHours() { return this.businessHours; }
  async activeBusinessHours() { return this.businessHours.find(item => item.isActive !== false) || null; }
  async upsertBusinessHours({ id: idValue, name, timezone, schedule, isActive }) {
    let hours = idValue ? this.businessHours.find(item => item.id === idValue) : null;
    if (!hours) {
      hours = { id: id("hours"), createdAt: new Date(), updatedAt: new Date() };
      this.businessHours.push(hours);
    }
    Object.assign(hours, { name, timezone, schedule, isActive, updatedAt: new Date() });
    return hours;
  }
  async dashboardSummary() {
    return { total: this.conversations.length, open: this.conversations.filter(c => c.status !== "closed").length, unassigned: this.conversations.filter(c => c.status === "unassigned").length, unread: this.conversations.filter(c => c.unreadCount > 0).length, closed: this.conversations.filter(c => c.status === "closed").length };
  }
}

module.exports = { InMemoryRepository };
