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
  /^\/users\/current\/accounts$/,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * MetaApi rate-limits concurrent historical market-data requests, so every
 * request in a scan is queued and issued one at a time with a short gap.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.then(
    () => sleep(120),
    () => sleep(120),
  );
  return next;
}

async function request<T>(host: string, path: string, query: Record<string, string>): Promise<T> {
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
    const error = new MetaApiRequestError(`MetaApi ${response.status}: ${body.slice(0, 300)}`);
    (error as MetaApiRequestError & { status?: number }).status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

async function get<T>(host: string, path: string, query: Record<string, string> = {}): Promise<T> {
  assertReadOnly(path);
  return serialize(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await request<T>(host, path, query);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        if (status !== 429) throw error;
        await sleep(600 * (attempt + 1));
      }
    }
    throw lastError;
  });
}


function marketDataHost(region: string) {
  return `mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;
}

function clientHost(region: string) {
  return `mt-client-api-v1.${region}.agiliumtrade.ai`;
}

export type AccountInfo = {
  /** The account id actually used for market-data requests. */
  accountId: string;
  /** The id configured in METAAPI_ACCOUNT_ID, whether or not it resolved. */
  configuredAccountId: string;
  region: string;
  state?: string;
  connectionStatus?: string;
  name?: string;
  /** Broker login (identifier only — never a password). */
  login?: string;
  server?: string;
  reliability?: string;
  lookupError?: string;
  /** True when the configured id failed and the token's sole account was used. */
  accountIdMismatch?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedAccount: { at: number; info: AccountInfo } | null = null;

type RawAccount = {
  _id?: string;
  id?: string;
  name?: string;
  region?: string;
  state?: string;
  connectionStatus?: string;
  login?: string;
  server?: string;
  reliability?: string;
};

/** Lists accounts visible to the token, so a wrong account id is easy to spot. */
export async function listAccounts(): Promise<RawAccount[]> {
  const raw = await get<RawAccount[]>(PROVISIONING_HOST, "/users/current/accounts");
  return Array.isArray(raw) ? raw : [];
}

/**
 * Resolves the account's real id and region from the provisioning API, so a
 * mismatched METAAPI_REGION or account id cannot silently break every request.
 * If the configured id is not found and the token exposes exactly one deployed
 * account, that account is used and the substitution is reported via
 * `accountIdMismatch` so it surfaces on Scanner Health. Read-only metadata
 * only — no credentials are read or returned.
 */
export async function getAccountInfo(force = false): Promise<AccountInfo> {
  const { accountId, region } = env();
  if (!force && cachedAccount && Date.now() - cachedAccount.at < 10 * 60_000) {
    return cachedAccount.info;
  }

  const looksLikeAccountId = UUID_RE.test(accountId);
  try {
    if (!looksLikeAccountId) {
      throw new MetaApiRequestError(
        `METAAPI_ACCOUNT_ID "${accountId}" is not a trading account id. ` +
          "MetaApi account ids are UUIDs (8-4-4-4-12); a 32-character hex string is usually the MetaApi user id.",
      );
    }
    const raw = await get<RawAccount>(PROVISIONING_HOST, `/users/current/accounts/${accountId}`);
    const info: AccountInfo = {
      accountId,
      configuredAccountId: accountId,
      region: raw.region || region,
      state: raw.state,
      connectionStatus: raw.connectionStatus,
      name: raw.name,
      login: raw.login,
      server: raw.server,
      reliability: raw.reliability,
    };
    cachedAccount = { at: Date.now(), info };
    return info;
  } catch (error) {
    const lookupError = error instanceof Error ? error.message : "account lookup failed";
    const deployed = await listAccounts()
      .then((accounts) => accounts.filter((a) => (a._id ?? a.id) && a.state === "DEPLOYED"))
      .catch(() => []);
    if (deployed.length === 1) {
      const only = deployed[0];
      const info: AccountInfo = {
        accountId: (only._id ?? only.id)!,
        configuredAccountId: accountId,
        region: only.region || region,
        state: only.state,
        connectionStatus: only.connectionStatus,
        name: only.name,
        login: only.login,
        server: only.server,
        reliability: only.reliability,
        lookupError,
        accountIdMismatch: true,
      };
      cachedAccount = { at: Date.now(), info };
      return info;
    }
    return { accountId, configuredAccountId: accountId, region, lookupError };
  }
}


async function account(): Promise<{ accountId: string; region: string }> {
  const info = await getAccountInfo();
  return { accountId: info.accountId, region: info.region };
}



/** MetaApi MT5 timeframe codes. */
const API_TIMEFRAME: Record<Timeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};

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
  const { accountId, region } = await account();
  const path = `/users/current/accounts/${accountId}/historical-market-data/symbols/${encodeURIComponent(
    symbol,
  )}/timeframes/${API_TIMEFRAME[timeframe]}/candles`;
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
  const { accountId, region } = await account();
  const path = `/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/specification`;
  return get<SymbolSpec>(clientHost(region), path);
}

export async function getCurrentSpread(symbol: string): Promise<number | null> {
  const { accountId, region } = await account();
  const path = `/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/current-price`;
  const price = await get<{ bid?: number; ask?: number }>(clientHost(region), path, {
    keepSubscription: "false",
  });
  if (typeof price.bid !== "number" || typeof price.ask !== "number") return null;
  return price.ask - price.bid;
}

/** Symbol discovery, used to resolve the NAS100 broker symbol. Read-only. */
export async function listSymbols(): Promise<string[]> {
  const { accountId, region } = await account();
  const path = `/users/current/accounts/${accountId}/symbols`;
  const symbols = await get<string[]>(clientHost(region), path);
  return Array.isArray(symbols) ? symbols : [];
}
