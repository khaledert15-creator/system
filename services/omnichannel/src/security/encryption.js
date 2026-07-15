const crypto = require("crypto");

function keyFromSecret(secret) {
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptText(value, secret) {
  const key = keyFromSecret(secret);
  if (!key) throw new Error("ENCRYPTION_KEY is required");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptText(value, secret) {
  const key = keyFromSecret(secret);
  if (!key) throw new Error("ENCRYPTION_KEY is required");
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { encryptText, decryptText };
