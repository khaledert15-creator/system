const path = require("path");
const crypto = require("crypto");
const { env } = require("../config/env");
const { badRequest } = require("../utils/errors");

const ALLOWED = {
  image: {
    extensions: new Set(["jpg", "jpeg", "png", "webp"]),
    mimes: new Set(["image/jpeg", "image/png", "image/webp"])
  },
  document: {
    extensions: new Set(["pdf", "doc", "docx", "xls", "xlsx"]),
    mimes: new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ])
  },
  audio: {
    extensions: new Set(["mp3", "m4a", "ogg", "webm"]),
    mimes: new Set(["audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"])
  },
  video: {
    extensions: new Set(["mp4", "webm", "mov", "qt"]),
    mimes: new Set(["video/mp4", "video/webm", "video/quicktime"])
  }
};

const EXECUTABLE_EXTENSIONS = new Set(["exe", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar", "msi", "dll", "sh"]);

function extensionFor(name = "") {
  return path.extname(String(name || "")).replace(".", "").toLowerCase();
}

function typeFromMime(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || mime.includes("word") || mime.includes("excel") || mime.includes("spreadsheet")) return "document";
  return "file";
}

class MediaService {
  constructor({ storage }) {
    this.storage = storage;
  }

  validate({ filename, mimeType, size }) {
    const ext = extensionFor(filename);
    if (!ext) throw badRequest("File extension is required");
    if (EXECUTABLE_EXTENSIONS.has(ext)) throw badRequest("Executable files are not allowed");
    if (Number(size || 0) > env.uploadMaxBytes) throw badRequest("File is too large");
    const messageType = typeFromMime(mimeType || "");
    if (!ALLOWED[messageType]) throw badRequest("Unsupported file type");
    if (!ALLOWED[messageType].extensions.has(ext)) throw badRequest("File extension is not allowed");
    if (!ALLOWED[messageType].mimes.has(mimeType)) throw badRequest("MIME type is not allowed");
    return { ext, messageType };
  }

  async saveBase64({ filename, mimeType, dataBase64 }) {
    const raw = String(dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(raw, "base64");
    const { ext, messageType } = this.validate({ filename, mimeType, size: buffer.length });
    const safeName = `${Date.now()}-${crypto.randomUUID().replace(/-/g, "")}.${ext}`;
    const key = `${new Date().toISOString().slice(0, 10)}/${safeName}`;
    const saved = await this.storage.save({ key, buffer, mimeType });
    return {
      messageType,
      mediaStorageKey: saved.key,
      mediaUrl: saved.url,
      mediaFilename: path.basename(filename),
      mediaMimeType: mimeType,
      mediaSize: buffer.length,
      mediaMetadata: { storageProvider: env.storageProvider }
    };
  }
}

module.exports = { MediaService, ALLOWED, EXECUTABLE_EXTENSIONS };
