const { BaseProvider } = require("../base-provider");
const { WhatsAppClient } = require("./whatsapp.client");

class WhatsAppProvider extends BaseProvider {
  constructor({ client = new WhatsAppClient() } = {}) {
    super({ key: "whatsapp" });
    this.client = client;
  }

  canHandle(channelAccount) {
    return channelAccount?.channel?.key === "whatsapp" && channelAccount.status === "connected";
  }

  async sendText({ channelAccount, conversation, text, credentials = {} }) {
    const to = conversation.contact?.primaryPhone || conversation.contact?.displayName;
    const phoneNumberId = channelAccount.phoneNumberId || channelAccount.configuration?.phoneNumberId;
    const client = credentials.accessToken ? new WhatsAppClient({ accessToken: credentials.accessToken }) : this.client;
    const payload = await client.sendText({ phoneNumberId, to, text });
    return { externalMessageId: payload.messages?.[0]?.id, raw: payload };
  }

  async sendMedia({ channelAccount, conversation, message, credentials = {} }) {
    const caption = message.caption || message.textContent || "";
    return this.sendText({ channelAccount, conversation, text: `[${message.messageType || "media"}] ${caption}`.trim(), credentials });
  }

  async sendTemplate({ channelAccount, conversation, template, variables, credentials = {} }) {
    return this.sendText({ channelAccount, conversation, text: `Template: ${template.templateName} ${JSON.stringify(variables || {})}`, credentials });
  }
}

module.exports = { WhatsAppProvider };
