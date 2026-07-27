import { getSymbolSpec, listSymbols } from "./metaapi.server";

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
};

const cache = new Map<string, ResolvedSymbol>();

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
  if (cached) return cached;

  const candidates: Array<[string, ResolvedSymbol["resolvedFrom"]]> = [];
  if (instrument.broker_symbol) candidates.push([instrument.broker_symbol, "broker_symbol"]);
  for (const alias of instrument.aliases ?? []) candidates.push([alias, "alias"]);
  candidates.push([instrument.symbol, "canonical"]);

  for (const [name, from] of candidates) {
    try {
      const spec = await getSymbolSpec(name);
      const resolved: ResolvedSymbol = {
        canonical: instrument.symbol,
        broker: name,
        digits: instrument.digits ?? (spec as { digits?: number }).digits ?? null,
        pointSize: instrument.point_size ?? null,
        resolvedFrom: from,
      };
      cache.set(instrument.symbol, resolved);
      return resolved;
    } catch {
      // Try the next candidate — an unknown symbol is not an error yet.
    }
  }

  const symbols = await listSymbols().catch(() => [] as string[]);
  const match = matchBrokerSymbol(instrument.symbol, symbols);
  const resolved: ResolvedSymbol = {
    canonical: instrument.symbol,
    broker: match ?? instrument.broker_symbol ?? instrument.symbol,
    digits: instrument.digits ?? null,
    pointSize: instrument.point_size ?? null,
    resolvedFrom: match ? "broker_list" : "canonical",
  };
  cache.set(instrument.symbol, resolved);
  return resolved;
}
