import { describe, test, expect } from "bun:test";
import { parseBuildLine } from "../parse-build-line";

describe("parseBuildLine", () => {
  test("parses STEP X/Y lines", () => {
    const result = parseBuildLine("STEP 1/3: RUN apk add --no-cache nodejs");
    expect(result).not.toBeNull();
    expect(result!.step).toBe("STEP 1/3 — RUN apk add --no-cache nodejs");
    expect(result!.progress).toBe(33);
  });

  test("calculates progress as percentage", () => {
    expect(parseBuildLine("STEP 2/4: RUN something")!.progress).toBe(50);
    expect(parseBuildLine("STEP 4/4: DONE")!.progress).toBe(100);
  });

  test("truncates long step descriptions", () => {
    const long = "A".repeat(80);
    const result = parseBuildLine(`STEP 1/2: ${long}`);
    expect(result!.step.length).toBeLessThanOrEqual("STEP 1/2 — ".length + 55);
  });

  test("parses (X/Y) mise tool lines", () => {
    const result = parseBuildLine("(1/3) Installing node@22");
    expect(result).not.toBeNull();
    expect(result!.step).toBe("Installing node@22 (1/3)");
    expect(result!.progress).toBeUndefined();
  });

  test("parses mise [X/Y] progress lines", () => {
    const result = parseBuildLine("mise node [2/5] downloading");
    expect(result).not.toBeNull();
    expect(result!.progress).toBe(40);
    expect(result!.step).toContain("node");
  });

  test("returns null for unrecognized lines", () => {
    expect(parseBuildLine("Sending build context to Docker daemon")).toBeNull();
    expect(parseBuildLine("")).toBeNull();
    expect(parseBuildLine("Successfully built abc123")).toBeNull();
  });
});
