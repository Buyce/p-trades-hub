/**
 * The single market-data boundary for P-Trades.
 *
 * SAFETY CONTRACT — do not weaken:
 *  - `ReadOnlyMarketDataClient` exposes reads only. There is no method here to
 *    place, modify, close or cancel anything, and none may ever be added.
 *  - `metaapi.server.ts` is the transport and is imported by this module only.
 *    No raw provider response, SDK object or error escapes this file: every
 *    method returns a plain, frozen DTO and every failure is a `MarketDataError`
 *    with credentials redacted.
 *  - Every call is bounded by a timeout and only *safe reads* are retried.
 */

import { AppError, redact, type AppErrorCode } from "../errors";
import type { Candle, Timeframe } from "./types";

export type MarketDataAccount = {
  accountId: string;
  configuredAccountId: string;
  region: string;
  state: string | null;
  connectionStatus: string | null;
  name: string | null;
  /** Broker login identifier only — never a password. */
  login: string | null;
  server: string | null;
  reliability: string | null;
  lookupError: string | null;
  accountIdMismatch: boolean;
};

export type MarketDataSymbolSpec = {
  symbol: string;
  digits: number | null;
  tickSize: number | null;
};

/**
 * The complete surface the scanner is allowed to use. Read-only by
 * construction: adding a write method here is a breach of the product mandate.
 */
export type ReadOnlyMarketDataClient = {
  readonly kind: string;
  isConfigured(): boolean;
  getAccount(force?: boolean): Promise<MarketDataAccount>;
  getCandles(symbol: string, timeframe: Timeframe, limit?: number): Promise<Candle[]>;
  getSpread(symbol: string): Promise<number | null>;
  getSymbolSpec(symbol: string): Promise<MarketDataSymbolSpec | null>;
  listSymbols(): Promise<string[]>;
};

/** Every method name the client is permitted to expose. Asserted by test. */
export const READ_ONLY_METHODS = [
  "isConfigured",
  "getAccount",
  "getCandles",
  "getSpread",
  "getSymbolSpec",
  "listSymbols",
] as const;

export class MarketDataError extends AppError {
  constructor(message: string, code: AppErrorCode = "UPSTREAM", detail?: Record<string, unknown>) {
    super(code, message, detail);
    this.name = "MarketDataError";
  }
}

export class MarketDataNotConfiguredError extends MarketDataError {
  constructor(message: string) {
    super(message, "CONFIG");
    this.name = "MarketDataNotConfiguredError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function fail(operation: string, error: unknown): never {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("not configured")) throw new MarketDataNotConfiguredError(redact(raw));
  throw new MarketDataError(`${operation} failed: ${redact(raw)}`, "UPSTREAM", { operation });
}

async function withTimeout<T>(operation: string, task: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new MarketDataError(`${operation} timed out after ${ms}ms`, "TIMEOUT")),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Maps a provider candle to the contract shape. Anything unparseable becomes
 * NaN/invalid here and is dropped downstream by `normaliseCandles` — this layer
 * never repairs or invents a price.
 */
function toCandle(raw: unknown): Candle {
  const c = (raw ?? {}) as Record<string, unknown>;
  return Object.freeze({
    time: typeof c.time === "string" ? c.time : String(c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: num(c.volume),
  });
}

/**
 * MetaApi-backed implementation. The provider module is imported lazily so that
 * nothing about the transport (or its env reads) is pulled in until a read is
 * actually performed.
 */
export function createMetaApiMarketData(
  options: { timeoutMs?: number } = {},
): ReadOnlyMarketDataClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const provider = () => import("./metaapi.server");

  return Object.freeze({
    kind: "metaapi",

    isConfigured() {
      return Boolean(process.env.METAAPI_TOKEN && process.env.METAAPI_ACCOUNT_ID);
    },

    async getAccount(force = false) {
      return withTimeout(
        "getAccount",
        async () => {
          try {
            const info = await (await provider()).getAccountInfo(force);
            return Object.freeze({
              accountId: info.accountId,
              configuredAccountId: info.configuredAccountId,
              region: info.region,
              state: str(info.state),
              connectionStatus: str(info.connectionStatus),
              name: str(info.name),
              login: info.login == null ? null : String(info.login),
              server: str(info.server),
              reliability: str(info.reliability),
              lookupError: info.lookupError ? redact(info.lookupError) : null,
              accountIdMismatch: Boolean(info.accountIdMismatch),
            });
          } catch (error) {
            return fail("getAccount", error);
          }
        },
        timeoutMs,
      );
    },

    async getCandles(symbol, timeframe, limit = 200) {
      return withTimeout(
        "getCandles",
        async () => {
          try {
            const raw = await (await provider()).getCandles(symbol, timeframe, limit);
            return (Array.isArray(raw) ? raw : []).map(toCandle);
          } catch (error) {
            return fail(`getCandles(${symbol}/${timeframe})`, error);
          }
        },
        timeoutMs,
      );
    },

    async getSpread(symbol) {
      return withTimeout(
        "getSpread",
        async () => {
          try {
            return num(await (await provider()).getCurrentSpread(symbol));
          } catch (error) {
            return fail(`getSpread(${symbol})`, error);
          }
        },
        timeoutMs,
      );
    },

    async getSymbolSpec(symbol) {
      return withTimeout(
        "getSymbolSpec",
        async () => {
          try {
            const spec = await (await provider()).getSymbolSpec(symbol);
            if (!spec) return null;
            return Object.freeze({
              symbol: str(spec.symbol) ?? symbol,
              digits: num(spec.digits),
              tickSize: num(spec.tickSize),
            });
          } catch (error) {
            return fail(`getSymbolSpec(${symbol})`, error);
          }
        },
        timeoutMs,
      );
    },

    async listSymbols() {
      return withTimeout(
        "listSymbols",
        async () => {
          try {
            const symbols = await (await provider()).listSymbols();
            return Array.isArray(symbols) ? symbols.filter((s) => typeof s === "string") : [];
          } catch (error) {
            return fail("listSymbols", error);
          }
        },
        timeoutMs,
      );
    },
  });
}

let singleton: ReadOnlyMarketDataClient | null = null;

/** The client the scanner uses. One instance per worker. */
export function marketData(): ReadOnlyMarketDataClient {
  singleton ??= createMetaApiMarketData();
  return singleton;
}
