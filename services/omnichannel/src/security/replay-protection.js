class ReplayProtector {
  constructor({ ttlMs = 5 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  accept(key) {
    const now = Date.now();
    for (const [item, expires] of this.seen.entries()) {
      if (expires <= now) this.seen.delete(item);
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }
}

module.exports = { ReplayProtector };
