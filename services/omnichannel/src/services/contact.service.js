const { normalizePhone } = require("../utils/phone");

class ContactService {
  constructor({ repository, customerLookup }) {
    this.repository = repository;
    this.customerLookup = customerLookup;
  }

  async matchOrCreate({ channelAccountId, provider, externalIdentityId, phone, displayName }) {
    const normalizedPhone = normalizePhone(phone || externalIdentityId);
    const links = normalizedPhone ? this.customerLookup.suggestLinksByPhone(normalizedPhone) : {};
    return this.repository.findOrCreateContact({
      channelAccountId,
      provider,
      externalIdentityId: externalIdentityId || normalizedPhone,
      normalizedPhone,
      displayName,
      customerId: links.customerId || null
    });
  }
}

module.exports = { ContactService };
