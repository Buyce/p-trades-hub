import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Architectural boundaries, enforced as tests.
 *
 * 1. Screens never touch the database client directly — they call repositories.
 * 2. No mock/fake market-data adapter can reach production code.
 * 3. No trade-execution vocabulary exists anywhere in the frontend.
 */

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
  return files;
}

const ROUTE_FILES = walk("src/routes").filter((f) => !f.includes("__tests__"));
const APP_FILES = [...ROUTE_FILES, ...walk("src/lib/ptrades")].filter(
  (f) => !f.includes("__tests__"),
);

/** Auth session handling is the one legitimate direct use of the client. */
const AUTH_ALLOWED = [
  "src/routes/auth.tsx",
  "src/routes/reset-password.tsx",
  "src/routes/_authenticated/route.tsx",
  "src/routes/_authenticated/settings.tsx",
  "src/lib/ptrades/session.ts",
];

describe("data-access boundary", () => {
  it("no screen queries a table directly", () => {
    const offenders = ROUTE_FILES.filter((file) =>
      /supabase\s*\.\s*from\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("only the repository client and auth code import the database client", () => {
    const offenders = APP_FILES.filter((file) => {
      if (AUTH_ALLOWED.includes(file.replace(/\\/g, "/"))) return false;
      if (file.replace(/\\/g, "/") === "src/lib/ptrades/repositories/client.ts") return false;
      return /from "@\/integrations\/supabase\/client"/.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("files that import the client for auth only use auth methods", () => {
    for (const file of AUTH_ALLOWED) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not query tables directly`).not.toMatch(
        /supabase\s*\.\s*from\s*\(/,
      );
    }
  });
});

describe("no mock market data in production code", () => {
  it("production modules contain no mock/fake/sample data source", () => {
    const offenders = APP_FILES.filter((file) =>
      /(mockCandles|fakeCandles|sampleCandles|MOCK_MODE|USE_MOCK|__mock)/i.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("only test files import from fixtures/", () => {
    const offenders = APP_FILES.filter((file) =>
      /from ["'].*fixtures\//.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("no trade execution path", () => {
  const FORBIDDEN =
    /\b(createOrder|createMarketBuyOrder|createMarketSellOrder|modifyPosition|closePosition|cancelOrder|placeOrder|sendOrder)\b/;

  it("no execution API is referenced anywhere in src/", () => {
    const offenders = walk("src")
      .filter((f) => !f.includes("__tests__"))
      .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
