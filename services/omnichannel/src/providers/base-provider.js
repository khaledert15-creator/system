class BaseProvider {
  constructor({ key }) {
    this.key = key;
  }

  canHandle(channelAccount) {
    return channelAccount?.channel?.key === this.key || channelAccount?.provider === this.key;
  }

  async sendText() {
    throw new Error("sendText must be implemented by provider");
  }
}

class ProviderRegistry {
  constructor(providers = []) {
    this.providers = providers;
  }

  forAccount(channelAccount) {
    const provider = this.providers.find(item => item.canHandle(channelAccount));
    if (!provider) throw new Error(`No provider registered for ${channelAccount?.name || channelAccount?.id}`);
    return provider;
  }
}

module.exports = { BaseProvider, ProviderRegistry };
