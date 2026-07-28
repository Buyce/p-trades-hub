import type { GateCode, GateResult } from "./types";

/**
 * Hard rejection gates. Each gate returns a stored, human-readable reason so the
 * dashboard can display exactly why a setup passed or failed. No gate is optional.
 */

export function gate(
  code: GateCode,
  passed: boolean,
  reason: string,
  detail?: Record<string, unknown>,
): GateResult {
  return { code, passed, reason, detail };
}

export function missingData(ok: boolean, detail: Record<string, unknown>): GateResult {
  return gate(
    "MISSING_DATA",
    ok,
    ok ? "All required timeframes returned closed candles." : "Required candle data is missing.",
    detail,
  );
}

export function staleData(ageSeconds: number | null, maxAge: number): GateResult {
  const ok = ageSeconds !== null && ageSeconds <= maxAge;
  return gate(
    "STALE_DATA",
    ok,
    ok
      ? `Latest closed candle is ${Math.round(ageSeconds!)}s old (limit ${maxAge}s).`
      : ageSeconds === null
        ? "No closed candle available."
        : `Data is stale: ${Math.round(ageSeconds)}s old, limit ${maxAge}s.`,
    { ageSeconds, maxAge },
  );
}

export function spreadGate(
  spread: number | null,
  atrValue: number | null,
  maxRatio: number,
  maxAbsolute: number | null,
): GateResult {
  if (spread === null) {
    return gate("SPREAD", false, "Spread is unavailable, so the setup cannot be validated.", {});
  }
  if (maxAbsolute !== null && spread > maxAbsolute) {
    return gate("SPREAD", false, `Spread ${spread} exceeds the instrument limit ${maxAbsolute}.`, {
      spread,
      maxAbsolute,
    });
  }
  if (!atrValue || atrValue <= 0) {
    return gate("SPREAD", false, "ATR unavailable, so spread cannot be assessed.", { spread });
  }
  const ratio = spread / atrValue;
  const ok = ratio <= maxRatio;
  return gate(
    "SPREAD",
    ok,
    ok
      ? `Spread is ${(ratio * 100).toFixed(1)}% of ATR (limit ${(maxRatio * 100).toFixed(0)}%).`
      : `Spread is ${(ratio * 100).toFixed(1)}% of ATR, above the ${(maxRatio * 100).toFixed(0)}% limit.`,
    { spread, atr: atrValue, ratio, maxRatio },
  );
}

export function newsLockout(locked: boolean, titles: string[]): GateResult {
  return gate(
    "NEWS_LOCKOUT",
    !locked,
    locked
      ? `Inside a macro lockout window: ${titles.join(", ")}.`
      : "No active high-impact macro lockout.",
    { titles },
  );
}

export function biasConflict(bias: string, direction: string): GateResult {
  const ok = bias === direction;
  return gate(
    "BIAS_CONFLICT",
    ok,
    ok
      ? `Higher-timeframe bias (${bias}) agrees with the ${direction} setup.`
      : `Higher-timeframe bias is ${bias}, which does not support a ${direction} setup.`,
    { bias, direction },
  );
}

export function invalidStop(
  entry: number | null,
  stop: number | null,
  direction: "LONG" | "SHORT",
  atrValue: number | null,
  maxStopAtrMultiple: number,
): GateResult {
  if (entry === null || stop === null) {
    return gate("INVALID_STOP", false, "Entry or stop could not be derived from structure.", {});
  }
  const correctSide = direction === "LONG" ? stop < entry : stop > entry;
  if (!correctSide) {
    return gate("INVALID_STOP", false, `Stop is on the wrong side of entry for a ${direction}.`, {
      entry,
      stop,
    });
  }
  const distance = Math.abs(entry - stop);
  if (distance <= 0) {
    return gate("INVALID_STOP", false, "Stop distance is zero.", { entry, stop });
  }
  if (atrValue && distance > atrValue * maxStopAtrMultiple) {
    return gate(
      "INVALID_STOP",
      false,
      `Stop distance exceeds ${maxStopAtrMultiple}x ATR, so risk is undefinable.`,
      { distance, atr: atrValue, maxStopAtrMultiple },
    );
  }
  return gate("INVALID_STOP", true, "Stop sits beyond structure with a measurable risk distance.", {
    entry,
    stop,
    distance,
  });
}

export function rrGate(rr: number | null, minRr: number): GateResult {
  const ok = rr !== null && rr >= minRr;
  return gate(
    "RR_BELOW_MIN",
    ok,
    ok
      ? `Reward-to-risk to TP1 is ${rr!.toFixed(2)} (minimum ${minRr.toFixed(2)}).`
      : rr === null
        ? "Reward-to-risk could not be computed."
        : `Reward-to-risk to TP1 is ${rr.toFixed(2)}, below the ${minRr.toFixed(2)} minimum.`,
    { rr, minRr },
  );
}

export function lateEntry(late: boolean, distanceAtr: number | null): GateResult {
  return gate(
    "LATE_ENTRY",
    !late,
    late
      ? `Price has already run ${distanceAtr?.toFixed(2)} ATR beyond the entry zone.`
      : "Price is still within an actionable distance of the entry zone.",
    { distanceAtr },
  );
}

