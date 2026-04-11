import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:";

export function encrypt(plaintext: string, masterKey: string): string {
  const key = Buffer.from(masterKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(value: string, masterKey: string): string {
  if (!value.startsWith(PREFIX)) return value; // plaintext — not yet migrated
  const key = Buffer.from(masterKey, "hex");
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
