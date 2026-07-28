import { describe, expect, it } from "vitest";
import { tierCopy, tierSubject } from "@/lib/email-templates/tier-alert-copy";

const base = { instrument: "XAUUSD", direction: "LONG", rrTp1: "2.10R" };

describe("tier alert email copy", () => {
  it("labels the tier first in the subject", () => {
    expect(tierSubject("A_PLUS", base)).toBe("Tier A+ · XAUUSD LONG — 2.10R to TP1");
    expect(tierSubject("B", base)).toBe("Tier B · XAUUSD LONG — 2.10R to TP1");
    expect(tierSubject("C", base)).toBe("Tier C · XAUUSD LONG — 2.10R to TP1");
  });

  it("gives B and C distinct body copy", () => {
    const b = tierCopy("B");
    const c = tierCopy("C");
    expect(b.banner).not.toBe(c.banner);
    expect(b.intro).not.toBe(c.intro);
    expect(b.note).not.toBe(c.note);
  });

  it("never invents a tier when none is stored", () => {
    expect(tierSubject(null, base)).toBe("Signal · XAUUSD LONG — 2.10R to TP1");
    expect(tierCopy(null).banner).toBe("UNLABELLED TIER");
  });
});
