"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sha256 = body => crypto.createHash("sha256").update(body).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));

function dataRevision(db) {
  return Math.max(0, Number(db?.meta?.dataRevision || 0));
}

function createDatabasePersistence({ filePath, logger = () => {} }) {
  if (!path.isAbsolute(filePath)) throw new Error("Database path must be absolute.");
  let writing = false;

  function read() {
    const raw = fs.readFileSync(filePath);
    return { db:JSON.parse(raw), raw, revision:dataRevision(JSON.parse(raw)), sha256:sha256(raw) };
  }

  function write(nextValue, { expectedRevision, operationType = "DATABASE_WRITE", performedBy = "system" } = {}) {
    if (writing) throw Object.assign(new Error("Database write already in progress."), { code:"DATABASE_WRITE_LOCKED" });
    writing = true;
    let tempPath = "", fd;
    try {
      const current = fs.existsSync(filePath) ? read() : { db:{}, raw:Buffer.from("{}"), revision:0, sha256:sha256("{}") };
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== current.revision) {
        logger({ operationType:"DATABASE_WRITE_BLOCKED_STALE_REVISION", expectedRevision:Number(expectedRevision), currentRevision:current.revision, performedBy });
        throw Object.assign(new Error("Data was modified after this operation started. Reload and retry."), { code:"DATABASE_WRITE_BLOCKED_STALE_REVISION", expectedRevision:Number(expectedRevision), currentRevision:current.revision });
      }
      const next = clone(nextValue || {});
      next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
      next.meta.dataRevision = current.revision + 1;
      const body = `${JSON.stringify(next, null, 2)}\n`;
      JSON.parse(body);
      tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fd, body, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      JSON.parse(fs.readFileSync(tempPath, "utf8"));
      fs.renameSync(tempPath, filePath); tempPath = "";
      const dirFd = fs.openSync(path.dirname(filePath), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      const after = fs.readFileSync(filePath);
      const result = { revision:next.meta.dataRevision, beforeSha256:current.sha256, afterSha256:sha256(after), size:after.length };
      logger({ operationType:"DATABASE_WRITE", sourceOperationType:operationType, performedBy, ...result });
      return result;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
      writing = false;
    }
  }

  return { read, write, revision:() => fs.existsSync(filePath) ? read().revision : 0 };
}

module.exports = { createDatabasePersistence, dataRevision, sha256 };
