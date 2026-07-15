const { badRequest, conflict, notFound } = require("../utils/errors");

const CONNECTION_STATUSES = new Set(["not_configured", "mock_connected", "configured", "testing", "connected", "disconnected", "error"]);
const ACCOUNT_STATUSES = new Set(["not_connected", "mock_connected", "configured", "connected", "disabled", "deleted"]);

function cleanString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function sanitizeAccount(account = {}) {
  const credentialsConfigured = Array.isArray(account.credentials) && account.credentials.length > 0;
  const { credentials, ...safe } = account;
  return {
    ...safe,
    credentialsConfigured,
    credential: {
      configured: credentialsConfigured,
      maskedHint: credentialsConfigured ? "••••••••configured" : ""
    }
  };
}

function normalizeConnectionStatus(status, fallback = "not_configured") {
  return CONNECTION_STATUSES.has(status) ? status : fallback;
}

function normalizeStatus(status, fallback = "not_connected") {
  return ACCOUNT_STATUSES.has(status) ? status : fallback;
}

class ChannelService {
  constructor({ repository, credentialService }) {
    this.repository = repository;
    this.credentialService = credentialService;
  }

  channels() {
    return this.repository.channels();
  }

  async accounts() {
    const rows = await this.repository.channelAccounts();
    return rows.map(sanitizeAccount);
  }

  async account(id) {
    const account = await this.repository.findChannelAccount(id);
    if (!account) throw notFound("Channel account not found");
    return sanitizeAccount(account);
  }

  async rawAccount(id) {
    const account = await this.repository.findChannelAccount(id);
    if (!account) throw notFound("Channel account not found");
    return account;
  }

  async create(input, user) {
    const channelKey = cleanString(input.channelKey || input.channel || input.type);
    if (!["whatsapp", "messenger"].includes(channelKey)) throw badRequest("Unsupported channel type");
    const channel = await this.repository.findChannelByKey(channelKey);
    if (!channel) throw badRequest("Channel is not seeded");
    const data = this.prepareData({ ...input, channelId: channel.id, channelKey }, false);
    await this.ensureUnique(data);
    const account = await this.repository.createChannelAccount(data);
    if (input.accessToken) await this.credentialService.storeAccessToken({ channelAccountId: account.id, accessToken: input.accessToken });
    await this.audit(user, "channel_account.created", account.id, { channelKey, name: account.name });
    return this.account(account.id);
  }

  async update(id, input, user) {
    const existing = await this.rawAccount(id);
    const data = this.prepareData({ ...input, channelKey: existing.channel?.key }, true);
    await this.ensureUnique(data, id);
    const account = await this.repository.updateChannelAccount(id, data);
    if (input.accessToken) await this.credentialService.storeAccessToken({ channelAccountId: account.id, accessToken: input.accessToken });
    await this.audit(user, "channel_account.updated", id, { name: account.name });
    return this.account(id);
  }

  async activate(id, user) {
    await this.rawAccount(id);
    const account = await this.repository.updateChannelAccount(id, { isActive: true, status: "configured", connectionStatus: "configured", lastError: null });
    await this.audit(user, "channel_account.activated", id);
    return this.account(account.id);
  }

  async deactivate(id, user) {
    await this.rawAccount(id);
    const account = await this.repository.updateChannelAccount(id, { isActive: false, status: "disabled", connectionStatus: "disconnected" });
    await this.audit(user, "channel_account.deactivated", id);
    return this.account(account.id);
  }

  async softDelete(id, user) {
    await this.rawAccount(id);
    const account = await this.repository.softDeleteChannelAccount(id);
    await this.audit(user, "channel_account.deleted", id);
    return sanitizeAccount(account);
  }

  async connectionStatus(id) {
    const account = await this.account(id);
    return {
      id: account.id,
      status: account.status,
      connectionStatus: account.connectionStatus,
      lastTestedAt: account.lastTestedAt,
      lastConnectedAt: account.lastConnectedAt,
      lastError: account.lastError,
      credential: account.credential
    };
  }

