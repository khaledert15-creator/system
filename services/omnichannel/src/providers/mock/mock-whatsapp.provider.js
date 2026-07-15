const { BaseProvider } = require("../base-provider");
const { id } = require("../../utils/ids");

class MockWhatsAppProvider extends BaseProvider {
  constructor() {
    super({ key: "whatsapp" });
  }

  canHandle(channelAccount) {
    return channelAccount?.channel?.key === "whatsapp" && String(channelAccount.status || "").includes("mock");
  }

  maybeFail(channelAccount) {
    const mode = channelAccount?.configuration?.mockFailureMode;
    if (mode === "retryable_once") {
      channelAccount.configuration.mockFailureMode = "";
      const error = new Error("temporary provider unavailable");
      error.retryable = true;
      error.code = "MOCK_TEMPORARY";
      throw error;
    }
    if (mode === "permanent") {
      const error = new Error("invalid recipient");
      error.permanent = true;
      error.code = "MOCK_PERMANENT";
      throw error;
    }
  }

  async sendText({ channelAccount, text, clientMessageId }) {
    this.maybeFail(channelAccount);
    return {
      externalMessageId: id("mock_wa_msg"),
      raw: { provider: "mock-whatsapp", text, clientMessageId, status: "sent" }
    };
  }

  async sendMedia({ channelAccount, message, clientMessageId }) {
    this.maybeFail(channelAccount);
    return { externalMessageId: id("mock_wa_media"), raw: { provider: "mock-whatsapp", messageType: message.messageType, mediaStorageKey: message.mediaStorageKey, clientMessageId, status: "sent" } };
  }

  async sendTemplate({ channelAccount, template, variables, clientMessageId }) {
    this.maybeFail(channelAccount);
    return { externalMessageId: id("mock_wa_tpl"), raw: { provider: "mock-whatsapp", templateName: template.templateName, variables, clientMessageId, status: "sent" } };
  }
}

module.exports = { MockWhatsAppProvider };
