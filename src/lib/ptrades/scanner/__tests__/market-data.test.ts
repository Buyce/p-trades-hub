import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  READ_ONLY_METHODS,
  createMetaApiMarketData,
  MarketDataError,
} from "@/lib/ptrades/scanner/market-data.server";

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
  return files;
}

const SRC = walk("src").filter((f) => !f.includes("__tests__"));

describe("market-data adapter is the only provider boundary", () => {
  it("nothing but the adapter imports the provider transport", () => {
    const offenders = SRC.filter((file) => {
      if (file.replace(/\\/g, "/").endsWith("scanner/market-data.server.ts")) return false;
      if (file.replace(/\\/g, "/").endsWith("scanner/metaapi.server.ts")) return false;
      return /metaapi\.server/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("exposes read methods only", () => {
    const client = createMetaApiMarketData();
    const methods = Object.keys(client).filter(
      (key) => typeof (client as Record<string, unknown>)[key] === "function",
    );
    expect(methods.sort()).toEqual([...READ_ONLY_METHODS].sort());
  });

  it("cannot have a write method bolted on at runtime", () => {
    const client = createMetaApiMarketData() as Record<string, unknown>;
    expect(Object.isFrozen(client)).toBe(true);
    expect(() => {
      "use strict";
      client.createOrder = () => undefined;
    }).toThrow();
    expect(client.createOrder).toBeUndefined();
  });

  it("reports missing configuration instead of guessing credentials", () => {
    const token = process.env.METAAPI_TOKEN;
    const accountId = process.env.METAAPI_ACCOUNT_ID;
    delete process.env.METAAPI_TOKEN;
    delete process.env.METAAPI_ACCOUNT_ID;
    try {
      expect(createMetaApiMarketData().isConfigured()).toBe(false);
    } finally {
      if (token) process.env.METAAPI_TOKEN = token;
      if (accountId) process.env.METAAPI_ACCOUNT_ID = accountId;
    }
  });

  it("times out rather than hanging a scan", async () => {
    const client = createMetaApiMarketData({ timeoutMs: 1 });
    process.env.METAAPI_TOKEN ||= "test-token";
    process.env.METAAPI_ACCOUNT_ID ||= "00000000-0000-0000-0000-000000000000";
    await expect(client.getCandles("XAUUSD", "M15", 5)).rejects.toBeInstanceOf(MarketDataError);
  }, 10_000);

  it("redacts credentials from provider errors", () => {
    const error = new MarketDataError("getCandles failed: auth-token Bearer eyJabcdefghijklmnopqrstuvwxyz0123");
    expect(error.message).not.toContain("eyJabcdefghijklmnopqrstuvwxyz0123");
    expect(error.userMessage).toBe("The market data provider could not be reached.");
  });
});

describe("read-only mandate", () => {
  const PROHIBITED =
    /\b(createOrder|createMarketBuyOrder|createMarketSellOrder|createLimitBuyOrder|createLimitSellOrder|createStopBuyOrder|createStopSellOrder|modifyPosition|modifyOrder|closePosition|closePositionPartially|closeBy|cancelOrder|placeOrder|sendOrder|trade\()/;

  it("no execution call exists anywhere in src/", () => {
    const offenders = walk("src")
      .filter((f) => !f.includes("__tests__"))
      .filter((file) => PROHIBITED.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the provider transport allows GET requests only", () => {
    const source = readFileSync("src/lib/ptrades/scanner/metaapi.server.ts", "utf8");
    const methods = [...source.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect([...new Set(methods)]).toEqual(["GET"]);
    expect(source).toMatch(/assertReadOnly\(path\)/);
  });
});
