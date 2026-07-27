import type { Bias } from "./types";

/**
 * Macro / news engine. A high-impact event only locks the instruments whose
 * currencies it actually touches — a US CPI print does not silence GBPAUD.
 * Pure matching logic lives here so it is testable without a database.
 */

export type MacroEvent = {
  title: string;
  currency: string | null;
  impact: string;
  event_time_utc: string;
  lockout_start_utc: string | null;
  lockout_end_utc: string | null;
  symbols: string[] | null;
};

export type MacroContext = {
  locked: boolean;
  events: Array<{ title: string; currency: string | null; window: [string, string] }>;
  upcoming: Array<{ title: string; currency: string | null; minutesAway: number }>;
  /** True when no relevant high-impact event sits inside the lookahead window. */
  aligned: boolean;
};

export function currenciesFor(
  symbol: string,
  base: string | null,
  quote: string | null,
): string[] {
  const derived = [base, quote].filter((c): c is string => Boolean(c));
  if (derived.length > 0) return derived.map((c) => c.toUpperCase());
  const clean = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (clean.length >= 6) return [clean.slice(0, 3), clean.slice(3, 6)];
  return [];
}

function windowFor(event: MacroEvent): [number, number] {
  const at = Date.parse(event.event_time_utc);
  const start = event.lockout_start_utc ? Date.parse(event.lockout_start_utc) : at - 15 * 60_000;
  const end = event.lockout_end_utc ? Date.parse(event.lockout_end_utc) : at + 15 * 60_000;
  return [start, end];
}

export function affectsSymbol(
  event: MacroEvent,
  symbol: string,
  currencies: string[],
): boolean {
  if (event.symbols && event.symbols.length > 0) {
    return event.symbols.map((s) => s.toUpperCase()).includes(symbol.toUpperCase());
  }
  if (!event.currency) return true; // Unscoped events are treated as global.
  return currencies.includes(event.currency.toUpperCase());
}

/**
 * Builds the macro context for one instrument.
 * `lookaheadMinutes` controls the "clear runway" check used for scoring.
 */
export function macroContextFor(
  events: MacroEvent[],
  symbol: string,
  currencies: string[],
  now = Date.now(),
  lookaheadMinutes = 60,
): MacroContext {
  const relevant = events.filter(
    (e) => e.impact?.toUpperCase() === "HIGH" && affectsSymbol(e, symbol, currencies),
  );

  const active: MacroContext["events"] = [];
  const upcoming: MacroContext["upcoming"] = [];

  for (const event of relevant) {
    const [start, end] = windowFor(event);
    if (now >= start && now <= end) {
      active.push({
        title: event.title,
        currency: event.currency,
        window: [new Date(start).toISOString(), new Date(end).toISOString()],
      });
      continue;
    }
    const minutesAway = (Date.parse(event.event_time_utc) - now) / 60_000;
    if (minutesAway > 0 && minutesAway <= lookaheadMinutes) {
      upcoming.push({ title: event.title, currency: event.currency, minutesAway });
    }
  }

  return {
    locked: active.length > 0,
    events: active,
    upcoming,
    aligned: active.length === 0 && upcoming.length === 0,
  };
}

/** Placeholder kept for type-compat with the scoring input. */
export type MacroBias = Bias;
