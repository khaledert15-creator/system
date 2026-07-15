require("dotenv").config();
const { getPrisma, disconnectPrisma } = require("../src/config/database");

async function upsertChannel(db, key, name, provider) {
  return db.channel.upsert({
    where: { key },
    update: { name, provider, isActive: true },
    create: { key, name, provider, isActive: true }
  });
}

async function upsertAccount(db, channel, data) {
  const existing = await db.channelAccount.findFirst({ where: { channelId: channel.id, name: data.name } });
  if (existing) return db.channelAccount.update({ where: { id: existing.id }, data });
  return db.channelAccount.create({ data: { ...data, channelId: channel.id } });
}

async function upsertTemplate(db, data) {
  const existing = await db.messageTemplate.findFirst({ where: { provider: data.provider, templateName: data.templateName, languageCode: data.languageCode || "ar" } });
  if (existing) return db.messageTemplate.update({ where: { id: existing.id }, data });
  return db.messageTemplate.create({ data });
}

async function upsertSavedReply(db, data) {
  const existing = await db.savedReply.findFirst({ where: { shortcut: data.shortcut, scope: data.scope, deletedAt: null } });
  if (existing) return db.savedReply.update({ where: { id: existing.id }, data });
  return db.savedReply.create({ data });
}

async function upsertAutomationRule(db, data) {
  const existing = await db.automationRule.findFirst({ where: { name: data.name, deletedAt: null } });
  if (existing) return db.automationRule.update({ where: { id: existing.id }, data });
  return db.automationRule.create({ data });
}

async function ensureBusinessHours(db) {
  const existing = await db.businessHours.findFirst({ where: { name: "Default Business Hours" } });
  const schedule = {
    monday: { start: "09:00", end: "18:00", closed: false },
    tuesday: { start: "09:00", end: "18:00", closed: false },
    wednesday: { start: "09:00", end: "18:00", closed: false },
    thursday: { start: "09:00", end: "18:00", closed: false },
    friday: { start: "00:00", end: "00:00", closed: true },
    saturday: { start: "10:00", end: "16:00", closed: false },
    sunday: { start: "09:00", end: "18:00", closed: false }
  };
  if (existing) return db.businessHours.update({ where: { id: existing.id }, data: { schedule, timezone: "Africa/Cairo", isActive: true } });
  return db.businessHours.create({ data: { name: "Default Business Hours", timezone: "Africa/Cairo", schedule, isActive: true } });
}

async function main() {
  const db = getPrisma();
  const whatsapp = await upsertChannel(db, "whatsapp", "WhatsApp", "meta");
  const messenger = await upsertChannel(db, "messenger", "Facebook Messenger", "meta");
  await upsertChannel(db, "instagram", "Instagram Messaging", "meta");
  await upsertChannel(db, "webchat", "Website Chat", "internal");

  await upsertAccount(db, whatsapp, {
    name: "WhatsApp Business Primary",
    status: "not_connected",
    connectionStatus: "not_configured",
    isActive: true,
    isCritical: true,
    configuration: { critical: true, note: "Primary number placeholder only. Do not onboard without explicit approval." },
    credentialsReference: "env:WHATSAPP_PRIMARY_NOT_CONFIGURED"
  });
  await upsertAccount(db, whatsapp, {
    name: "WhatsApp Secondary",
    status: "mock_connected",
    connectionStatus: "mock_connected",
    isActive: true,
    isCritical: false,
    externalPhoneNumber: "+200000000000",
    phoneNumberId: "mock-phone-secondary",
    configuration: { testPlaceholder: true },
    credentialsReference: "env:WHATSAPP_ACCESS_TOKEN"
  });
  await upsertAccount(db, messenger, {
    name: "Messenger Main Page",
    status: "mock_connected",
    connectionStatus: "mock_connected",
    isActive: true,
    isCritical: false,
    pageId: "mock-page-main",
    configuration: { testPlaceholder: true },
    credentialsReference: "env:MESSENGER_PAGE_ACCESS_TOKEN"
  });

  await upsertTemplate(db, {
    provider: "whatsapp",
    templateName: "order_followup",
    languageCode: "ar",
    category: "utility",
    status: "approved",
    components: { body: "مرحبًا {{name}}، نتابع معك بخصوص طلبك {{order_no}}." },
    variablesSchema: { name: "text", order_no: "text" },
    isActive: true
  });

  const greeting = await upsertSavedReply(db, {
    title: "رسالة ترحيب",
    shortcut: "/ترحيب",
    content: "أهلًا {{customer_name}} 🌷\nيسعدنا مساعدتك في مكتبة دوت كوم، تقدر تكتب طلبك مباشرة.",
    scope: "global",
    category: "automation",
    isActive: true,
    createdByUserId: "seed"
  });
  const away = await upsertSavedReply(db, {
    title: "خارج مواعيد العمل",
    shortcut: "/مواعيد",
    content: "أهلًا بحضرتك 🌷\nوصلتنا رسالتك بنجاح. فريق خدمة العملاء غير متاح حاليًا، وسيتم الرد عليك في أقرب موعد عمل.",
    scope: "global",
    category: "automation",
    isActive: true,
    createdByUserId: "seed"
  });
  await upsertSavedReply(db, {
    title: "تتبع الشحنة",
    shortcut: "/تتبع",
    content: "أهلًا {{customer_name}} 🌷\nطلبك رقم {{order_number}}\nحالة الشحنة: {{shipment_status}}\nكود التتبع: {{tracking_number}}",
    scope: "global",
    category: "shipping",
    isActive: true,
    createdByUserId: "seed"
  });
  await upsertAutomationRule(db, {
    name: "Greeting Message",
    triggerType: "new_conversation",
    priority: 10,
    conditions: { firstMessage: true },
    actions: [{ type: "send_saved_reply", savedReplyId: greeting.id }],
    cooldownSeconds: 86400,
    stopProcessing: false,
    isActive: true,
    createdByUserId: "seed"
  });
  await upsertAutomationRule(db, {
    name: "Away Message",
    triggerType: "new_inbound_message",
    priority: 20,
    conditions: { outsideBusinessHours: true },
    actions: [{ type: "send_saved_reply", savedReplyId: away.id }],
    cooldownSeconds: 21600,
    stopProcessing: false,
    isActive: true,
    createdByUserId: "seed"
  });
  await upsertAutomationRule(db, {
    name: "Keyword Tracking Reply",
    triggerType: "new_inbound_message",
    priority: 30,
    conditions: { messageContainsAny: ["طلبي", "طلبى", "الشحنة", "شحنه", "تتبع", "وصل فين"] },
    actions: [{ type: "send_tracking_status" }],
    cooldownSeconds: 600,
    stopProcessing: false,
    isActive: true,
    createdByUserId: "seed"
  });
  await ensureBusinessHours(db);
}

main().then(() => disconnectPrisma()).catch(async error => {
  console.error(error);
  await disconnectPrisma().catch(() => {});
  process.exit(1);
});
