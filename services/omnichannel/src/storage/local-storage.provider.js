const fs = require("fs");
const path = require("path");
const { StorageProvider } = require("./storage-provider");

class LocalStorageProvider extends StorageProvider {
  constructor({ root }) {
    super();
    this.root = path.resolve(root);
  }

  safePath(key) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root)) throw new Error("Invalid storage key");
    return target;
  }

  async save({ key, buffer }) {
    const target = this.safePath(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, buffer);
    return { key, url: `/api/media/${encodeURIComponent(key)}` };
  }

  async get(key) {
    return fs.promises.readFile(this.safePath(key));
  }

  async delete(key) {
    await fs.promises.rm(this.safePath(key), { force: true });
  }

  async getSignedUrl(key) {
    return `/api/media/${encodeURIComponent(key)}`;
  }
}

module.exports = { LocalStorageProvider };
