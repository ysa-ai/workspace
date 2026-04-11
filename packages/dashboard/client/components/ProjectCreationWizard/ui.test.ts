import { describe, test, expect } from "bun:test";
import { confidence } from "./ui";
import type { DetectedConfig } from "./index";

describe("confidence()", () => {
  test("returns undefined when detected is null", () => {
    expect(confidence(null, "installCommand")).toBeUndefined();
  });

  test("returns undefined when detected has no confidence map", () => {
    const detected: DetectedConfig = { installCommand: "bun install" };
    expect(confidence(detected, "installCommand")).toBeUndefined();
  });

  test("returns undefined when field not in confidence map", () => {
    const detected: DetectedConfig = { confidence: { buildCommand: "high" } };
    expect(confidence(detected, "installCommand")).toBeUndefined();
  });

  test("returns high", () => {
    const detected: DetectedConfig = { confidence: { installCommand: "high" } };
    expect(confidence(detected, "installCommand")).toBe("high");
  });

  test("returns medium", () => {
    const detected: DetectedConfig = { confidence: { repositoryUrl: "medium" } };
    expect(confidence(detected, "repositoryUrl")).toBe("medium");
  });

  test("returns low", () => {
    const detected: DetectedConfig = { confidence: { memoryLimit: "low" } };
    expect(confidence(detected, "memoryLimit")).toBe("low");
  });

  test("handles detected with empty confidence map", () => {
    const detected: DetectedConfig = { confidence: {} };
    expect(confidence(detected, "installCommand")).toBeUndefined();
  });
});
