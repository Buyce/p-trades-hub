import { describe, expect, it } from "vitest";
import { isMarketClosed, isSessionAllowed, sessionAt } from "../sessions.server";

const at = (iso: string) => new Date(iso);

describe("sessionAt", () => {
  it("maps UTC hours to the correct session", () => {
    expect(sessionAt(at("2026-07-22T02:00:00Z"))).toBe("ASIA");
    expect(sessionAt(at("2026-07-22T08:00:00Z"))).toBe("LONDON");
    expect(sessionAt(at("2026-07-22T15:00:00Z"))).toBe("NEWYORK");
    expect(sessionAt(at("2026-07-22T22:00:00Z"))).toBe("OFF_SESSION");
  });

  it("treats the weekend as closed", () => {
    expect(isMarketClosed(at("2026-07-25T22:00:00Z"))).toBe(true); // Friday late
    expect(isMarketClosed(at("2026-07-26T12:00:00Z"))).toBe(true); // Saturday
    expect(isMarketClosed(at("2026-07-27T10:00:00Z"))).toBe(false); // Monday
    expect(sessionAt(at("2026-07-26T12:00:00Z"))).toBe("CLOSED");
  });
});

describe("isSessionAllowed", () => {
  it("rejects a closed market regardless of the allow-list", () => {
    expect(isSessionAllowed("CLOSED", ["LONDON"])).toBe(false);
    expect(isSessionAllowed("CLOSED", [])).toBe(false);
  });

  it("honours the instrument allow-list", () => {
    expect(isSessionAllowed("LONDON", ["LONDON", "NEWYORK"])).toBe(true);
    expect(isSessionAllowed("ASIA", ["LONDON", "NEWYORK"])).toBe(false);
  });

  it("permits every open session when no list is configured", () => {
    expect(isSessionAllowed("ASIA", [])).toBe(true);
    expect(isSessionAllowed("OFF_SESSION", null)).toBe(true);
  });
});
