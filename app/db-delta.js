(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DbDelta = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Pages used to download the whole database (12 MB+) again after every save or tracking update. The server now
  // remembers a fingerprint of every record of the database states it served, so a page that already holds one of
  // those states can ask for only what changed since then.
  //
  // A top-level array whose items all carry a unique id is tracked record by record; anything else (settings, meta,
  // arrays of plain values) is tracked as one value and sent whole when it changes.

  const HISTORY_LIMIT = 300;

  function recordIds(value) {
    if (!Array.isArray(value)) return null;
    const ids = new Array(value.length), seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      const id = item && typeof item === "object" && !Array.isArray(item) ? item.id : undefined;
      if ((typeof id !== "string" && typeof id !== "number") || id === "") return null;
      const key = String(id);
      if (seen.has(key)) return null;
      seen.add(key);
      ids[index] = key;
    }
    return ids;
  }

  // `hash` is injected (sha1 on the server) so this file also loads in the browser, which only applies deltas.
  function fingerprint(db, hash) {
    const keys = new Map();
    for (const [key, value] of Object.entries(db || {})) {
      const ids = recordIds(value);
      if (ids) {
        const hashes = new Map();
        for (let index = 0; index < value.length; index += 1) hashes.set(ids[index], hash(JSON.stringify(value[index])));
        keys.set(key, { kind:"records", ids, hashes });
      } else {
        keys.set(key, { kind:"value", hash:hash(JSON.stringify(value === undefined ? null : value)) });
      }
    }
    return keys;
  }

  function sameOrderAfter(previousIds, removed, nextIds) {
    // Removing records and appending new ones keeps the order the page can rebuild by itself.
    const kept = previousIds.filter(id => !removed.has(id));
    for (let index = 0; index < kept.length; index += 1) if (kept[index] !== nextIds[index]) return false;
    return true;
  }

  function diff(previous, next) {
    const changes = new Map();
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
      const before = previous.get(key), after = next.get(key);
      if (!after) { changes.set(key, { kind:"value" }); continue; }
      if (!before || before.kind !== after.kind || after.kind === "value") {
        if (!before || before.kind !== after.kind || before.hash !== after.hash) changes.set(key, { kind:"value" });
        continue;
      }
      const changed = new Set(), removed = new Set();
      for (const [id, value] of after.hashes) if (before.hashes.get(id) !== value) changed.add(id);
      for (const id of before.hashes.keys()) if (!after.hashes.has(id)) removed.add(id);
      const reordered = !sameOrderAfter(before.ids, removed, after.ids);
      if (changed.size || removed.size || reordered) changes.set(key, { kind:"records", changed, removed, reordered });
    }
    return changes;
  }

  function createTracker({ hash, historyLimit = HISTORY_LIMIT }) {
    let current = null; // { revision, keys }
    const history = [];  // consecutive steps { from, to, changes }

    // Called with every database state the server sends to a page, so each revision a page can hold is known.
    function observe(revision, db) {
      revision = String(revision);
      if (current && current.revision === revision) return;
      const keys = fingerprint(db, hash);
      if (current) {
        history.push({ from:current.revision, to:revision, changes:diff(current.keys, keys) });
        if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
      }
      current = { revision, keys };
    }

    // Returns null when the page's revision is unknown (server restarted, too old): it must load everything.
    function changesSince(since, db) {
      since = String(since);
      if (!current) return null;
      if (since === current.revision) return { revision:current.revision, since, changes:{}, counts:countsOf(db) };
      const start = history.findIndex(step => step.from === since);
      if (start < 0) return null;
      const merged = new Map();
      for (const step of history.slice(start)) {
        for (const [key, change] of step.changes) {
          const target = merged.get(key);
          if (change.kind === "value" || target?.kind === "value") { merged.set(key, { kind:"value" }); continue; }
          if (!target) { merged.set(key, { kind:"records", changed:new Set(change.changed), removed:new Set(change.removed), reordered:change.reordered }); continue; }
          change.changed.forEach(id => target.changed.add(id));
          change.removed.forEach(id => target.removed.add(id));
          target.reordered = target.reordered || change.reordered;
        }
      }
      const changes = {};
      for (const [key, change] of merged) {
        const value = db[key];
        if (change.kind === "value" || !Array.isArray(value)) { changes[key] = value === undefined ? { deleted:true } : { value }; continue; }
        const byId = new Map(value.map(item => [String(item.id), item]));
        const ids = [...new Set([...change.changed, ...change.removed])];
        const upsert = ids.filter(id => byId.has(id)).map(id => byId.get(id));
        const remove = ids.filter(id => !byId.has(id));
        // New records keep the server's order when the page appends them, so send them in that order.
        const position = new Map(value.map((item, index) => [String(item.id), index]));
        upsert.sort((a, b) => position.get(String(a.id)) - position.get(String(b.id)));
        changes[key] = { upsert, remove, ...(change.reordered ? { order:value.map(item => String(item.id)) } : {}) };
      }
      return { revision:current.revision, since, changes, counts:countsOf(db) };
    }

    return { observe, changesSince, revision:() => current?.revision ?? null };
  }

  function countsOf(db) {
    const counts = {};
    for (const [key, value] of Object.entries(db || {})) if (Array.isArray(value)) counts[key] = value.length;
    return counts;
  }

  // Applies a delta to a page's copy (a new top-level object; untouched collections are shared). Returns null when the
  // server's order names a record the page does not have, so the page falls back to a full load.
  function applyDelta(base, delta) {
    const next = { ...base };
    for (const [key, change] of Object.entries(delta.changes || {})) {
      if (change.deleted) { delete next[key]; continue; }
      if ("value" in change) { next[key] = change.value; continue; }
      const previous = Array.isArray(base[key]) ? base[key] : [];
      const removed = new Set((change.remove || []).map(String));
      const updates = new Map((change.upsert || []).map(item => [String(item.id), item]));
      const rows = [];
      for (const item of previous) {
        const id = String(item?.id);
        if (removed.has(id)) continue;
        if (updates.has(id)) { rows.push(updates.get(id)); updates.delete(id); }
        else rows.push(item);
      }
      for (const item of updates.values()) rows.push(item);
      if (change.order) {
        const position = new Map(change.order.map((id, index) => [id, index]));
        if (rows.some(item => !position.has(String(item?.id)))) return null;
        rows.sort((a, b) => position.get(String(a.id)) - position.get(String(b.id)));
      }
      next[key] = rows;
    }
    return next;
  }

  // The page adds defaults to some lists (shipping companies, cash accounts...), so each list may be longer than the
  // server's by a fixed amount, measured when the page last loaded everything (`drift`).
  function countsMatch(db, counts = {}, drift = {}) {
    return Object.entries(counts).every(([key, count]) => Array.isArray(db?.[key]) && db[key].length === count + (drift[key] || 0));
  }

  function countDrift(serverDb, pageDb) {
    const drift = {};
    for (const [key, value] of Object.entries(serverDb || {})) {
      if (Array.isArray(value) && Array.isArray(pageDb?.[key]) && pageDb[key].length !== value.length) drift[key] = pageDb[key].length - value.length;
    }
    return drift;
  }

  return { HISTORY_LIMIT, recordIds, fingerprint, diff, createTracker, applyDelta, countsMatch, countDrift, countsOf };
});
