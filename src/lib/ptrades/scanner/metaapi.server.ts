/**
 * Read-only MetaApi Cloud client.
 *
 * SAFETY CONTRACT — do not weaken:
 *  - GET requests only. Any other method throws before a request is made.
 *  - Only the paths in READ_ONLY_PATHS may be requested.
 *  - No trade, order or position endpoint exists in this module or anywhere else
 *    in this codebase. P-Trades never places, modifies or closes a trade.
 *  - Secrets are read from process.env inside functions and never returned.
 */

import type { Candle, Timeframe } from "./types";

const READ_ONLY_PATHS: RegExp[] = [
  /^\/users\/current\/accounts\/[^/]+$/,
  /^\/users\/current\/accounts\/[^/]+\/historical-market-data\/symbols\/[^/]+\/timeframes\/[^/]+\/candles$/,
  /^\/users\/current\/accounts\/[^/]+\/symbols\/[^/]+\/specification$/,
  /^\/users\/current\/accounts\/[^/]+\/symbols\/[^/]+\/current-price$/,
  /^\/users\/current\/accounts\/[^/]+\/symbols$/,
];

const PROVISIONING_HOST = "mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";


export class MetaApiNotConfiguredError extends Error {}
export class MetaApiRequestError extends Error {}

type Env = { token: string; accountId: string; region: string };

function env(): Env {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || "new-york";
  if (!token || !accountId) {
    throw new MetaApiNotConfiguredError(
      "MetaApi is not configured. METAAPI_TOKEN and METAAPI_ACCOUNT_ID are required.",
    );
  }
  return { token, accountId, region };
}

export function isMetaApiConfigured(): boolean {
  return Boolean(process.env.METAAPI_TOKEN && process.env.METAAPI_ACCOUNT_ID);
}

function assertReadOnly(path: string) {
  if (!READ_ONLY_PATHS.some((allowed) => allowed.test(path))) {
    throw new MetaApiRequestError(
      `Blocked non read-only MetaApi path: ${path}. P-Trades is a read-only assistant.`,
    );
  }
}

async function get<T>(host: string, path: string, query: Record<string, string> = {}): Promise<T> {
  assertReadOnly(path);
  const { token } = env();
  const url = new URL(`https://${host}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    method: "GET",
    headers: { "auth-token": token, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new MetaApiRequestError(`MetaApi ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

function marketDataHost(region: string) {
  return `mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
}

function clientHost(region: string) {
  return `mt-client-api-v1.${region}.agiliumtrade.ai`;
}

type RawCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  volume?: number;
};

/** Historical candles, newest last. The caller drops any still-forming candle. */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
): Promise<Candle[]> {
  const { accountId, region } = env();
  const path = `/users/current/accounts/${accountId}/historical-market-data/symbols/${encodeURIComponent(
    symbol,
  )}/timeframes/${timeframe}/candles`;
  const raw = await get<RawCandle[]>(marketDataHost(region), path, { limit: String(limit) });
  return raw.map((c) => ({
    time: new Date(c.time).toISOString(),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.tickVolume ?? c.volume ?? null,
  }));
}

export type SymbolSpec = {
  symbol: string;
  digits?: number;
  minVolume?: number;
  tickSize?: number;
};

export async function getSymbolSpec(symbol: string): Promise<SymbolSpec> {
  const { accountId, region } = env();
  const path = `/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/specification`;
  return get<SymbolSpec>(clientHost(region), path);
}

export async function getCurrentSpread(symbol: string): Promise<number | null> {
  const { accountId, region } = env();
  const path = `/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/current-price`;
  const price = await get<{ bid?: number; ask?: number }>(clientHost(region), path, {
    keepSubscription: "false",
  });
  if (typeof price.bid !== "number" || typeof price.ask !== "number") return null;
  return price.ask - price.bid;
}

/** Symbol discovery, used to resolve the NAS100 broker symbol. Read-only. */
export async function listSymbols(): Promise<string[]> {
  const { accountId, region } = env();
  const path = `/users/current/accounts/${accountId}/symbols`;
  const symbols = await get<string[]>(clientHost(region), path);
  return Array.isArray(symbols) ? symbols : [];
}
