class StorageProvider {
  async save() { throw new Error("save must be implemented"); }
  async get() { throw new Error("get must be implemented"); }
  async delete() { throw new Error("delete must be implemented"); }
  async getSignedUrl() { throw new Error("getSignedUrl must be implemented"); }
}

module.exports = { StorageProvider };
