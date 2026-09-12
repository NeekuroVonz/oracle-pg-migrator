import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretCipher } from "./secret-cipher";

const VERSION = "v1";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const fromB64 = Buffer.from(trimmed, "base64");
  if (fromB64.length === KEY_LENGTH) {
    return fromB64;
  }
  throw new Error("SECRETS_MASTER_KEY must be 32 bytes as 64 hex chars or base64");
}

export class AesGcmSecretCipher implements SecretCipher {
  private readonly key: Buffer;

  constructor(masterKey: string | Buffer) {
    this.key = typeof masterKey === "string" ? parseMasterKey(masterKey) : masterKey;
    if (this.key.length !== KEY_LENGTH) {
      throw new Error("AES-256-GCM key must be 32 bytes");
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${b64url(iv)}:${b64url(ciphertext)}:${b64url(tag)}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("unsupported secret payload");
    }
    const [, ivPart, ciphertextPart, tagPart] = parts;
    if (!ivPart || !ciphertextPart || !tagPart) {
      throw new Error("malformed secret payload");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, fromB64url(ivPart));
    decipher.setAuthTag(fromB64url(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(fromB64url(ciphertextPart)),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
