import { describe, expect, it } from "vitest";
import { parseOutboxAlert } from "../notification-outbox.server";

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
