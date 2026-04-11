import { describe, test, expect } from "bun:test";
import { normalizeResult } from "./task-utils";

// ─── normalizeResult ─────────────────────────────────────────────────────────

describe("normalizeResult", () => {
  test("passthrough: already-normalized data is unchanged", () => {
    const input = { mr_url: "https://example.com/mr/1", commit_hash: "abc123" };
    expect(normalizeResult(input)).toEqual(input);
  });

  test("renames mergeRequestUrl → mr_url", () => {
    const out = normalizeResult({ mergeRequestUrl: "https://gl.com/mr/1" });
    expect(out.mr_url).toBe("https://gl.com/mr/1");
    expect(out.mergeRequestUrl).toBeUndefined();
  });

  test("renames pullRequestUrl → mr_url when mr_url absent", () => {
    const out = normalizeResult({ pullRequestUrl: "https://gh.com/pr/1" });
    expect(out.mr_url).toBe("https://gh.com/pr/1");
    expect(out.pullRequestUrl).toBeUndefined();
  });

  test("renames pr_url → mr_url when mr_url absent", () => {
    const out = normalizeResult({ pr_url: "https://gh.com/pr/2" });
    expect(out.mr_url).toBe("https://gh.com/pr/2");
    expect(out.pr_url).toBeUndefined();
  });

  test("does not overwrite mr_url if already present", () => {
    const out = normalizeResult({ mr_url: "existing", mergeRequestUrl: "new" });
    expect(out.mr_url).toBe("existing");
    expect(out.mergeRequestUrl).toBe("new");
  });

  test("renames commitHash → commit_hash", () => {
    const out = normalizeResult({ commitHash: "abc" });
    expect(out.commit_hash).toBe("abc");
    expect(out.commitHash).toBeUndefined();
  });

  test("renames commit → commit_hash when commit_hash absent", () => {
    const out = normalizeResult({ commit: "def" });
    expect(out.commit_hash).toBe("def");
    expect(out.commit).toBeUndefined();
  });

  test("renames commitMessage → commit_message", () => {
    const out = normalizeResult({ commitMessage: "fix: bug" });
    expect(out.commit_message).toBe("fix: bug");
    expect(out.commitMessage).toBeUndefined();
  });

  test("renames filesChanged → files_changed", () => {
    const out = normalizeResult({ filesChanged: ["a.ts"] });
    expect(out.files_changed).toEqual(["a.ts"]);
    expect(out.filesChanged).toBeUndefined();
  });

  test("normalizes files_changed strings passthrough", () => {
    const out = normalizeResult({ files_changed: ["a.ts", "b.ts"] });
    expect(out.files_changed).toEqual(["a.ts", "b.ts"]);
  });

  test("normalizes files_changed objects using .path", () => {
    const out = normalizeResult({ files_changed: [{ path: "src/a.ts" }] });
    expect(out.files_changed).toEqual(["src/a.ts"]);
  });

  test("normalizes files_changed objects using .filename when .path absent", () => {
    const out = normalizeResult({ files_changed: [{ filename: "b.ts" }] });
    expect(out.files_changed).toEqual(["b.ts"]);
  });

  test("normalizes files_changed objects using .new_path as fallback", () => {
    const out = normalizeResult({ files_changed: [{ new_path: "c.ts" }] });
    expect(out.files_changed).toEqual(["c.ts"]);
  });

  test("normalizes files_changed objects using JSON.stringify as last resort", () => {
    const obj = { something: "weird" };
    const out = normalizeResult({ files_changed: [obj] });
    expect(out.files_changed).toEqual([JSON.stringify(obj)]);
  });

  test("renames testDetails → test_details", () => {
    const out = normalizeResult({ testDetails: "5 passed" });
    expect(out.test_details).toBe("5 passed");
    expect(out.testDetails).toBeUndefined();
  });

  test("normalizes tests array: all passed → tests=passed", () => {
    const out = normalizeResult({ tests: [{ status: "passed" }, { status: "passed" }] });
    expect(out.tests).toBe("passed");
    expect(out.test_details).toBe("2 passed, 0 failed, 2 total");
  });

  test("normalizes tests array: any failed → tests=failed", () => {
    const out = normalizeResult({ tests: [{ status: "passed" }, { status: "failed" }] });
    expect(out.tests).toBe("failed");
  });

  test("normalizes tests array: mixed unknown → tests=unknown", () => {
    const out = normalizeResult({ tests: [{ status: "skipped" }, { status: "passed" }] });
    expect(out.tests).toBe("unknown");
  });

  test("normalizes testResults object: failed=0 → tests=passed", () => {
    const out = normalizeResult({ testResults: { passed: 5, failed: 0, total: 5 } });
    expect(out.tests).toBe("passed");
    expect(out.test_details).toBe("5 passed, 0 failed, 5 total");
    expect(out.testResults).toBeUndefined();
  });

  test("normalizes testResults object: failed>0 → tests=failed", () => {
    const out = normalizeResult({ testResults: { passed: 3, failed: 2, total: 5 } });
    expect(out.tests).toBe("failed");
  });
});

