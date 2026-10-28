"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha256 = body => crypto.createHash("sha256").update(body).digest("hex");

function dataRevision(db) {
  return Math.max(0, Number(db?.meta?.dataRevision || 0));
}

function createDatabasePersistence({ filePath, logger = () => {} }) {
  if (!path.isAbsolute(filePath)) throw new Error("Database path must be absolute.");
  let writing = false;
  // Highest revision this process has read or written. A restore over a missing/unreadable file uses it as a floor so
  // the revision clients hold is never reused.
  let highestRevision = 0;
  // Revision of the file as last read or written, keyed by its size and modification time, so asking for the
  // revision (every save, every live-update ping) does not re-read and re-parse the whole database.
  let known = null;
  const fileKey = () => { const stat = fs.statSync(filePath); return `${stat.size}:${stat.mtimeMs}`; };

  function read() {
    const raw = fs.readFileSync(filePath);
    const db = JSON.parse(raw);
    const result = { db, raw, revision:dataRevision(db), sha256:sha256(raw) };
    highestRevision = Math.max(highestRevision, result.revision);
    try { known = { key:fileKey(), revision:result.revision }; } catch { known = null; }
    return result;
  }

  function revision() {
    if (!fs.existsSync(filePath)) return 0;
    try { if (known && known.key === fileKey()) return known.revision; } catch {}
    return read().revision;
  }

  function currentState() {
    const raw = fs.readFileSync(filePath);
    try { if (known && known.key === fileKey()) return { revision:known.revision, sha256:sha256(raw) }; } catch {}
    const state = read();
    return { revision:state.revision, sha256:state.sha256 };
  }

  function write(nextValue, { expectedRevision, minimumRevision = 0, operationType = "DATABASE_WRITE", performedBy = "system" } = {}) {
    if (writing) throw Object.assign(new Error("Database write already in progress."), { code:"DATABASE_WRITE_LOCKED" });
    writing = true;
    let tempPath = "", fd;
    try {
      // Only the current revision and checksum are needed, so the file is parsed only when its revision is not known.
      const current = fs.existsSync(filePath) ? currentState() : { revision:0, sha256:sha256("{}") };
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== current.revision) {
        logger({ operationType:"DATABASE_WRITE_BLOCKED_STALE_REVISION", expectedRevision:Number(expectedRevision), currentRevision:current.revision, performedBy });
        throw Object.assign(new Error("Data was modified after this operation started. Reload and retry."), { code:"DATABASE_WRITE_BLOCKED_STALE_REVISION", expectedRevision:Number(expectedRevision), currentRevision:current.revision });
      }
      // The caller's object is serialized as is; only meta is copied so its revision is never changed under the caller.
      const source = nextValue && typeof nextValue === "object" ? nextValue : {};
      const next = { ...source, meta:{ ...(source.meta && typeof source.meta === "object" ? source.meta : {}) } };
      next.meta.dataRevision = Math.max(current.revision, Number(minimumRevision) || 0) + 1;
      const body = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      const bodySha256 = sha256(body);
      tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fd, body);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      // JSON.stringify always yields valid JSON, so comparing the bytes on disk proves the file is complete without
      // parsing the whole database again.
      if (sha256(fs.readFileSync(tempPath)) !== bodySha256) throw Object.assign(new Error("Database file was not written completely."), { code:"DATABASE_WRITE_VERIFY_FAILED" });
      fs.renameSync(tempPath, filePath); tempPath = "";
      const dirFd = fs.openSync(path.dirname(filePath), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      const result = { revision:next.meta.dataRevision, beforeSha256:current.sha256, afterSha256:bodySha256, size:body.length };
      highestRevision = Math.max(highestRevision, result.revision);
      try { known = { key:fileKey(), revision:result.revision }; } catch { known = null; }
      logger({ operationType:"DATABASE_WRITE", sourceOperationType:operationType, performedBy, ...result });
      return result;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
      writing = false;
    }
  }

  return { read, write, revision, highestRevision:() => highestRevision };
}

module.exports = { createDatabasePersistence, dataRevision, sha256 };
