const { env } = require("../../config/env");

class MessengerClient {
  constructor({ accessToken = env.messengerPageAccessToken, apiVersion = env.metaGraphApiVersion } = {}) {
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
    this.baseUrl = `https://graph.facebook.com/${apiVersion}`;
  }

  async sendText({ pageId = "me", psid, text }) {
    if (!this.accessToken) throw new Error("MESSENGER_PAGE_ACCESS_TOKEN is not configured");
    const response = await fetch(`${this.baseUrl}/${pageId}/messages?access_token=${encodeURIComponent(this.accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `Messenger API failed with ${response.status}`);
    return payload;
  }
}

module.exports = { MessengerClient };
