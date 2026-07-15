const { badRequest } = require("../utils/errors");
const { resolveVariables, variablesFor } = require("./saved-reply.service");

function normalizeArabic(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultSchedule() {
  return {
    monday: { start: "09:00", end: "18:00", closed: false },
    tuesday: { start: "09:00", end: "18:00", closed: false },
    wednesday: { start: "09:00", end: "18:00", closed: false },
    thursday: { start: "09:00", end: "18:00", closed: false },
    friday: { start: "00:00", end: "00:00", closed: true },
    saturday: { start: "10:00", end: "16:00", closed: false },
    sunday: { start: "09:00", end: "18:00", closed: false }
  };
}

function dayKey(date = new Date()) {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
}

function minutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isInsideBusinessHours(hours, now = new Date()) {
  const schedule = hours?.schedule || defaultSchedule();
  const today = schedule[dayKey(now)] || {};
  if (today.closed) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= minutes(today.start) && current <= minutes(today.end);
}

class AutomationService {
  constructor({ repository, messageService, savedReplyService, customerLookup }) {
    this.repository = repository;
    this.messageService = messageService;
    this.savedReplyService = savedReplyService;
    this.customerLookup = customerLookup;
  }

  listRules(filters = {}) {
    return this.repository.listAutomationRules({ ...filters, includeInactive: true });
  }

  getRule(id) {
    return this.repository.findAutomationRule(id);
  }

  async createRule(data, user) {
    if (!data.name || !data.triggerType) throw badRequest("Rule name and trigger are required");
    const rule = await this.repository.createAutomationRule({
      name: String(data.name).trim(),
      description: data.description || null,
      triggerType: data.triggerType,
      priority: Number(data.priority || 100),
      channelScope: data.channelScope || "all",
      channelAccountId: data.channelAccountId || null,
      conditions: data.conditions || {},
      actions: Array.isArray(data.actions) ? data.actions : [],
      stopProcessing: Boolean(data.stopProcessing),
      cooldownSeconds: Number(data.cooldownSeconds || 0),
      isActive: data.isActive !== false,
      createdByUserId: user.id
    });
    await this.repository.createActivity({ userId: user.id, action: "automation_rule.created", metadata: { automationRuleId: rule.id } });
    return rule;
  }

  async updateRule(id, data, user) {
    const current = await this.repository.findAutomationRule(id);
    if (!current) throw badRequest("Automation rule not found");
    const updated = await this.repository.updateAutomationRule(id, {
      name: data.name !== undefined ? String(data.name).trim() : current.name,
      description: data.description !== undefined ? data.description || null : current.description,
      triggerType: data.triggerType || current.triggerType,
      priority: data.priority !== undefined ? Number(data.priority) : current.priority,
      channelScope: data.channelScope || current.channelScope,
      channelAccountId: data.channelAccountId !== undefined ? data.channelAccountId || null : current.channelAccountId,
      conditions: data.conditions !== undefined ? data.conditions || {} : current.conditions,
      actions: data.actions !== undefined ? (Array.isArray(data.actions) ? data.actions : []) : current.actions,
      stopProcessing: data.stopProcessing !== undefined ? Boolean(data.stopProcessing) : current.stopProcessing,
      cooldownSeconds: data.cooldownSeconds !== undefined ? Number(data.cooldownSeconds) : current.cooldownSeconds,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : current.isActive
    });
    await this.repository.createActivity({ userId: user.id, action: "automation_rule.updated", metadata: { automationRuleId: id } });
    return updated;
  }

  async deleteRule(id, user) {
    const deleted = await this.repository.softDeleteAutomationRule(id);
    await this.repository.createActivity({ userId: user.id, action: "automation_rule.deleted", metadata: { automationRuleId: id } });
    return deleted;
  }

  listBusinessHours() {
    return this.repository.listBusinessHours();
  }

  saveBusinessHours(data) {
    return this.repository.upsertBusinessHours({
      id: data.id,
      name: data.name || "Default Business Hours",
      timezone: data.timezone || "Africa/Cairo",
      schedule: data.schedule || defaultSchedule(),
      isActive: data.isActive !== false
    });
  }

  async seedDefaults(user) {
    const replies = await this.savedReplyService.list({ user, includeInactive: true });
    let greeting = replies.find(item => item.shortcut === "/ترحيب" || item.shortcut === "/greeting");
    if (!greeting) {
      greeting = await this.savedReplyService.create({
        title: "رسالة ترحيب",
        shortcut: "/ترحيب",
        scope: "global",
        category: "automation",
        content: "أهلًا {{customer_name}} 🌷\nيسعدنا مساعدتك في مكتبة دوت كوم، تقدر تكتب طلبك مباشرة."
      }, { ...user, permissions: [...new Set([...(user.permissions || []), "omni:admin"])] });
    }
    let away = replies.find(item => item.shortcut === "/مواعيد" || item.shortcut === "/away");
    if (!away) {
      away = await this.savedReplyService.create({
        title: "رسالة خارج مواعيد العمل",
        shortcut: "/مواعيد",
        scope: "global",
        category: "automation",
        content: "أهلًا بحضرتك 🌷\nوصلتنا رسالتك بنجاح. فريق خدمة العملاء غير متاح حاليًا، وسيتم الرد عليك في أقرب موعد عمل."
      }, { ...user, permissions: [...new Set([...(user.permissions || []), "omni:admin"])] });
    }
    const rules = await this.repository.listAutomationRules({ includeInactive: true });
    if (!rules.some(item => item.name === "Greeting Message")) {
      await this.createRule({
        name: "Greeting Message",
        triggerType: "new_conversation",
        priority: 10,
        conditions: { firstMessage: true },
        actions: [{ type: "send_saved_reply", savedReplyId: greeting.id }],
        cooldownSeconds: 86400,
        stopProcessing: false
      }, user);
    }
    if (!rules.some(item => item.name === "Away Message")) {
      await this.createRule({
        name: "Away Message",
        triggerType: "new_inbound_message",
        priority: 20,
        conditions: { outsideBusinessHours: true },
        actions: [{ type: "send_saved_reply", savedReplyId: away.id }],
        cooldownSeconds: 21600,
        stopProcessing: false
      }, user);
    }
    if (!rules.some(item => item.name === "Keyword Tracking Reply")) {
      await this.createRule({
        name: "Keyword Tracking Reply",
        triggerType: "new_inbound_message",
        priority: 30,
        conditions: { messageContainsAny: ["طلبي", "طلبى", "الشحنة", "شحنه", "تتبع", "وصل فين"] },
        actions: [{ type: "send_tracking_status" }],
        cooldownSeconds: 600,
        stopProcessing: false
      }, user);
    }
    if (!(await this.repository.activeBusinessHours())) {
      await this.saveBusinessHours({ name: "Default Business Hours", schedule: defaultSchedule(), timezone: "Africa/Cairo", isActive: true });
    }
    return { ok: true };
  }

  async shouldMatch(rule, context) {
    const conditions = rule.conditions || {};
    const channelKey = context.conversation?.channelAccount?.channel?.key;
    if (rule.channelAccountId && rule.channelAccountId !== context.conversation.channelAccountId) return { matched: false, reason: "channel_account_mismatch" };
    if (conditions.channelEquals && conditions.channelEquals !== channelKey) return { matched: false, reason: "channel_mismatch" };
    if (conditions.firstMessage && !context.isNewConversation) return { matched: false, reason: "not_first_message" };
    if (conditions.customerExists === true && !context.conversation.customerId) return { matched: false, reason: "customer_missing" };
    if (conditions.customerNotFound === true && context.conversation.customerId) return { matched: false, reason: "customer_exists" };
    if (conditions.outsideBusinessHours) {
      const hours = await this.repository.activeBusinessHours();
      if (isInsideBusinessHours(hours, new Date())) return { matched: false, reason: "inside_business_hours" };
    }
    const text = normalizeArabic(context.message?.textContent || context.message?.caption || "");
    if (conditions.messageExact && text !== normalizeArabic(conditions.messageExact)) return { matched: false, reason: "text_not_exact" };
    if (conditions.messageContainsKeyword && !text.includes(normalizeArabic(conditions.messageContainsKeyword))) return { matched: false, reason: "keyword_missing" };
    if (Array.isArray(conditions.messageContainsAny) && conditions.messageContainsAny.length) {
      if (!conditions.messageContainsAny.some(keyword => text.includes(normalizeArabic(keyword)))) return { matched: false, reason: "keywords_missing" };
    }
    if (Array.isArray(conditions.messageContainsAll) && conditions.messageContainsAll.length) {
      if (!conditions.messageContainsAll.every(keyword => text.includes(normalizeArabic(keyword)))) return { matched: false, reason: "keywords_missing" };
    }
    return { matched: true };
  }

  cooldownKey(rule, context) {
    const contactKey = context.conversation?.contactId || context.message?.conversationId || "unknown";
    return `${rule.triggerType}:${contactKey}`;
  }

  async sendText({ context, text, source }) {
    return this.messageService.sendOutbound({
      conversationId: context.conversation.id,
      user: { id: "automation", username: "automation", name: "Automation", permissions: ["omni:admin", "omni:send"] },
      text,
      clientId: `automation-${source}-${context.message?.id || Date.now()}`,
      messageType: "text"
    });
  }

  trackingText(context) {
    const phone = context.conversation?.contact?.primaryPhone;
    const data = context.conversation?.customerId
      ? this.customerLookup.contextForCustomer(context.conversation.customerId)
      : this.customerLookup.findByPhone(phone);
    const values = variablesFor({ conversation: context.conversation, user: { name: "Automation" }, context: data });
    if (!data.customer) return "من فضلك أرسل رقم الهاتف المسجل على الطلب.";
    if (!values.tracking_number && !values.shipment_status) return `أهلًا ${values.customer_name || "بحضرتك"} 🌷\nلم نجد شحنة نشطة مرتبطة بحسابك حاليًا.`;
    return `أهلًا ${values.customer_name || "بحضرتك"} 🌷\nتم العثور على طلبك رقم ${values.order_number || "—"} 📦\nحالة الشحنة: ${values.shipment_status || "غير متاحة"}\nشركة الشحن: ${values.shipping_company || "غير متاحة"}\nكود التتبع: ${values.tracking_number || "غير متاح"}`;
  }

  async executeAction(action, context) {
    if (!action?.type) return { skipped: true, reason: "missing_action_type" };
    if (action.type === "send_saved_reply") {
      const reply = await this.savedReplyService.use(action.savedReplyId, { user: { id: "automation", name: "Automation", permissions: ["omni:admin"] }, conversation: context.conversation });
      return this.sendText({ context, text: reply.resolvedContent, source: `saved-reply-${action.savedReplyId}` });
    }
    if (action.type === "send_text") {
      const data = context.conversation?.customerId ? this.customerLookup.contextForCustomer(context.conversation.customerId) : {};
      return this.sendText({ context, text: resolveVariables(action.text || "", variablesFor({ conversation: context.conversation, user: { name: "Automation" }, context: data })), source: "text" });
    }
    if (action.type === "send_tracking_status") {
      return this.sendText({ context, text: this.trackingText(context), source: "tracking" });
    }
    if (action.type === "set_priority") {
      return this.repository.db?.conversation?.update
        ? this.repository.db.conversation.update({ where: { id: context.conversation.id }, data: { priority: action.priority || "normal" } })
        : { ok: true, priority: action.priority || "normal" };
    }
    if (action.type === "add_internal_note") {
      return this.messageService.createInternalNote({
        conversationId: context.conversation.id,
        user: { id: "automation", permissions: ["omni:admin"] },
        text: action.text || "Automation note",
        clientId: `automation-note-${context.message?.id || Date.now()}`
      });
    }
    if (action.type === "close_conversation") {
      return this.repository.updateConversationStatus({ conversationId: context.conversation.id, status: "closed", userId: "automation", action: "closed" });
    }
    return { skipped: true, reason: `unsupported_action:${action.type}` };
  }

  async runTrigger(triggerType, context) {
    if (context.source === "automation" || context.message?.direction === "outbound") return [];
    const rules = await this.repository.listAutomationRules({ triggerType });
    const results = [];
    for (const rule of rules) {
      const run = await this.repository.createAutomationRun({ automationRuleId: rule.id, conversationId: context.conversation?.id || null, messageId: context.message?.id || null, status: "pending" });
      try {
        const match = await this.shouldMatch(rule, context);
        if (!match.matched) {
          results.push(await this.repository.updateAutomationRun(run.id, { matched: false, status: "skipped", error: match.reason, completedAt: new Date() }));
          continue;
        }
        const cooldownKey = this.cooldownKey(rule, context);
        if (rule.cooldownSeconds && await this.repository.cooldownActive({ automationRuleId: rule.id, cooldownKey })) {
          results.push(await this.repository.updateAutomationRun(run.id, { matched: true, status: "skipped", error: "cooldown_active", completedAt: new Date() }));
          continue;
        }
        const executed = [];
        for (const action of (Array.isArray(rule.actions) ? rule.actions : [])) {
          try {
            const result = await this.executeAction(action, context);
            executed.push({ type: action.type, ok: !result?.error, messageId: result?.message?.id || null, skipped: result?.skipped || false, reason: result?.reason || null });
          } catch (error) {
            executed.push({ type: action.type, ok: false, error: error.message });
          }
        }
        if (rule.cooldownSeconds) await this.repository.setCooldown({ automationRuleId: rule.id, cooldownKey, seconds: rule.cooldownSeconds });
        const status = executed.some(item => item.ok === false) ? "failed" : "success";
        const updated = await this.repository.updateAutomationRun(run.id, { matched: true, status, actionsExecuted: executed, completedAt: new Date(), error: status === "failed" ? "one_or_more_actions_failed" : null });
        results.push(updated);
        if (rule.stopProcessing) break;
      } catch (error) {
        results.push(await this.repository.updateAutomationRun(run.id, { matched: false, status: "failed", error: error.message, completedAt: new Date() }));
      }
    }
    return results;
  }

  async testRule(data) {
    const fakeConversation = data.conversation || {
      id: "test-conversation",
      channelAccountId: data.channelAccountId || "test-account",
      contactId: "test-contact",
      customerId: data.customerId || null,
      contact: { displayName: "Test Customer", primaryPhone: data.phone || "" },
      channelAccount: { id: data.channelAccountId || "test-account", channel: { key: data.channel || "whatsapp" } }
    };
    const fakeMessage = { id: "test-message", direction: "inbound", textContent: data.text || "" };
    const rule = data.ruleId ? await this.repository.findAutomationRule(data.ruleId) : data.rule;
    if (!rule) throw badRequest("Automation rule is required");
    const match = await this.shouldMatch(rule, { conversation: fakeConversation, message: fakeMessage, isNewConversation: Boolean(data.isNewConversation) });
    return { matched: match.matched, reason: match.reason || null, actions: match.matched ? (rule.actions || []) : [] };
  }
}

module.exports = { AutomationService, normalizeArabic, isInsideBusinessHours, defaultSchedule };
