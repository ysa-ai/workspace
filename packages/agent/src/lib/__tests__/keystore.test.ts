import { describe, test, expect, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

// Force file-based storage throughout this test file (no Keychain calls)
Object.defineProperty(process, "platform", { value: "linux", configurable: true });

const testDir = join(tmpdir(), `ysa-keystore-test-${Date.now()}`);
process.env.HOME = testDir;

// Import AFTER overriding platform/HOME so the module sees linux + testDir
const { addCredential, removeCredential, listCredentials, getCredentialKey } = await import("../keystore.js");

beforeEach(async () => {
  await rm(join(testDir, ".config", "ysa-agent"), { recursive: true, force: true });
  await mkdir(join(testDir, ".config", "ysa-agent"), { recursive: true });
});

// ─── addCredential ────────────────────────────────────────────────────────────

describe("addCredential", () => {
  test("stores credential metadata (name, provider, type, createdAt)", async () => {
    await addCredential("my-key", "claude", "api_key", "sk-ant-secret");
    const creds = await listCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0].name).toBe("my-key");
    expect(creds[0].provider).toBe("claude");
    expect(creds[0].type).toBe("api_key");
    expect(typeof creds[0].createdAt).toBe("string");
  });

  test("stores key value separately (not in metadata list)", async () => {
    await addCredential("my-key", "claude", "api_key", "sk-ant-secret");
    const creds = await listCredentials();
    const metaJson = JSON.stringify(creds);
    expect(metaJson).not.toContain("sk-ant-secret");
  });

  test("rejects duplicate name", async () => {
    await addCredential("dup", "claude", "api_key", "key1");
    await expect(addCredential("dup", "claude", "api_key", "key2")).rejects.toThrow('"dup" already exists');
  });
});

// ─── removeCredential ─────────────────────────────────────────────────────────

describe("removeCredential", () => {
  test("removes credential by name", async () => {
    await addCredential("to-remove", "mistral", "api_key", "mistral-key-123");
    await removeCredential("to-remove");
    const creds = await listCredentials();
    expect(creds.find((c) => c.name === "to-remove")).toBeUndefined();
  });

  test("no-ops silently on unknown name", async () => {
    await expect(removeCredential("nonexistent")).resolves.toBeUndefined();
  });
});

// ─── listCredentials ──────────────────────────────────────────────────────────

describe("listCredentials", () => {
  test("returns empty array when no credentials configured", async () => {
    const creds = await listCredentials();
    expect(creds).toEqual([]);
  });

  test("returns metadata array without key values", async () => {
    await addCredential("key-a", "claude", "api_key", "sk-secret-a");
    await addCredential("key-b", "mistral", "api_key", "sk-secret-b");
    const creds = await listCredentials();
    expect(creds).toHaveLength(2);
    expect(creds.map((c) => c.name)).toEqual(["key-a", "key-b"]);
    for (const c of creds) {
      expect((c as any).key).toBeUndefined();
      expect((c as any).apiKey).toBeUndefined();
    }
  });
});

// ─── getCredentialKey ─────────────────────────────────────────────────────────

describe("getCredentialKey", () => {
  test("returns key value for known name", async () => {
    await addCredential("lookup-key", "claude", "api_key", "sk-ant-the-value");
    const key = await getCredentialKey("lookup-key");
    expect(key).toBe("sk-ant-the-value");
  });

  test("returns null for unknown name", async () => {
    const key = await getCredentialKey("unknown-name");
    expect(key).toBeNull();
  });
});
