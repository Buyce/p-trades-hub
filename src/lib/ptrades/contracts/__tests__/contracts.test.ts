import { describe, expect, it } from "vitest";
import {
  assertContract,
  checkContract,
  ContractViolationError,
  CONTRACT_SCHEMAS,
} from "../validate.server";

const candle = {
  time: "2026-07-27T10:00:00.000Z",
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 100,
};

describe("contract registry", () => {
  it("exposes every shared contract", () => {
    expect(Object.keys(CONTRACT_SCHEMAS).sort()).toEqual([
      "candidate",
      "candle",
      "macroEvent",
      "marketSnapshot",
      "rulebook",
      "scannerResult",
      "signal",
      "trade",
    ]);
  });
});

describe("candle contract", () => {
  it("accepts a closed candle", () => {
    expect(checkContract("candle", candle).valid).toBe(true);
  });

  it("rejects an unknown field", () => {
    expect(checkContract("candle", { ...candle, forming: true }).valid).toBe(false);
  });

  it("rejects a missing close", () => {
    const { close, ...rest } = candle;
    expect(checkContract("candle", rest).valid).toBe(false);
  });

  it("rejects a stringified price", () => {
    expect(checkContract("candle", { ...candle, open: "1" }).valid).toBe(false);
  });
});

describe("market snapshot contract", () => {
  it("accepts a snapshot referencing the candle contract", () => {
    const result = checkContract("marketSnapshot", {
      instrument: "XAUUSD",
      broker_symbol: "XAUUSD",
      fetched_at_utc: "2026-07-27T10:00:05.000Z",
      bid: 2400.1,
      ask: 2400.4,
      spread: 0.3,
      data_age_seconds: 5,
      candles: { M15: [candle], "4h": [candle] },
    });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an unsupported timeframe", () => {
    expect(
      checkContract("marketSnapshot", {
        instrument: "XAUUSD",
        fetched_at_utc: "2026-07-27T10:00:05.000Z",
        candles: { M30: [candle] },
      }).valid,
    ).toBe(false);
  });
});

describe("rulebook contract", () => {
  const rulebook = {
    version: "v1.2.0-shadow",
    closed_candles_only: true,
    min_rr_tp1: 2,
    max_daily_actionable: 2,
    grades: { A_PLUS: 95, A: 90, B: 80, C: 70 },
  };

  it("accepts the active rulebook shape", () => {
    expect(checkContract("rulebook", rulebook).valid).toBe(true);
  });

  it("accepts the raised daily cap and rejects anything above it", () => {
    expect(checkContract("rulebook", { ...rulebook, max_daily_actionable: 30 }).valid).toBe(true);
    expect(checkContract("rulebook", { ...rulebook, max_daily_actionable: 31 }).valid).toBe(
      false,
    );
  });

  it("rejects an unknown ATR method", () => {
    expect(checkContract("rulebook", { ...rulebook, atr_method: "EMA" }).valid).toBe(false);
  });
});

describe("candidate contract", () => {
  const candidate = {
    instrument: "EURUSD",
    direction: "LONG",
    setup_type: "SWEEP_DISPLACEMENT_RETEST",
    bias: "LONG",
    score: 91,
    grade: "A",
    gate_results: [{ code: "RR_BELOW_MIN", passed: true, reason: "R:R 2.4 at TP1" }],
    qualified: true,
  };

  it("accepts a scored candidate", () => {
    expect(checkContract("candidate", candidate).valid).toBe(true);
  });

  it("rejects a score above 100", () => {
    expect(checkContract("candidate", { ...candidate, score: 140 }).valid).toBe(false);
  });

  it("rejects an unknown gate code", () => {
    expect(
      checkContract("candidate", {
        ...candidate,
        gate_results: [{ code: "VIBES", passed: false, reason: "no" }],
      }).valid,
    ).toBe(false);
  });
});

describe("signal contract", () => {
  const signal = {
    instrument: "GBPUSD",
    direction: "SHORT",
    is_actionable: false,
    status: "ACTIVE",
    shadow_mode: true,
    targets: [1.24, 1.235],
  };

  it("accepts a shadow-mode signal", () => {
    expect(checkContract("signal", signal).valid).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(checkContract("signal", { ...signal, status: "FILLED" }).valid).toBe(false);
  });

  it("rejects any order or execution field", () => {
    expect(checkContract("signal", { ...signal, order_type: "MARKET" }).valid).toBe(false);
    expect(checkContract("signal", { ...signal, volume: 0.5 }).valid).toBe(false);
  });
});

describe("scanner result contract", () => {
  it("accepts a completed run summary", () => {
    expect(
      checkContract("scannerResult", {
        ok: true,
        started_at_utc: "2026-07-27T10:00:00.000Z",
        finished_at_utc: "2026-07-27T10:00:09.000Z",
        status: "OK",
        symbols_scanned: ["XAUUSD", "EURUSD"],
        candidates: 2,
        rejections: 8,
        alerts: 0,
        shadow_mode: true,
      }).valid,
    ).toBe(true);
  });

  it("rejects a negative alert count", () => {
    expect(
      checkContract("scannerResult", {
        ok: true,
        started_at_utc: "2026-07-27T10:00:00.000Z",
        symbols_scanned: [],
        candidates: 0,
        alerts: -1,
        shadow_mode: true,
      }).valid,
    ).toBe(false);
  });
});

describe("trade contract", () => {
  const trade = {
    instrument: "XAUUSD",
    direction: "LONG",
    status: "CLOSED",
    outcome: "WIN",
    planned_entry: 2400,
    actual_entry: 2401.2,
    planned_stop: 2394,
    actual_stop: 2394,
    partial_exits: [{ price: 2410, fraction: 0.5, at_utc: "2026-07-27T12:00:00.000Z" }],
    r_multiple: 1.8,
    followed_plan: false,
    mistake_tags: ["LATE_ENTRY"],
    mae_r: null,
    mfe_r: null,
  };

  it("accepts a journalled trade with planned vs actual", () => {
    expect(checkContract("trade", trade).valid).toBe(true);
  });

  it("rejects a partial exit fraction above 1", () => {
    expect(
      checkContract("trade", {
        ...trade,
        partial_exits: [{ price: 2410, fraction: 1.5, at_utc: "2026-07-27T12:00:00.000Z" }],
      }).valid,
    ).toBe(false);
  });
});

describe("assertContract", () => {
  it("returns the payload when valid", () => {
    expect(assertContract("candle", candle)).toEqual(candle);
  });

  it("throws a ContractViolationError when invalid", () => {
    expect(() => assertContract("candle", { time: "x" })).toThrow(ContractViolationError);
  });
});
