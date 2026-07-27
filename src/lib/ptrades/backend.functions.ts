/**
 * Cloud scanner link status.
 *
 * Replaces the old external FastAPI bridge: the scanner now runs inside this
 * app and reads MetaTrader 5 data through MetaApi Cloud, read-only.
 *
 * This module is a thin wrapper — server-function declarations only.
 * It never returns tokens, passwords, balances or any trade capability.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ScannerLink = {
  configured: boolean;
  /** True when MetaApi reports the account deployed and connected. */
  connected: boolean;
  region: string | null;
  state: string | null;
  connectionStatus: string | null;
  /** Broker login identifier only — never a password. */
  login: string | null;
  server: string | null;
  reliability: string | null;
  /** True when METAAPI_ACCOUNT_ID did not resolve and a fallback was used. */
  accountIdMismatch: boolean;
  message: string | null;
};

export const getScannerLink = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ScannerLink> => {
    const empty: ScannerLink = {
      configured: false,
      connected: false,
      region: null,
      state: null,
      connectionStatus: null,
      login: null,
      server: null,
      reliability: null,
      accountIdMismatch: false,
      message: null,
    };

    const { marketData } = await import("./scanner/market-data.server");
    const client = marketData();
    if (!client.isConfigured()) {
      return { ...empty, message: "MetaApi is not configured." };
    }

    try {
      const info = await client.getAccount();
      return {
        configured: true,
        connected: info.state === "DEPLOYED" && info.connectionStatus === "CONNECTED",
        region: info.region,
        state: info.state ?? null,
        connectionStatus: info.connectionStatus ?? null,
        login: info.login ?? null,
        server: info.server ?? null,
        reliability: info.reliability ?? null,
        accountIdMismatch: info.accountIdMismatch ?? false,
        message: info.lookupError ?? null,
      };
    } catch (error) {
      return {
        ...empty,
        configured: true,
        message: error instanceof Error ? error.message : "Account lookup failed.",
      };
    }
  });
