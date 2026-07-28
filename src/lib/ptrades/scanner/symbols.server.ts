import { marketData } from "./market-data.server";

/**
 * Symbol mapping layer. The canonical instrument name used by P-Trades
 * (XAUUSD) is not always the broker's symbol (XAUUSD.m, GOLD, XAUUSDx).
 * Resolution order: stored broker_symbol -> stored aliases -> canonical name ->
 * a broker symbol list match. Resolved names are cached per worker invocation.
 */

export type InstrumentRow = {
  symbol: string;
  broker_symbol: string | null;
  aliases: string[] | null;
  digits: number | null;
  point_size: number | null;
  contract_size: number | null;
  base_currency: string | null;
  quote_currency: string | null;
  sessions: string[] | null;
  min_rr: number;
  max_spread: number | null;
  max_data_age_seconds: number | null;
};

export type ResolvedSymbol = {
  canonical: string;
  broker: string;
  digits: number | null;
  pointSize: number | null;
  resolvedFrom: "broker_symbol" | "alias" | "canonical" | "broker_list";
  /** Provider failures seen while resolving, so the caller can log them. */
  failures?: Array<{ candidate: string; message: string }>;
};

/**
 * Resolutions are cached, but never forever and never for a guess. A transient
 * provider error must not pin an instrument to a fallback symbol for the life
 * of the worker, so only a confirmed provider lookup is cached and every entry
 * expires.
 */
const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; resolved: ResolvedSymbol }>();


function normalise(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Picks the closest broker symbol for a canonical name from a symbol list. */
export function matchBrokerSymbol(canonical: string, symbols: string[]): string | null {
  const target = normalise(canonical);
  const exact = symbols.find((s) => normalise(s) === target);
  if (exact) return exact;
  const prefixed = symbols.filter((s) => normalise(s).startsWith(target));
  if (prefixed.length > 0) {
    // Shortest suffix wins: XAUUSD.m beats XAUUSD.micro.raw
    return prefixed.sort((a, b) => a.length - b.length)[0];
  }
  return null;
}

/** Round a price to the instrument's quoted precision. */
export function roundToDigits(value: number | null, digits: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (digits === null || digits < 0) return value;
  return Number(value.toFixed(digits));
}

export async function resolveSymbol(instrument: InstrumentRow): Promise<ResolvedSymbol> {
  const cached = cache.get(instrument.symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.resolved;

  const candidates: Array<[string, ResolvedSymbol["resolvedFrom"]]> = [];
  if (instrument.broker_symbol) candidates.push([instrument.broker_symbol, "broker_symbol"]);
  for (const alias of instrument.aliases ?? []) candidates.push([alias, "alias"]);
  candidates.push([instrument.symbol, "canonical"]);

  const failures: Array<{ candidate: string; message: string }> = [];

  for (const [name, from] of candidates) {
    try {
      const spec = await marketData().getSymbolSpec(name);
      const resolved: ResolvedSymbol = {
        canonical: instrument.symbol,
        broker: name,
        digits: instrument.digits ?? (spec as { digits?: number }).digits ?? null,
        pointSize: instrument.point_size ?? null,
        resolvedFrom: from,
      };
      // Only a confirmed provider lookup is cached.
      cache.set(instrument.symbol, { at: Date.now(), resolved });
      return resolved;
    } catch (error) {
      failures.push({
        candidate: name,
        message: error instanceof Error ? error.message : "symbol lookup failed",
      });
    }
  }

  const symbols = await marketData()
    .listSymbols()
    .catch((error: unknown) => {
      failures.push({
        candidate: "*",
        message: error instanceof Error ? error.message : "symbol list failed",
      });
      return [] as string[];
    });
  const match = matchBrokerSymbol(instrument.symbol, symbols);
  const resolved: ResolvedSymbol = {
    canonical: instrument.symbol,
    broker: match ?? instrument.broker_symbol ?? instrument.symbol,
    digits: instrument.digits ?? null,
    pointSize: instrument.point_size ?? null,
    resolvedFrom: match ? "broker_list" : "canonical",
    failures,
  };
  // A broker-list match is a real lookup and may be cached; a bare fallback to
  // the configured name is a guess and must be retried on the next scan.
  if (match) cache.set(instrument.symbol, { at: Date.now(), resolved });
  return resolved;
}

/** Test/maintenance helper: drops every cached resolution. */
export function clearSymbolCache(): void {
  cache.clear();
}

