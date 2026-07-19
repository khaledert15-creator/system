const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { env, publicConfig } = require("./config/env");
const { getPrisma } = require("./config/database");
const { PrismaRepository } = require("./repositories/prisma.repository");
const { SseManager } = require("./realtime/sse-manager");
const { requestId } = require("./middleware/request-id");
const { rateLimit, webhooksRateLimit } = require("./middleware/rate-limit");
const { corsOptions } = require("./middleware/cors-policy");
const { requestLogger } = require("./middleware/request-logger");
const { requireHttps, blockMockInProduction } = require("./middleware/security");
const { auth } = require("./middleware/auth");
const { errorHandler } = require("./middleware/error-handler");
const { readiness } = require("./services/readiness.service");
const { ProviderRegistry } = require("./providers/base-provider");
const { MockWhatsAppProvider } = require("./providers/mock/mock-whatsapp.provider");
const { MockMessengerProvider } = require("./providers/mock/mock-messenger.provider");
const { WhatsAppProvider } = require("./providers/whatsapp/whatsapp.provider");
const { MessengerProvider } = require("./providers/messenger/messenger.provider");
const { CustomerLookupService } = require("./services/customer-lookup.service");
const { ContactService } = require("./services/contact.service");
const { ConversationService } = require("./services/conversation.service");
const { MessageService } = require("./services/message.service");
const { WebhookService } = require("./services/webhook.service");
const { DashboardService } = require("./services/dashboard.service");
const { ChannelService } = require("./services/channel.service");
const { NotificationService } = require("./services/notification.service");
const { CredentialService } = require("./services/credential.service");
const { MediaService } = require("./services/media.service");
const { SavedReplyService } = require("./services/saved-reply.service");
const { AutomationService } = require("./services/automation.service");
const { LocalStorageProvider } = require("./storage/local-storage.provider");
const { MessageRetryJob } = require("./jobs/message-retry.job");
const { channelsRouter } = require("./routes/channels.routes");
const { conversationsRouter } = require("./routes/conversations.routes");
const { messagesRouter } = require("./routes/messages.routes");
const { assignmentsRouter } = require("./routes/assignments.routes");
const { contactsRouter } = require("./routes/contacts.routes");
const { dashboardRouter } = require("./routes/dashboard.routes");
const { eventsRouter } = require("./routes/events.routes");
const { mockRouter } = require("./routes/mock.routes");
const { mediaRouter } = require("./routes/media.routes");
const { templatesRouter } = require("./routes/templates.routes");
const { savedRepliesRouter } = require("./routes/saved-replies.routes");
const { automationRouter } = require("./routes/automation.routes");
const { whatsappWebhookRouter } = require("./webhooks/whatsapp.webhook");
const { messengerWebhookRouter } = require("./webhooks/messenger.webhook");

function buildContainer(repository = new PrismaRepository(getPrisma())) {
  const sse = new SseManager();
  const notifications = new NotificationService({ sse });
  const credentialService = new CredentialService({ repository });
  const storage = new LocalStorageProvider({ root: env.uploadRoot });
  const mediaService = new MediaService({ storage });
  const customerLookup = new CustomerLookupService();
  const contactService = new ContactService({ repository, customerLookup });
  const conversationService = new ConversationService({ repository, customerLookup, notifications });
  const providers = new ProviderRegistry([new MockWhatsAppProvider(), new MockMessengerProvider(), new WhatsAppProvider(), new MessengerProvider()]);
  const messageService = new MessageService({ repository, providers, notifications, credentialService });
  const savedReplyService = new SavedReplyService({ repository, customerLookup });
  const automationService = new AutomationService({ repository, messageService, savedReplyService, customerLookup });
  const retryJob = new MessageRetryJob({ repository, messageService });
  const webhookService = new WebhookService({ repository, contactService, conversationService, messageService, notifications, automationService });
  return {
    repository,
    sse,
    notifications,
    credentialService,
    storage,
    mediaService,
    customerLookup,
    contactService,
    conversationService,
    messageService,
    savedReplyService,
    automationService,
    retryJob,
    webhookService,
    dashboardService: new DashboardService({ repository }),
    channelService: new ChannelService({ repository, credentialService })
  };
}

function createApp(container = buildContainer()) {
  const app = express();
  app.set("trust proxy", env.trustProxy);
  app.use(requestId);
  app.use(requireHttps);
  app.use(helmet({
    hsts: env.enableHsts ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
    contentSecurityPolicy: false
  }));
  app.use(cors(corsOptions));
  app.use(rateLimit);
  app.use(requestLogger);
  app.use(express.json({
    limit: env.requestBodyLimit,
    verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); }
  }));

  app.get("/health", (_req, res) => res.json({ ok: true, service: "omnichannel", time: new Date().toISOString() }));
  app.get("/ready", async (_req, res) => {
    const result = await readiness(container);
    res.status(result.ok ? 200 : 503).json(result);
  });

  app.use("/api/events", eventsRouter(container));
  app.use("/api", auth, channelsRouter(container));
  app.use("/api", auth, conversationsRouter(container));
  app.use("/api", auth, messagesRouter(container));
  app.use("/api", auth, mediaRouter(container));
  app.use("/api", auth, templatesRouter(container));
  app.use("/api", auth, savedRepliesRouter(container));
  app.use("/api", auth, automationRouter(container));
  app.use("/api", auth, assignmentsRouter(container));
  app.use("/api", auth, contactsRouter(container));
  app.use("/api", auth, dashboardRouter(container));
  app.use("/api/mock", blockMockInProduction, auth, mockRouter(container));

  app.use("/webhooks/whatsapp", webhooksRateLimit, whatsappWebhookRouter(container));
  app.use("/webhooks/messenger", webhooksRateLimit, messengerWebhookRouter(container));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp, buildContainer };
