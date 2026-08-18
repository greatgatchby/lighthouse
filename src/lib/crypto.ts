import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM for provider tokens at rest.
// Format: base64(iv[12] | ciphertext | authTag[16])

function key(): Buffer {
  const k = Buffer.from(env.tokenEncKey, "hex");
  if (k.length !== 32) {
    throw new Error("TOKEN_ENC_KEY must be 32 bytes of hex (openssl rand -hex 32)");
  }
  return k;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 12 + 16) throw new Error("Ciphertext too short");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
