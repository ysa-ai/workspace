import { describe, test, expect } from "bun:test";
import { formatDuration, statusLabel, statusSortOrder } from "./format";

// Fixed reference timestamp
const T0 = "2026-01-01T00:00:00Z";

function ts(offsetSeconds: number): string {
  return new Date(new Date(T0).getTime() + offsetSeconds * 1000).toISOString();
}

describe("formatDuration", () => {
  test("returns empty string when start is null", () => {
    expect(formatDuration(null, ts(60))).toBe("");
  });

  test("returns 0s for zero-second range", () => {
    expect(formatDuration(T0, T0)).toBe("0s");
  });

  test("returns seconds under one minute", () => {
    expect(formatDuration(T0, ts(45))).toBe("45s");
  });

  test("returns minutes and seconds at exactly 60s", () => {
    expect(formatDuration(T0, ts(60))).toBe("1m 0s");
  });

  test("returns minutes and seconds for 90s", () => {
    expect(formatDuration(T0, ts(90))).toBe("1m 30s");
  });

  test("returns minutes and seconds below one hour", () => {
    expect(formatDuration(T0, ts(3599))).toBe("59m 59s");
  });

  test("returns hours and minutes at exactly 1h", () => {
    expect(formatDuration(T0, ts(3600))).toBe("1h 0m");
  });

  test("returns hours and minutes for 2h 5m", () => {
    expect(formatDuration(T0, ts(7500))).toBe("2h 5m");
  });

  test("handles Postgres timestamp format (no Z) as UTC", () => {
    const pgStart = "2026-01-01 00:00:00";
    const pgEnd   = "2026-01-01 00:01:30";
    expect(formatDuration(pgStart, pgEnd)).toBe("1m 30s");
  });

  test("does not throw when end is null (uses current time)", () => {
    expect(() => formatDuration(T0, null)).not.toThrow();
  });
});

describe("statusLabel", () => {
  test("cleaned_up → archived", () => {
    expect(statusLabel("cleaned_up")).toBe("archived");
  });

  test("step_done → step done (underscore to space)", () => {
    expect(statusLabel("step_done")).toBe("step done");
  });

  test("running → running", () => {
    expect(statusLabel("running")).toBe("running");
  });

  test("failed → failed", () => {
    expect(statusLabel("failed")).toBe("failed");
  });

  test("starting → starting", () => {
    expect(statusLabel("starting")).toBe("starting");
  });
});

describe("statusSortOrder", () => {
  test("running sorts before starting", () => {
    expect(statusSortOrder("running")).toBeLessThan(statusSortOrder("starting"));
  });

  test("starting sorts before step_done", () => {
    expect(statusSortOrder("starting")).toBeLessThan(statusSortOrder("step_done"));
  });

  test("step_done sorts before stopped", () => {
    expect(statusSortOrder("step_done")).toBeLessThan(statusSortOrder("stopped"));
  });

  test("stopped sorts before failed", () => {
    expect(statusSortOrder("stopped")).toBeLessThan(statusSortOrder("failed"));
  });

  test("failed sorts before cleaned_up", () => {
    expect(statusSortOrder("failed")).toBeLessThan(statusSortOrder("cleaned_up"));
  });

  test("unknown status sorts last", () => {
    const known = ["running", "starting", "step_done", "stopped", "failed", "cleaned_up"];
    const lastKnown = Math.max(...known.map(statusSortOrder));
    expect(statusSortOrder("unknown_status")).toBeGreaterThan(lastKnown);
  });

  test("all known statuses return unique values", () => {
    const statuses = ["running", "starting", "step_done", "stopped", "failed", "cleaned_up"];
    const orders = statuses.map(statusSortOrder);
    expect(new Set(orders).size).toBe(statuses.length);
  });
});
