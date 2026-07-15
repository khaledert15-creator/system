const { eventHash } = require("../utils/ids");

class WebhookService {
  constructor({ repository, contactService, conversationService, messageService, notifications, automationService = null }) {
    this.repository = repository;
    this.contactService = contactService;
    this.conversationService = conversationService;
    this.messageService = messageService;
    this.notifications = notifications;
    this.automationService = automationService;
  }

  async persist({ provider, channelAccountId, externalEventId, eventType, payload, signatureValid }) {
    return this.repository.createWebhookEvent({ provider, channelAccountId, externalEventId, eventType, rawPayload: payload, signatureValid });
  }

  async processInbound({ provider, channelAccount, externalIdentityId, phone, displayName, externalMessageId, text, payload, providerTimestamp, messageType = "text", media = {}, caption = null }) {
    const { contact } = await this.contactService.matchOrCreate({ channelAccountId: channelAccount.id, provider, externalIdentityId, phone, displayName });
    const { conversation, created } = await this.conversationService.createOrFindForContact({ channelAccountId: channelAccount.id, contact, subject: text?.slice(0, 80) });
    const result = await this.messageService.addInbound({ conversation, channelAccount, externalMessageId, text, payload, providerTimestamp, messageType, media, caption });
    const freshConversation = await this.repository.getConversation(conversation.id);
    let automationRuns = [];
    if (!result.duplicate && this.automationService) {
      const context = { provider, channelAccount, contact, conversation: freshConversation || conversation, message: result.message, isNewConversation: Boolean(created), source: "inbound" };
      if (created) automationRuns = automationRuns.concat(await this.automationService.runTrigger("new_conversation", context));
      automationRuns = automationRuns.concat(await this.automationService.runTrigger("new_inbound_message", context));
    }
    return { contact, conversation: freshConversation || conversation, message: result.message, duplicate: result.duplicate, automationRuns };
  }

  eventHash(payload) {
    return eventHash(payload);
  }
}

module.exports = { WebhookService };
