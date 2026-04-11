import { describe, test, expect } from "bun:test";
import { encrypt, decrypt } from "./crypto";

const KEY = "a".repeat(64);
const BAD_KEY = "b".repeat(64);

describe("encrypt / decrypt", () => {
  test("round-trip", () => {
    expect(decrypt(encrypt("hello world", KEY), KEY)).toBe("hello world");
  });

  test("round-trip — empty string", () => {
    expect(decrypt(encrypt("", KEY), KEY)).toBe("");
  });

  test("round-trip — unicode", () => {
    const v = "🔐 日本語 тест";
    expect(decrypt(encrypt(v, KEY), KEY)).toBe(v);
  });

  test("same plaintext produces different ciphertexts (random IV)", () => {
    const a = encrypt("secret", KEY);
    const b = encrypt("secret", KEY);
    expect(a).not.toBe(b);
  });

  test("encrypted value starts with enc: prefix", () => {
    expect(encrypt("x", KEY).startsWith("enc:")).toBe(true);
  });

  test("wrong key throws authentication error", () => {
    const ct = encrypt("hello", KEY);
    expect(() => decrypt(ct, BAD_KEY)).toThrow();
  });

  test("truncated ciphertext throws", () => {
    const ct = encrypt("hello", KEY).slice(0, 10);
    expect(() => decrypt(ct, BAD_KEY)).toThrow();
  });

  test("plaintext (no enc: prefix) is returned as-is", () => {
    expect(decrypt("plaintext-value", KEY)).toBe("plaintext-value");
  });

  test("decrypted value does not start with enc:", () => {
    expect(decrypt(encrypt("hello", KEY), KEY).startsWith("enc:")).toBe(false);
  });
});
