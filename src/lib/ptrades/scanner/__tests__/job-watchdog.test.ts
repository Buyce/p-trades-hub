import { describe, expect, it } from "vitest";
import {
  ERROR_STREAK_LIMIT,
  SKIP_STREAK_LIMIT,
  evaluateJobProgress,
  type HeartbeatRow,
  type LockRow,
} from "../job-watchdog.server";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

function ago(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

/** Healthy baseline: all three jobs completed a pass moments ago. */
function healthy(): HeartbeatRow[] {
  return [
    { source: "MARKET_DATA_SYNC", status: "OK", received_at: ago(0.5) },
    { source: "CONTEXT_SCANNER", status: "OK", received_at: ago(0.5) },
    { source: "PRECISION_SCANNER", status: "IDLE", received_at: ago(0.5) },
  ];
}

const noLocks: LockRow[] = [];

describe("scheduler progress watchdog", () => {
  it("raises nothing when every job is completing passes", () => {
    const report = evaluateJobProgress(healthy(), noLocks, NOW);
    expect(report.faults).toEqual([]);
    expect(report.jobs.every((j) => j.healthy)).toBe(true);
  });

  it("flags a job that stopped reporting entirely", () => {
    const beats = healthy().filter((b) => b.source !== "CONTEXT_SCANNER");
    const report = evaluateJobProgress(beats, noLocks, NOW);
    expect(report.faults.map((f) => f.code)).toContain("NO_HEARTBEAT");
    expect(report.faults[0]?.source).toBe("CONTEXT_SCANNER");
  });

  it("flags a timing-out job whose heartbeats are stale", () => {
    const beats: HeartbeatRow[] = [
      ...healthy().filter((b) => b.source !== "MARKET_DATA_SYNC"),
      { source: "MARKET_DATA_SYNC", status: "OK", received_at: ago(12) },
    ];
    const codes = evaluateJobProgress(beats, noLocks, NOW).faults.map((f) => f.code);
    expect(codes).toContain("NO_HEARTBEAT");
  });

  it("flags a wedged job that keeps skipping without ever completing", () => {
    const skips: HeartbeatRow[] = Array.from({ length: SKIP_STREAK_LIMIT }, (_, i) => ({
      source: "CONTEXT_SCANNER",
      status: "SKIPPED",
      received_at: ago(i * 1),
    }));
    const beats = [...skips, ...healthy().filter((b) => b.source !== "CONTEXT_SCANNER")];
    const report = evaluateJobProgress(beats, noLocks, NOW);
    const codes = report.faults.filter((f) => f.source === "CONTEXT_SCANNER").map((f) => f.code);
    // Fresh heartbeats, but no completed pass on record.
    expect(codes).toContain("NO_PROGRESS");
    expect(codes).toContain("SKIP_STREAK");
  });

  it("flags consecutive errors", () => {
    const errors: HeartbeatRow[] = Array.from({ length: ERROR_STREAK_LIMIT }, (_, i) => ({
      source: "PRECISION_SCANNER",
      status: "ERROR",
      received_at: ago(i * 1),
    }));
    const beats = [
      ...errors,
      { source: "PRECISION_SCANNER", status: "OK", received_at: ago(4) } as HeartbeatRow,
      ...healthy().filter((b) => b.source !== "PRECISION_SCANNER"),
    ];
    const codes = evaluateJobProgress(beats, noLocks, NOW)
      .faults.filter((f) => f.source === "PRECISION_SCANNER")
      .map((f) => f.code);
    expect(codes).toEqual(["ERROR_STREAK"]);
  });

  it("flags a lock whose lease lapsed and was never released", () => {
    const locks: LockRow[] = [
      { lock_key: "scan-precision", holder: "precision:abc", expires_at: ago(9) },
    ];
    const fault = evaluateJobProgress(healthy(), locks, NOW).faults.find(
      (f) => f.code === "LOCK_OVERRUN",
    );
    expect(fault?.source).toBe("PRECISION_SCANNER");
    expect(fault?.detail["holder"]).toBe("precision:abc");
  });

  it("ignores a live lock held by a running pass", () => {
    const locks: LockRow[] = [
      { lock_key: "scan-precision", holder: "precision:abc", expires_at: ago(-1) },
    ];
    expect(evaluateJobProgress(healthy(), locks, NOW).faults).toEqual([]);
  });
});
