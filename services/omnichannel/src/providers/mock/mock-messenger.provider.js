const { BaseProvider } = require("../base-provider");
const { id } = require("../../utils/ids");

class MockMessengerProvider extends BaseProvider {
  constructor() {
    super({ key: "messenger" });
  }

  canHandle(channelAccount) {
    return channelAccount?.channel?.key === "messenger" && String(channelAccount.status || "").includes("mock");
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
      externalMessageId: id("mock_msgr_msg"),
      raw: { provider: "mock-messenger", text, clientMessageId, status: "sent" }
    };
  }

  async sendMedia({ channelAccount, message, clientMessageId }) {
    this.maybeFail(channelAccount);
    return { externalMessageId: id("mock_msgr_media"), raw: { provider: "mock-messenger", messageType: message.messageType, mediaStorageKey: message.mediaStorageKey, clientMessageId, status: "sent" } };
  }
}

module.exports = { MockMessengerProvider };
