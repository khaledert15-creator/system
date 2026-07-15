const { BaseProvider } = require("../base-provider");
const { MessengerClient } = require("./messenger.client");

class MessengerProvider extends BaseProvider {
  constructor({ client = new MessengerClient() } = {}) {
    super({ key: "messenger" });
    this.client = client;
  }

  canHandle(channelAccount) {
    return channelAccount?.channel?.key === "messenger" && channelAccount.status === "connected";
  }

  async sendText({ channelAccount, conversation, text, credentials = {} }) {
    const identity = conversation.contact?.displayName;
    const client = credentials.accessToken ? new MessengerClient({ accessToken: credentials.accessToken }) : this.client;
    const payload = await client.sendText({ pageId: channelAccount.pageId || "me", psid: identity, text });
    return { externalMessageId: payload.message_id, raw: payload };
  }

  async sendMedia({ channelAccount, conversation, message, credentials = {} }) {
    const caption = message.caption || message.textContent || "";
    return this.sendText({ channelAccount, conversation, text: `[${message.messageType || "media"}] ${caption}`.trim(), credentials });
  }
}

module.exports = { MessengerProvider };