  async testConnection(id, user) {
    const account = await this.rawAccount(id);
    const now = new Date();
    let connectionStatus = "not_configured";
    let status = account.status;
    let lastError = null;
    if (String(account.status || "").includes("mock") || String(account.connectionStatus || "").includes("mock")) {
      connectionStatus = "mock_connected";
      status = "mock_connected";
    } else {
      const hasCredential = Boolean(await this.repository.channelAccountCredential(id, "access_token"));
      const hasRequiredIdentity = account.channel?.key === "whatsapp" ? Boolean(account.phoneNumberId) : Boolean(account.pageId);
      if (!hasCredential || !hasRequiredIdentity) {
        connectionStatus = "not_configured";
        lastError = !hasCredential ? "missing_access_token" : "missing_account_identifier";
      } else {
        connectionStatus = "configured";
        status = account.status === "connected" ? "connected" : "configured";
      }
    }
    const updated = await this.repository.updateChannelAccount(id, {
      status,
      connectionStatus,
      lastTestedAt: now,
      lastConnectedAt: ["mock_connected", "connected", "configured"].includes(connectionStatus) ? now : account.lastConnectedAt,
      lastError
    });
    await this.audit(user, "channel_account.tested", id, { connectionStatus, lastError });
    return { account: sanitizeAccount(updated), ok: !lastError, connectionStatus, lastError };
  }

  async resolveWhatsAppAccount(phoneNumberId) {
    if (!phoneNumberId) return { account: null, reason: "missing_phone_number_id" };
    const accounts = await this.repository.findChannelAccountByPhoneNumberId(phoneNumberId);
    const whatsapp = accounts.filter(account => account.channel?.key === "whatsapp");
    if (whatsapp.length === 1) return { account: whatsapp[0] };
    if (whatsapp.length > 1) return { account: null, reason: "duplicate_phone_number_id" };
    return { account: null, reason: "unknown_channel_account" };
  }

  async resolveMessengerAccount(pageId) {
    if (!pageId) return { account: null, reason: "missing_page_id" };
    const accounts = await this.repository.findChannelAccountByPageId(pageId);
    const messenger = accounts.filter(account => account.channel?.key === "messenger");
    if (messenger.length === 1) return { account: messenger[0] };
    if (messenger.length > 1) return { account: null, reason: "duplicate_page_id" };
    return { account: null, reason: "unknown_channel_account" };
  }

  prepareData(input, partial) {
    const configuration = {
      ...(input.configuration && typeof input.configuration === "object" ? input.configuration : {}),
      graphApiVersion: cleanString(input.graphApiVersion || input.metaGraphApiVersion),
      credentialMode: cleanString(input.credentialMode || input.connectionMode)
    };
    const data = {
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.name !== undefined ? { name: cleanString(input.name) } : {}),
      ...(input.externalAccountId !== undefined ? { externalAccountId: cleanString(input.externalAccountId) } : {}),
      ...(input.externalPhoneNumber !== undefined || input.phoneNumber !== undefined ? { externalPhoneNumber: cleanString(input.externalPhoneNumber || input.phoneNumber) } : {}),
      ...(input.phoneNumberId !== undefined ? { phoneNumberId: cleanString(input.phoneNumberId) } : {}),
      ...(input.businessAccountId !== undefined || input.wabaId !== undefined ? { businessAccountId: cleanString(input.businessAccountId || input.wabaId) } : {}),
      ...(input.pageId !== undefined ? { pageId: cleanString(input.pageId) } : {}),
      ...(input.status !== undefined ? { status: normalizeStatus(input.status) } : {}),
      ...(input.connectionStatus !== undefined ? { connectionStatus: normalizeConnectionStatus(input.connectionStatus) } : {}),
      ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
      ...(input.isCritical !== undefined ? { isCritical: Boolean(input.isCritical) } : {}),
      ...(Object.values(configuration).some(Boolean) ? { configuration } : {}),
      ...(input.credentialsReference !== undefined ? { credentialsReference: cleanString(input.credentialsReference) } : {})
    };
    if (!partial) {
      if (!data.name) throw badRequest("Display name is required");
      data.status = data.status || (input.connectionMode === "mock" ? "mock_connected" : "not_connected");
      data.connectionStatus = data.connectionStatus || (data.status === "mock_connected" ? "mock_connected" : "not_configured");
      data.isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;
      data.isCritical = Boolean(input.isCritical);
      data.configuration = data.configuration || {};
    }
    if (data.name === null) throw badRequest("Display name is required");
    return data;
  }

  async ensureUnique(data, exceptId = null) {
    const accounts = await this.repository.channelAccounts();
    const duplicate = accounts.find(account => account.id !== exceptId && (
      (data.phoneNumberId && account.phoneNumberId === data.phoneNumberId) ||
      (data.pageId && account.pageId === data.pageId) ||
      (data.externalAccountId && account.externalAccountId === data.externalAccountId && account.channelId === data.channelId)
    ));
    if (duplicate) throw conflict("Channel account identifier already exists", { duplicateId: duplicate.id });
  }

  async audit(user, action, channelAccountId, metadata = {}) {
    if (!user?.id) return;
    await this.repository.createActivity({ userId: user.id, action, metadata: { channelAccountId, ...metadata } });
  }
}

module.exports = { ChannelService, sanitizeAccount, CONNECTION_STATUSES };
