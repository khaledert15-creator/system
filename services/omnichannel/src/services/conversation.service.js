class ConversationService {
  constructor({ repository, customerLookup, notifications }) {
    this.repository = repository;
    this.customerLookup = customerLookup;
    this.notifications = notifications;
  }

  list(filters) {
    return this.repository.listConversations(filters);
  }

  get(id) {
    return this.repository.getConversation(id);
  }

  async createOrFindForContact({ channelAccountId, contact, subject }) {
    const links = contact.primaryPhone ? this.customerLookup.suggestLinksByPhone(contact.primaryPhone) : {};
    return this.repository.findOrCreateConversation({
      channelAccountId,
      contactId: contact.id,
      customerId: contact.customerId || links.customerId || null,
      onlineOrderId: links.onlineOrderId || null,
      saleId: links.saleId || null,
      shipmentId: links.shipmentId || null,
      subject
    });
  }

  async claim({ conversationId, user, expectedVersion }) {
    const conversation = await this.repository.claimConversation({ conversationId, userId: user.id, expectedVersion });
    await this.repository.createConversationEvent({
      conversationId,
      eventType: "conversation.claimed",
      actorType: "agent",
      actorUserId: user.id,
      payload: { expectedVersion: expectedVersion ?? null }
    });
    await this.repository.createActivity({ userId: user.id, action: "conversation.claimed", conversationId });
    this.notifications.conversationUpdated({ conversationId, assignedUserId: user.id, status: conversation.status });
    return conversation;
  }

  async assign({ conversationId, user, toUserId, reason, expectedVersion }) {
    const conversation = await this.repository.assignConversation({ conversationId, assignedByUserId: user.id, toUserId, reason, expectedVersion });
    await this.repository.createConversationEvent({
      conversationId,
      eventType: "conversation.assigned",
      actorType: "agent",
      actorUserId: user.id,
      payload: { toUserId, reason: reason || null, expectedVersion: expectedVersion ?? null }
    });
    await this.repository.createActivity({ userId: user.id, action: "conversation.assigned", conversationId, metadata: { toUserId, reason } });
    this.notifications.conversationUpdated({ conversationId, assignedUserId: toUserId, status: conversation.status });
    return conversation;
  }

  async setStatus({ conversationId, user, status, action }) {
    const conversation = await this.repository.updateConversationStatus({ conversationId, status, userId: user.id, action });
    await this.repository.createConversationEvent({
      conversationId,
      eventType: `conversation.${action || status}`,
      actorType: "agent",
      actorUserId: user.id,
      payload: { status }
    });
    await this.repository.createActivity({ userId: user.id, action: `conversation.${action || status}`, conversationId });
    this.notifications.conversationUpdated({ conversationId, status: conversation.status, assignedUserId: conversation.assignedUserId || null });
    return conversation;
  }
}

module.exports = { ConversationService };
