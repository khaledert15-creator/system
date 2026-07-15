const { badRequest, forbidden } = require("../utils/errors");

const VALID_SCOPES = new Set(["personal", "team", "global"]);
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function normalizeShortcut(value) {
  const shortcut = String(value || "").trim();
  if (!shortcut) return "";
  return shortcut.startsWith("/") ? shortcut : `/${shortcut}`;
}

function variablesFor({ conversation = {}, user = {}, context = {} } = {}) {
  const contact = conversation.contact || {};
  const customer = context.customer || {};
  const orders = context.orders || [];
  const shipments = context.shipments || [];
  const activeShipment = shipments.find(item => !["delivered", "returned", "cancelled"].includes(String(item.status || "").toLowerCase())) || shipments[0] || {};
  const order = orders[0] || {};
  return {
    customer_name: customer.name || contact.displayName || "",
    customer_phone: customer.phone || contact.primaryPhone || "",
    order_number: order.orderNo || order.number || order.id || conversation.onlineOrderId || "",
    tracking_number: activeShipment.trackingNumber || activeShipment.trackingCode || "",
    shipment_status: activeShipment.statusText || activeShipment.status || "",
    shipping_company: activeShipment.companyName || activeShipment.shippingCompany || activeShipment.carrier || "",
    agent_name: user.name || user.username || user.id || ""
  };
}

function resolveVariables(template, values = {}) {
  return String(template || "").replace(VARIABLE_PATTERN, (_match, key) => values[key] ?? "");
}

class SavedReplyService {
  constructor({ repository, customerLookup }) {
    this.repository = repository;
    this.customerLookup = customerLookup;
  }

  canManage(reply, user) {
    if (!reply) return false;
    if (user.permissions.includes("omni:admin") || user.permissions.includes("omnichannel.saved_replies.update")) return true;
    return reply.scope === "personal" && reply.ownerUserId === user.id;
  }

  async list({ user, q, scope, channelType, includeInactive = false }) {
    return this.repository.listSavedReplies({ q, scope, channelType, userId: user.id, teamKey: user.role || null, includeInactive });
  }

  async get(id, user) {
    const reply = await this.repository.findSavedReply(id);
    if (!reply) throw badRequest("Saved reply not found");
    const visible = (await this.list({ user, includeInactive: true })).some(item => item.id === reply.id);
    if (!visible && !user.permissions.includes("omni:admin")) throw forbidden("Saved reply is not visible to this user");
    return reply;
  }

  assertScopeAllowed(scope, user) {
    if (scope === "personal") return;
    if (scope === "team" && (user.permissions.includes("omni:admin") || user.permissions.includes("omnichannel.saved_replies.create_team"))) return;
    if (scope === "global" && (user.permissions.includes("omni:admin") || user.permissions.includes("omnichannel.saved_replies.create_global"))) return;
    throw forbidden("Permission denied for saved reply scope");
  }

  async validateUnique({ shortcut, scope, ownerUserId, teamKey, excludeId }) {
    const existing = await this.repository.shortcutExists({ shortcut, scope, ownerUserId, teamKey, excludeId });
    if (existing) throw badRequest("Shortcut already exists for this scope");
  }

  async create(data, user) {
    const scope = VALID_SCOPES.has(data.scope) ? data.scope : "personal";
    this.assertScopeAllowed(scope, user);
    const shortcut = normalizeShortcut(data.shortcut);
    if (!shortcut || !data.title || !data.content) throw badRequest("Title, shortcut and content are required");
    const ownerUserId = scope === "personal" ? user.id : null;
    const teamKey = scope === "team" ? (data.teamKey || user.role || "default") : null;
    await this.validateUnique({ shortcut, scope, ownerUserId, teamKey });
    const reply = await this.repository.createSavedReply({
      title: String(data.title).trim(),
      shortcut,
      content: String(data.content),
      scope,
      ownerUserId,
      teamKey,
      category: data.category || null,
      channelType: data.channelType || null,
      isActive: data.isActive !== false,
      createdByUserId: user.id
    });
    await this.repository.createActivity({ userId: user.id, action: "saved_reply.created", metadata: { savedReplyId: reply.id, scope } });
    return reply;
  }

  async update(id, data, user) {
    const current = await this.get(id, user);
    if (!this.canManage(current, user)) throw forbidden("Cannot update this saved reply");
    const scope = data.scope && VALID_SCOPES.has(data.scope) ? data.scope : current.scope;
    if (scope !== current.scope) this.assertScopeAllowed(scope, user);
    const shortcut = data.shortcut ? normalizeShortcut(data.shortcut) : current.shortcut;
    const ownerUserId = scope === "personal" ? (current.ownerUserId || user.id) : null;
    const teamKey = scope === "team" ? (data.teamKey || current.teamKey || user.role || "default") : null;
    await this.validateUnique({ shortcut, scope, ownerUserId, teamKey, excludeId: id });
    const updated = await this.repository.updateSavedReply(id, {
      title: data.title !== undefined ? String(data.title).trim() : current.title,
      shortcut,
      content: data.content !== undefined ? String(data.content) : current.content,
      scope,
      ownerUserId,
      teamKey,
      category: data.category !== undefined ? data.category || null : current.category,
      channelType: data.channelType !== undefined ? data.channelType || null : current.channelType,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : current.isActive
    });
    await this.repository.createActivity({ userId: user.id, action: "saved_reply.updated", metadata: { savedReplyId: id } });
    return updated;
  }

  async delete(id, user) {
    const current = await this.get(id, user);
    if (!this.canManage(current, user)) throw forbidden("Cannot delete this saved reply");
    const deleted = await this.repository.softDeleteSavedReply(id);
    await this.repository.createActivity({ userId: user.id, action: "saved_reply.deleted", metadata: { savedReplyId: id } });
    return deleted;
  }

  async use(id, { user, conversation = null } = {}) {
    const reply = await this.get(id, user);
    const context = conversation?.customerId
      ? this.customerLookup.contextForCustomer(conversation.customerId)
      : (conversation?.contact?.primaryPhone ? this.customerLookup.findByPhone(conversation.contact.primaryPhone) : {});
    const content = resolveVariables(reply.content, variablesFor({ conversation, user, context }));
    await this.repository.markSavedReplyUsed(id);
    await this.repository.createActivity({ userId: user.id, action: "saved_reply.used", conversationId: conversation?.id || null, metadata: { savedReplyId: id } });
    return { ...reply, resolvedContent: content };
  }

  preview(content, { user, conversation = null } = {}) {
    const context = conversation?.customerId
      ? this.customerLookup.contextForCustomer(conversation.customerId)
      : (conversation?.contact?.primaryPhone ? this.customerLookup.findByPhone(conversation.contact.primaryPhone) : {});
    return resolveVariables(content, variablesFor({ conversation, user, context }));
  }
}

module.exports = { SavedReplyService, resolveVariables, variablesFor, normalizeShortcut };
