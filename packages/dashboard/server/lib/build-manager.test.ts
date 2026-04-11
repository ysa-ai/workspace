import { describe, test, expect } from "bun:test";
import { getBuildState, startBuild, updateBuildProgress } from "./build-manager";

let _id = 0;
function freshId() { return `test-bm-${_id++}`; }

describe("updateBuildProgress", () => {
  test("does nothing when no build is in progress", () => {
    const id = freshId();
    const before = getBuildState(id);
    updateBuildProgress(id, "STEP 1/2 — foo", 50);
    const after = getBuildState(id);
    expect(after.status).toBe("idle");
    expect(before).toEqual(after);
  });

  test("updates step and progress during a build", async () => {
    const id = freshId();
    let resolve!: (r: { ok: boolean }) => void;
    const promise = new Promise<{ ok: boolean }>((res) => { resolve = res; });
    startBuild(id, async () => promise);

    updateBuildProgress(id, "STEP 1/2 — Install", 50);
    const state = getBuildState(id);
    expect(state.status).toBe("building");
    expect(state.step).toBe("STEP 1/2 — Install");
    expect(state.progress).toBe(50);

    resolve({ ok: true });
    await promise;
  });

  test("does not decrease progress", async () => {
    const id = freshId();
    let resolve!: (r: { ok: boolean }) => void;
    const promise = new Promise<{ ok: boolean }>((res) => { resolve = res; });
    startBuild(id, async () => promise);

    updateBuildProgress(id, "STEP 2/2 — Done", 100);
    updateBuildProgress(id, "STEP 1/2 — Old", 50);
    expect(getBuildState(id).progress).toBe(100);

    resolve({ ok: true });
    await promise;
  });

  test("sets done state on completion", async () => {
    const id = freshId();
    let resolve!: (r: { ok: boolean }) => void;
    const promise = new Promise<{ ok: boolean }>((res) => { resolve = res; });
    startBuild(id, async () => promise);
    resolve({ ok: true });
    await promise;
    await Bun.sleep(0);
    const state = getBuildState(id);
    expect(state.status).toBe("done");
    expect(state.progress).toBe(100);
  });

  test("sets error state on failure", async () => {
    const id = freshId();
    let resolve!: (r: { ok: boolean; error?: string }) => void;
    const promise = new Promise<{ ok: boolean; error?: string }>((res) => { resolve = res; });
    startBuild(id, async () => promise);
    resolve({ ok: false, error: "build exploded" });
    await promise;
    await Bun.sleep(0);
    const state = getBuildState(id);
    expect(state.status).toBe("error");
    expect(state.error).toBe("build exploded");
  });
});