export function duplicate(isDuplicate: boolean, fingerprint: string | null): GateResult {
  return gate(
    "DUPLICATE",
    !isDuplicate,
    isDuplicate
      ? "An identical setup was already recorded for this UTC day."
      : "No identical setup recorded today.",
    { fingerprint },
  );
}

export function dailyCap(count: number, max: number): GateResult {
  const ok = count < max;
  return gate(
    "DAILY_CAP",
    ok,
    ok
      ? `${count}/${max} actionable alerts used today.`
      : `Daily cap reached: ${count}/${max} actionable alerts already issued.`,
    { count, max },
  );
}

export function allPassed(gates: GateResult[]): boolean {
  return gates.every((g) => g.passed);
}

export function failedGates(gates: GateResult[]): GateResult[] {
  return gates.filter((g) => !g.passed);
}

export function sessionGate(session: string, allowed: string[] | null | undefined): GateResult {
  const list = allowed && allowed.length > 0 ? allowed : null;
  const ok = session !== "CLOSED" && (!list || list.includes(session));
  return gate(
    "SESSION",
    ok,
    session === "CLOSED"
      ? "The market is closed for the week."
      : ok
        ? `Inside an allowed session (${session}).`
        : `Current session ${session} is outside the allowed sessions (${list?.join(", ")}).`,
    { session, allowed: list },
  );
}

export function candleSanity(ok: boolean, problems: string[]): GateResult {
  return gate(
    "CANDLE_SANITY",
    ok,
    ok
      ? "Candle data passed integrity checks."
      : `Broker candle data failed integrity checks: ${problems.join(" ")}`,
    { problems },
  );
}

export function expiry(
  triggerTime: string | null,
  maxAgeMinutes: number,
  now = Date.now(),
): GateResult {
  if (!triggerTime) {
    return gate("EXPIRED", false, "The setup has no confirmed trigger candle time.", {});
  }
  const ageMinutes = (now - Date.parse(triggerTime)) / 60_000;
  const ok = Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= maxAgeMinutes;
  return gate(
    "EXPIRED",
    ok,
    ok
      ? `Setup confirmed ${Math.round(ageMinutes)} minutes ago (valid for ${maxAgeMinutes}).`
      : `Setup expired: confirmed ${Math.round(ageMinutes)} minutes ago, limit ${maxAgeMinutes}.`,
    { triggerTime, ageMinutes, maxAgeMinutes },
  );
}

export function noSetup(found: boolean, setupType: string, detail: Record<string, unknown>): GateResult {
  return gate(
    "NO_SETUP",
    found,
    found
      ? `A ${setupType} setup was detected on the entry timeframe.`
      : "No setup family completed on the entry timeframe.",
    detail,
  );
}

/* ------------------------------------------------------------------ *
 * Precision-entry gates. These only ever run on the execution stage:  *
 * a setup that fails one of them stays armed, it is not rejected.     *
 * ------------------------------------------------------------------ */

export function microTrigger(confirmed: boolean, failures: string[]): GateResult {
  return gate(
    "NO_MICRO_TRIGGER",
    confirmed,
    confirmed
      ? "Closed M1 rejection, displacement and break of structure all completed."
      : failures[0] ?? "The M1 microstructure trigger has not completed.",
    { failures },
  );
}

export function microRetest(found: boolean, level: number | null): GateResult {
  return gate(
    "NO_MICRO_RETEST",
    found,
    found
      ? `The broken M1 level ${level} was retested and held on a closed candle.`
      : "The broken M1 level has not been retested and held.",
    { level },
  );
}

export function nearEntry(
  near: boolean,
  distancePoints: number | null,
  proximityPoints: number,
): GateResult {
  return gate(
    "NOT_NEAR_ENTRY",
    near,
    near
      ? `Price is ${distancePoints?.toFixed(1)} points from the preferred entry (limit ${proximityPoints}).`
      : `Price is ${distancePoints?.toFixed(1)} points from the preferred entry, beyond the ${proximityPoints}-point limit.`,
    { distancePoints, proximityPoints },
  );
}

export function extensionGate(extensionR: number, maxExtensionR: number): GateResult {
  const ok = Number.isFinite(extensionR) && extensionR <= maxExtensionR;
  return gate(
    "LATE_ENTRY",
    ok,
    ok
      ? `Price has run ${extensionR.toFixed(3)}R past the planned entry (limit ${maxExtensionR}R).`
      : `Too late: price has already run ${
          Number.isFinite(extensionR) ? extensionR.toFixed(3) : "an undefinable amount"
        }R past the planned entry (limit ${maxExtensionR}R).`,
    { extensionR, maxExtensionR },
  );
}

export function invalidationGate(present: boolean, condition: string | null): GateResult {
  return gate(
    "MISSING_INVALIDATION",
    present,
    present
      ? `Structural invalidation: ${condition}.`
      : "Missing structural invalidation, so the setup cannot be armed.",
    { condition },
  );
}

export function targetTouched(touched: boolean, target: number | null): GateResult {
  return gate(
    "TARGET_TOUCHED",
    !touched,
    touched
      ? `TP1 at ${target} was already reached before an entry existed.`
      : "TP1 has not been reached yet.",
    { target },
  );
}
