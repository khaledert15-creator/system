const test = require("node:test");
const assert = require("node:assert/strict");
const { InMemoryRepository } = require("../repositories/in-memory.repository");
const { ProviderRegistry } = require("../providers/base-provider");
const { MockWhatsAppProvider } = require("../providers/mock/mock-whatsapp.provider");
const { MockMessengerProvider } = require("../providers/mock/mock-messenger.provider");
const { ContactService } = require("../services/contact.service");
const { ConversationService } = require("../services/conversation.service");
const { MessageService } = require("../services/message.service");
const { WebhookService } = require("../services/webhook.service");

function buildHarness() {
  const repository = new InMemoryRepository();
  repository.channelsData = [
    { id: "ch_whatsapp", key: "whatsapp", name: "WhatsApp" },
    { id: "ch_messenger", key: "messenger", name: "Messenger" }
  ];
  repository.channelAccountsData = [
    { id: "acc_wa_secondary", channelId: "ch_whatsapp", name: "WhatsApp Secondary", status: "mock_connected", provider: "whatsapp" },
    { id: "acc_messenger", channelId: "ch_messenger", name: "Messenger Main Page", status: "mock_connected", provider: "messenger" }
  ];
  const notifications = { messageCreated() {}, conversationUpdated() {} };
  const customerLookup = {
    suggestLinksByPhone(phone) {
      return phone === "+201000000001"
        ? { customerId: "C002", onlineOrderId: "ORD-011", saleId: "INV-1075", shipmentId: "SH-220" }
        : {};
    }
  };
  const contactService = new ContactService({ repository, customerLookup });
  const conversationService = new ConversationService({ repository, customerLookup, notifications });
  const providers = new ProviderRegistry([new MockWhatsAppProvider(), new MockMessengerProvider()]);
  const messageService = new MessageService({ repository, providers, notifications });
  const webhookService = new WebhookService({ repository, contactService, conversationService, messageService, notifications });
  return { repository, webhookService, messageService, conversationService };
}

test("creates one customer conversation from a WhatsApp inbound message and links existing records by phone", async () => {
  const { repository, webhookService } = buildHarness();
  const channelAccount = await repository.findChannelAccount("acc_wa_secondary");
  const result = await webhookService.processInbound({
    provider: "whatsapp",
    channelAccount,
    externalIdentityId: "01000000001",
    phone: "01000000001",
    displayName: "Test Customer",
    externalMessageId: "wa-msg-1",
    text: "أريد متابعة الطلب",
    payload: { test: true }
  });

  assert.equal(result.contact.customerId, "C002");
  assert.equal(result.conversation.customerId, "C002");
  assert.equal(result.conversation.onlineOrderId, "ORD-011");
  assert.equal(repository.messages.length, 1);
  assert.equal(repository.conversations[0].unreadCount, 1);
});

test("does not duplicate an inbound provider message with the same external id", async () => {
  const { repository, webhookService } = buildHarness();
  const channelAccount = await repository.findChannelAccount("acc_wa_secondary");
  const payload = {
    provider: "whatsapp",
    channelAccount,
    externalIdentityId: "01000000001",
    phone: "01000000001",
    displayName: "Test Customer",
    externalMessageId: "wa-msg-duplicate",
    text: "نفس الرسالة",
    payload: { test: true }
  };
  await webhookService.processInbound(payload);
  const second = await webhookService.processInbound(payload);

  assert.equal(second.duplicate, true);
  assert.equal(repository.messages.length, 1);
});

test("claim prevents stale version conflicts and outbound messages are sent through the mock provider", async () => {
  const { repository, webhookService, conversationService, messageService } = buildHarness();
  const channelAccount = await repository.findChannelAccount("acc_wa_secondary");
  const inbound = await webhookService.processInbound({
    provider: "whatsapp",
    channelAccount,
    externalIdentityId: "01000000001",
    phone: "01000000001",
    displayName: "Test Customer",
    externalMessageId: "wa-msg-2",
    text: "محتاج رد",
    payload: { test: true }
  });
  const agent = { id: "agent-owner", permissions: ["omni:view", "omni:send", "omni:assign"] };
  const claimed = await conversationService.claim({ conversationId: inbound.conversation.id, user: agent, expectedVersion: 2 });
  assert.equal(claimed.assignedUserId, "agent-owner");

  await assert.rejects(
    () => conversationService.claim({ conversationId: inbound.conversation.id, user: agent, expectedVersion: 2 }),
    /Conversation version conflict/
  );

  const sent = await messageService.sendOutbound({ conversationId: inbound.conversation.id, user: agent, text: "تم استلام طلبك", clientId: "client-1" });
  assert.equal(sent.message.status, "sent");
  assert.equal(repository.deliveryStatuses[0].status, "sent");
});
