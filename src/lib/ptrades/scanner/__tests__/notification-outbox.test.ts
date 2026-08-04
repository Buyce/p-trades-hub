import { describe, expect, it } from "vitest";
import { outboxHeartbeatStatus, parseOutboxAlert } from "../notification-outbox.server";

describe("notification outbox payload", () => {
  it("reconstructs the exact actionable alert written by the database trigger", () => {
    expect(
      parseOutboxAlert({
        shadowMode: false,
        signalId: "0b43b4b1-243b-47b8-af20-8fa3ac814a88",
        instrument: "EURUSD",
        direction: "SHORT",
        grade: "A",
        setupType: "BREAK_RETEST",
        timeframe: "M1",
        entryZoneLow: 1.13621,
        entryZoneHigh: 1.13637,
        stopLoss: 1.13741,
        targets: [1.13405, 1.13293],
        rr: 2,
        score: 91.61,
        reasons: ["Closed M1 trigger and retest confirmed."],
      }),
    ).toMatchObject({
      shadowMode: false,
      instrument: "EURUSD",
      direction: "SHORT",
      grade: "A",
      targets: [1.13405, 1.13293],
      rr: 2,
    });
  });

  it("fails closed when a durable event is malformed", () => {
    expect(() => parseOutboxAlert({ signalId: "id-without-an-instrument" })).toThrow("instrument");
  });
});

describe("notification outbox health", () => {
  const summary = (overrides: Partial<Parameters<typeof outboxHeartbeatStatus>[0]> = {}) => ({
    claimed: 0,
    sent: 0,
    retried: 0,
    deadLetter: 0,
    errors: [],
    ...overrides,
  });

  it("is idle when there is no delivery work", () => {
    expect(outboxHeartbeatStatus(summary())).toBe("IDLE");
  });

  it("is healthy after a successful delivery", () => {
    expect(outboxHeartbeatStatus(summary({ claimed: 1, sent: 1 }))).toBe("OK");
  });

  it("surfaces retryable channel failures without poisoning precision", () => {
    expect(
      outboxHeartbeatStatus(
        summary({ claimed: 1, retried: 1, errors: ["signal: email transport missing"] }),
      ),
    ).toBe("DEGRADED");
  });

  it("is degraded when a configured channel is structurally unavailable", () => {
    expect(outboxHeartbeatStatus(summary(), 1)).toBe("DEGRADED");
  });

  it("surfaces dead-letter events as a hard delivery error", () => {
    expect(outboxHeartbeatStatus(summary({ claimed: 1, deadLetter: 1 }))).toBe("ERROR");
  });
});
