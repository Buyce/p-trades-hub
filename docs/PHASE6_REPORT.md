# Phase 6 report — Data access, adapters, normalisation

Status: complete. Shadow mode unchanged (ON). No trade-execution path added.

## Audit (before changes)

| Finding | Evidence |
| --- | --- |
| Screens queried tables directly | `journal.tsx` (trade insert, trade close update), `signals.$signalId.tsx` (decision upsert), `settings.tsx` (profile upsert) |
| One flat query module, no domain boundary | `src/lib/ptrades/queries.ts` held every read for signals, decisions, trades, health, rulebooks and profiles |
| No shared error shape | every call site threw `new Error(error.message)`, leaking raw PostgREST text to toasts |
| Time logic duplicated | `utcTradingDay` in `queries.ts`, `tradingDayUtc` in `persist.server.ts`, closed-candle maths in `candles.server.ts`, formatting in `format.ts` |
| Candle validation was a filter, not a normaliser | `closedCandlesOnly` silently dropped bad rows with no record, no duplicate-time handling, no inverted-range check |
| `scanner_errors` table existed but nothing wrote to it | zero references in `src/` |
| No shared fixtures | TypeScript fixtures were code-only (`__tests__/fixtures.ts`); Python had none |

## Changes

**Repository layer** — `src/lib/ptrades/repositories/`
- `client.ts` — the only browser module that touches the database client for application data. Exports `db`, `unwrap`, `unwrapList`, `requireUserId`.
- `signals.repo.ts`, `decisions.repo.ts`, `trades.repo.ts`, `health.repo.ts`, `rulebooks.repo.ts`, `profile.repo.ts`, `index.ts`.
- Write actions moved out of screens: `recordDecision`, `createTrade`, `closeTrade`, `updateProfile`.
- `queries.ts` is now a thin facade re-exporting the repositories, so no screen import had to churn.

**Errors** — `src/lib/ptrades/errors.ts`
- One `AppError` with `code`, `detail`, safe `userMessage`, plus `toAppError`, `userMessageOf`, `fromPostgrest` (maps `42501`→FORBIDDEN, `PGRST116`→NOT_FOUND, `23xxx`→VALIDATION) and credential redaction of `sb_*`, JWTs and bearer tokens.
- Screens now toast `userMessageOf(error)` instead of the provider message.

**Time** — `src/lib/ptrades/time.ts`
- `toUtcIso`, `utcTradingDay`, `getUtcDayBoundary`, `isClosedCandle`, `ageSeconds`, `formatInUserTimezone`. UTC stays canonical; timezone is display only.

**Candle normalisation** — `src/lib/ptrades/scanner/candles.server.ts`
- `normaliseCandles()` sorts, de-duplicates, validates and drops the forming candle, returning `{ candles, rejected }` with reasons `INVALID_TIME | NON_FINITE_PRICE | NON_POSITIVE_PRICE | INVERTED_RANGE | BODY_OUTSIDE_RANGE | DUPLICATE_TIME | NOT_CLOSED`.
- Malformed candles are dropped and reported — never repaired or interpolated.
- `closedCandlesOnly` is retained as a thin wrapper so existing callers and tests keep working.

**Scanner error recording** — `src/lib/ptrades/scanner/errors.server.ts`
- `recordScannerError(admin, { runId, instrument, stage, error, detail })` writes to `scanner_errors` with stages `LOCK | RULEBOOK | MACRO | SYMBOL_RESOLUTION | MARKET_DATA | NORMALISATION | EVALUATION | PERSISTENCE | PROMOTION | NOTIFICATION`.
- `run.server.ts` now records market-data failures, malformed-candle batches and per-instrument evaluation failures instead of only `console.error`.

**Shared fixtures** — `fixtures/`
- `candles/xauusd-m5-clean.json`, `candles/xauusd-m5-malformed.json`, `expected/normalisation.json`, `README.md`.
- Consumed by TypeScript (`scanner/__tests__/fixture-parity.test.ts`) and Python (`handoff/python-reference/tests/test_fixture_parity.py` against the new `ptrades_reference/candles.py`). Both produce 60 kept / 0 rejects and 10 kept / 6 reject reasons.

**Mock adapter** — none exists. Rather than add one, the absence is now enforced by test: no `mockCandles|fakeCandles|sampleCandles|MOCK_MODE|USE_MOCK|__mock` token and no `fixtures/` import may appear in production modules.

## Boundary tests

`src/lib/ptrades/__tests__/boundaries.test.ts` fails the build if:
1. any route calls `supabase.from(...)`;
2. any module other than `repositories/client.ts` and the four auth files imports the database client;
3. an auth-allowed file starts querying tables;
4. mock market data or a fixture import reaches production code;
5. any execution API name (`createOrder`, `modifyPosition`, `closePosition`, `cancelOrder`, …) appears anywhere in `src/`.

## Verification

- `bunx vitest run` — **205 passing** across 20 files (was 180).
- Python parity — both fixture cases match the TypeScript results exactly.
- `bunx tsgo --noEmit` — clean.
- Routes `/`, `/auth`, `/dashboard`, `/journal` return 200.
- Scanner unaffected: runs at 19:50 and 19:51 UTC finished `SUCCESS`, 0 alerts, shadow mode ON.

## Not done in this phase (carried forward)

- Symbol mapper still lives at `scanner/symbols.server.ts` (server-only, correct location) — no browser-side mapper was needed, so it was not duplicated.
- Setup-family renaming and the ATR/swing rulebook switches remain Phase 7 decisions.
