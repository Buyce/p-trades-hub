# Phase 7 report — market data adapter, feature engine, read-only proof

Shadow mode unchanged. No schema change. No behavioural change to live signals:
the tuned defaults (Wilder ATR, swing lookback 5) remain the defaults.

## 1. One read-only market data boundary

`src/lib/ptrades/scanner/market-data.server.ts` is now the only module allowed
to touch the provider transport. It exposes exactly six read methods
(`isConfigured`, `getAccount`, `getCandles`, `getSpread`, `getSymbolSpec`,
`listSymbols`), returns frozen plain DTOs, applies a 15s timeout and 429
backoff, and redacts credentials from every error before it escapes.

Rewired off direct `metaapi.server` imports:

- `src/lib/ptrades/scanner/run.server.ts`
- `src/lib/ptrades/scanner/symbols.server.ts`
- `src/lib/ptrades/backend.functions.ts`
- `src/routes/api/public/hooks/scan-markets.ts`

A test walks `src/` and fails if any module other than the adapter imports the
transport, so the boundary cannot erode.

## 2. Read-only mandate, proven by test

`market-data.test.ts` asserts:

- no execution call name (`createOrder`, `modifyPosition`, `closePosition`,
  `cancelOrder`, …) appears anywhere in `src/`;
- the transport issues `method: "GET"` only and routes every path through
  `assertReadOnly`;
- the adapter object is frozen — a write method cannot be attached at runtime;
- missing credentials report "not configured" instead of guessing.

## 3. Indicator conflicts are rulebook-driven, not hardcoded

`rulebook.atr_method` selects `WILDER` (default, live behaviour) or `SMA` (the
Python reference specification). `rulebook.atr_period` and
`rulebook.swing_lookback` were already rulebook fields and are now read by the
run pipeline rather than defaulted at the call site.

## 4. Single feature engine

`src/lib/ptrades/scanner/features/index.ts` is the named entry point for every
deterministic calculation (true range, ATR, swings, structure, sweep,
displacement, retest, HTF bias, R:R, late entry, session, candle sanity,
normalisation). One implementation per feature, re-exported once.

Setup families now have a registry in `types.ts`: internal codes stay exactly as
already stored in `signal_candidates` / `signals`, and `normaliseSetupFamily`
maps the specification's names onto them, so no stored row needs rewriting.

## 5. Golden fixtures and cross-engine parity

- `fixtures/golden/xauusd-m15-zigzag.json` — deterministic zigzag with
  confirmed fractal swings (the existing clean fixture trends monotonically and
  yields no swings, so it could not test them).
- `fixtures/golden/features.json` — golden values generated from the Python
  reference implementation, which was written from the specification rather
  than transliterated from TypeScript.

Both engines assert the same numbers at 1e-9:

- TypeScript: `src/lib/ptrades/scanner/__tests__/golden/features.test.ts`
- Python: `handoff/python-reference/tests/test_golden_features.py`

Reference ATR on the clean M5 fixture: Wilder-14 `2.945934989`, SMA-14
`2.9571428571` — the two methods genuinely differ, so a silent method swap
fails the suite.

## 6. Verification

- `bunx vitest run` — 233 passing across 23 files.
- `handoff/python-reference` — 19 passing (`pythonpath = ["."]` added so the
  suite runs from a checkout without installing).
- `bunx tsgo --noEmit` — clean.
- Live provider read through the new adapter: account `DEPLOYED`,
  `CONNECTED`, region `london`, no account-id mismatch.
