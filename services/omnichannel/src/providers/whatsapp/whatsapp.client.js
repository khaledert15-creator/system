const { env } = require("../../config/env");

class WhatsAppClient {
  constructor({ accessToken = env.whatsappAccessToken, apiVersion = env.metaGraphApiVersion } = {}) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.baseUrl = `https://graph.facebook.com/${apiVersion}`;
  }

  async sendText({ phoneNumberId, to, text }) {
    if (!this.accessToken) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
    if (!phoneNumberId) throw new Error("WhatsApp phone_number_id is required");
    const response = await fetch(`${this.baseUrl}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `WhatsApp API failed with ${response.status}`);
    return payload;
  }
}

module.exports = { WhatsAppClient };
