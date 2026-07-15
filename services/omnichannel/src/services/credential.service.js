const { env } = require("../config/env");
const { encryptText, decryptText } = require("../security/encryption");

function maskSecret(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  const tail = raw.slice(-4);
  return `${"•".repeat(8)}${tail}`;
}

class CredentialService {
  constructor({ repository }) {
    this.repository = repository;
  }

  canStoreEncrypted() {
    return Boolean(env.encryptionKey);
  }

  async storeAccessToken({ channelAccountId, accessToken }) {
    const raw = String(accessToken || "").trim();
    if (!raw) return null;
    if (!this.canStoreEncrypted()) {
      const error = new Error("ENCRYPTION_KEY is required to store credentials");
      error.status = 400;
      throw error;
    }
    const encryptedValue = encryptText(raw, env.encryptionKey);
    return this.repository.upsertChannelAccountCredential({
      channelAccountId,
      credentialType: "access_token",
      encryptedValue,
      keyVersion: "v1"
    });
  }

  async accessTokenForAccount(channelAccountId) {
    const credential = await this.repository.channelAccountCredential(channelAccountId, "access_token");
    if (!credential) return null;
    return decryptText(credential.encryptedValue, env.encryptionKey);
  }

  async summary(channelAccountId) {
    const credential = await this.repository.channelAccountCredential(channelAccountId, "access_token");
    return {
      configured: Boolean(credential),
      maskedHint: credential ? "••••••••configured" : ""
    };
  }

  maskSecret(value) {
    return maskSecret(value);
  }
}

module.exports = { CredentialService, maskSecret };
