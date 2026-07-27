## Goal

Treat `P-Trades_Current_Code_Function_Map.md` as a functional specification only, prove the TypeScript scanner already meets it with a real test suite, and close the two gaps that specification exposes: missing spec-named pure functions, and grade thresholds that don't match the Master Handoff.

No Python infrastructure is imported, executed or deployed. Nothing from that document's `MetaTrader5` package, FastAPI app, SQLite schema, Windows paths, local terminal adapter, Cloudflare Tunnel or webhook notifier is reproduced — those are already superseded by the MetaApi + Lovable Cloud architecture.

## Current state (verified)

Every documented calculation already exists as a server-only module under `src/lib/ptrades/scanner/`:

| Spec function | Existing implementation |
| --- | --- |
| `true_range` | inlined inside `atr()` in `atr.server.ts` |
| `atr` | `atr.server.ts` (Wilder) |
| `bars(closed_only=True)` | `closedCandlesOnly` in `candles.server.ts` |
| `mark_swings` | `swingHighs` / `swingLows` in `swings.server.ts` |
| `latest_liquidity_sweep` | `detectSweep` in `sweep.server.ts` |
| `latest_displacement` | `detectDisplacement` in `displacement.server.ts` |
| `simple_trend_bias` | `higherTimeframeBias` in `bias.server.ts` |
| `reward_to_risk` | computed inline in `run.server.ts` |
| `apply_hard_gates` | 13 gates in `gates.server.ts` |
| `total_score` | `scoreCandidate` in `scoring.server.ts` |
| `grade_for_score` | grade branch inside `scoreCandidate` |
| `save_decision` / `count_actionable_today` | `persist.server.ts` |

There is currently **no test runner installed** — that is the main missing piece.

## What will be built

### 1. Test infrastructure

Add `vitest` (dev dependency) plus a `test` config in `vite.config.ts` scoped to `src/**/*.test.ts`, running in the Node environment so `*.server.ts` modules load directly. No browser/jsdom setup is needed — every module under test is pure.

### 2. Tests describing expected behaviour (written first)

One file per spec area, using small hand-built candle fixtures with known answers:

- `true-range.test.ts` — the three true-range components, gap up, gap down, first-bar handling.
- `atr.test.ts` — known-value Wilder series, insufficient data returns `null`, non-finite input returns `null`.
- `candles.test.ts` — the forming candle is excluded, out-of-order input is sorted, NaN bars are dropped, `dataAgeSeconds` maths.
- `swings.test.ts` — a confirmed centre pivot is found, an unconfirmed edge pivot is not, equal highs do not count, `lastSwing` ordering.
- `sweep.test.ts` — swing low taken and reclaimed = LONG, swing high taken and rejected = SHORT, a wick that does not close back inside is not a sweep, the sweeping candle's own swing is excluded.
- `displacement.test.ts` — body at or above the ATR multiple qualifies, a counter-direction candle never does, missing ATR returns not-found.
- `bias.test.ts` — HH/HL = LONG, LH/LL = SHORT, mixed = NEUTRAL, D1 arbitrates when H4 is neutral and vice versa.
- `reward-to-risk.test.ts` — 2R and 3R geometry both long and short, zero or inverted risk returns `null`.
- `gates.test.ts` — one test per gate for both the pass and fail branch, asserting the stored plain-English reason exists; plus the fail-closed rule that a null input rejects.
- `scoring.test.ts` — determinism (same input, same score), component boundaries, and grade assignment at each band edge.
- `fingerprint.test.ts` — identical geometry yields one fingerprint, a different day or direction yields another, ATR-relative rounding tolerance.

Target: the whole suite runs offline in under a second, with no network, no MetaApi and no database.

### 3. Spec-named pure functions extracted

To match the specification's surface without changing behaviour:

- export `trueRange(candles)` from `atr.server.ts` and have `atr()` consume it;
- add `rewardToRisk(entry, stop, target)` to a new `risk.server.ts` and call it from `run.server.ts` in place of the inline calculation;
- export `gradeForScore(score, rulebook)` from `scoring.server.ts` and call it from `scoreCandidate`.

Calculation defaults stay exactly as they are today — Wilder ATR, 5-bar fractal swings, current thresholds — as you chose.

### 4. Grade bands corrected to the Master Handoff

`DEFAULT_RULEBOOK.grades` becomes `A_PLUS: 95, A: 90, B: 80`.

The current score components can total 115, not 100, which would make those bands mean something different from the handoff. So the component weights are rescaled to the handoff's 100-point budget — HTF alignment 20, liquidity quality 20, structure confirmation 15, displacement 15, retest 15, macro 10 (reserved, scores 0 until macro lands), execution quality 5 — with reward-to-risk folded into structure/execution quality rather than carrying its own 30 points. Relative ordering of candidates is preserved; only the scale changes.

A migration inserts a new active `rulebook_versions` row (`v1.1.0-shadow`) recording the corrected bands and weights, and deactivates the previous row. Historical candidates keep their original `rulebook_version` stamp, so nothing already journalled is rewritten.

Consequence: until macro alignment and full retest scoring are implemented, realistic scores land in the B band, so the scanner will journal candidates and emit no A/A+ alerts. That is the intended fail-closed behaviour and is safe because shadow mode is still on.

### 5. Documentation

Update `docs/PROJECT_KNOWLEDGE.md` and the rulebook memory to record the corrected bands, the new weights, and to close backlog item 1. Add a short note that the function map is a specification reference and that its Python infrastructure is explicitly out of scope.

## Out of scope

Not touched in this change: the session-filter gate, setup families 7.3 and 7.4, the macro/news provider, the `/signals` route, journal schema expansion, and analytics. Those remain on the backlog. Shadow mode stays on; no execution path is introduced anywhere.

## Verification

- `vitest run` — full suite green.
- `tsgo --noEmit` — clean.
- One live scan invocation afterwards to confirm the pipeline still runs end to end and that grades now fall in the expected band.
