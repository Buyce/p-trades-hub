import { describe, expect, it } from "vitest";
import { checkCandleSanity } from "../sanity.server";
import { candle, flat } from "./fixtures";

const M15 = 15 * 60_000;

describe("checkCandleSanity", () => {
  it("accepts a clean, evenly spaced series", () => {
    const result = checkCandleSanity(flat(20, 100, 0, M15), "M15");
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("rejects an empty series", () => {
    expect(checkCandleSanity([], "M15").ok).toBe(false);
  });

  it("rejects a high below the body", () => {
    const bad = [
      ...flat(3, 100, 0, M15),
      candle(3, { open: 100, high: 99, low: 98, close: 100.5 }, M15),
    ];
    const result = checkCandleSanity(bad, "M15");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/High below/);
  });

  it("rejects non-positive prices", () => {
    const bad = [...flat(3, 100, 0, M15), candle(3, { open: 0, high: 0, low: 0, close: 0 }, M15)];
    expect(checkCandleSanity(bad, "M15").ok).toBe(false);
  });

  it("rejects duplicate timestamps", () => {
    const series = flat(3, 100, 0, M15);
    const dup = [...series, { ...series[2] }];
    const result = checkCandleSanity(dup, "M15");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/Duplicate/);
  });

  it("rejects a gap larger than the allowed multiple", () => {
    const series = [...flat(3, 100, 0, M15), candle(20, { open: 100, high: 101, low: 99, close: 100 }, M15)];
    const result = checkCandleSanity(series, "M15", 60, 6);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/gap/);
  });
});
