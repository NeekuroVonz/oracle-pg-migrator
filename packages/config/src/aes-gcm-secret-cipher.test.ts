import { describe, expect, test } from "bun:test";
import { AesGcmSecretCipher } from "./aes-gcm-secret-cipher";

describe("AesGcmSecretCipher", () => {
  test("round-trips a password", () => {
    const cipher = new AesGcmSecretCipher("ab".repeat(32));
    const encrypted = cipher.encrypt("s3cret!");
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted.includes("s3cret!")).toBe(false);
    expect(cipher.decrypt(encrypted)).toBe("s3cret!");
  });

  test("uses a unique iv each time", () => {
    const cipher = new AesGcmSecretCipher("ab".repeat(32));
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  test("rejects a tampered payload", () => {
    const cipher = new AesGcmSecretCipher("ab".repeat(32));
    const encrypted = cipher.encrypt("hello");
    const parts = encrypted.split(":");
    parts[2] = `${parts[2]}aa`;
    expect(() => cipher.decrypt(parts.join(":"))).toThrow();
  });
});
