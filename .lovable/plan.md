# P-Trades Forensic Repair — Revised Plan (v2)

Corrections accepted. Findings 1 and 3 are rewritten from verified code and production rows; the `detectSetupDetailed` hierarchy is extended rather than replaced.

## A. Corrected evidence base

Arming blockers actually recorded in production (`signal_rejections`, last 2h — `saveRejections` only stores arming-failed gates):

| Gate | Count | With candidate |
|---|---|---|
| NO_SETUP | 66 | 0 |
| MISSING_DATA | 36 | 0 |
| STALE_DATA | 4 | 0 |
| BIAS_CONFLICT | 4 | 4 |

No score-band rejection exists. Over 6h: 267 MARKET_DATA errors, 61 SKIPPED vs 5 OK context heartbeats per 90m, **0 rows in `precision_watches`**.

Confirmed in code: `run.server.ts:719-724` passes `macroAligned: macro.aligned` and `sweepFound: setup.sweepFound || setup.structureType !== null`; `run.server.ts:734-735` derives `qualified` from `armingFailedGates`, not the grade.

## 1. Finding 1 (rewritten) — setup-family scoring audit

Five scoring defects to repair, none of them "macro is hard-coded":

| Defect | Where | Repair |
|---|---|---|
| Liquidity points awarded for generic structure | `run.server.ts:723` — `sweepFound: setup.sweepFound \|\| setup.structureType !== null` grants the 20-point liquidity weight to any BOS/CHOCH | Pass `setup.sweepFound` only; score structure separately from liquidity |
| R:R used as structure confirmation | `scoring.ts:80-81` — `structure_confirmation` is a pure function of `rr` | Score real structure evidence (event type, level quality, swing displacement context); move R:R out of this component |
| R:R counted twice | Score already embeds R:R, then `tierFor` re-applies the tier R:R floor | Keep the R:R floor as a tier gate only; remove R:R from the score |
| Macro clearance mislabelled as alignment | `macro.aligned` means "no active lockout", scored as directional `macro_alignment` | Rename to `macro_clear` and score it as a clearance component; directional macro alignment stays unscored until the calendar is wired |
| One budget shared by continuation and reversal | Single weight table for all families | Per-family 100-point scorecards |

Per-family 100-point scorecards (weights allocated only to evidence that family can actually produce):

- **SWEEP_DISPLACEMENT_RETEST**: liquidity sweep 25, displacement 20, retest 20, HTF alignment 15, structure confirmation 10, execution 5, macro clearance 5.
- **PULLBACK_CONTINUATION**: HTF alignment 25, BOS structure 20, displacement 20, pullback/retest 20, execution 10, macro clearance 5.
- **BREAK_RETEST (BOS)**: structure 25, displacement 25, retest 25, HTF alignment 15, execution 5, macro clearance 5.
- **BREAK_RETEST (CHOCH reversal)**: CHOCH structure 25, displacement 25, retest 20, exhaustion/sweep evidence 15, execution 10, macro clearance 5 — HTF conflict scored as expected, not penalised to zero.

Each scorecard sums to exactly 100 and is reachable by a real gate-passing candidate. `reachability.ts` is extended to run per family and assert A+, A, B and C are each attainable; the test fails the build if any tier is dead in any family.

## 2. Finding 3 (rewritten) — rename `qualified` to `armable`

`candidate.qualified` already means "every arming gate passed". The concept is renamed `armable` end to end (`Candidate`, `signal_candidates.qualified` retained as a column alias for history, repositories, UI), so nothing reads it as "earned a tier". Zero watches are caused by the production gates above — MISSING_DATA and NO_SETUP dominate, BIAS_CONFLICT kills the only candidates that reach a setup. No claim is made that the score blocks arming.

## 3. Extend `detectSetupDetailed`, do not duplicate it

The existing complete → armable → diagnostic hierarchy stays. Added before selection:

- Every detector event returns `{index, time, ...}`; `detectDisplacement` / `detectRetest` / `detectSweep` / `detectStructureEvent` accept `afterIndex` / `beforeIndex`.
- Sequence validation: sweep < displacement < confirmation < retest; break ≤ displacement < retest (the retest can never be the break candle); BOS ≤ displacement < pullback. Non-monotonic sequences are rejected.
- Setup-specific bias eligibility (`evaluateBiasPolicy({setupType, structureType, direction, h4Bias, d1Bias})`): BOS continuation requires H4 alignment; CHOCH reversal expects opposition but demands sweep/exhaustion + displacement + retest + M1 trigger; neutral reduces score instead of rejecting. Replaces the global `biasConflict` (`gates.server.ts:81`). Persists `bias_policy`, `prior_h4_bias`, `prior_d1_bias`, `bias_policy_passed`, `bias_policy_reason`.
- A complete result may only win if chronology **and** bias policy pass; otherwise an eligible armable result outranks it.

## 4. Three separated routes

- **`sync-market-data`** — the only MetaApi reader. Writes `public.market_candles` (PK `broker_symbol, timeframe, open_time`), fetching only bars newer than the stored last close per timeframe bucket. Emits `provider_requests`, `provider_timeouts`, `db_cache_hits`, `db_cache_misses`, `last_closed_candle_by_symbol_timeframe`.
- **`scan-context`** — reads validated history from `market_candles`, does no full-history provider fetch during analysis. Marks a symbol data-degraded when its stored history is stale or short; counts only usable symbols as completed (fixes the false 5/5 at `run.server.ts:936`).
- **`scan-precision`** — single short pass over open watches.

The module-level `candleCache` / `lastGood` Maps (`run.server.ts:224,234`) are removed.

## 5. Strict rulebook validation

Replace the shallow merge in `parseRulebook` with a validated deep merge against an extended `contracts/rulebook.schema.json`. Rejects: missing nested `precision.instruments[*]` fields, invalid or non-monotonic grades, unreachable tiers (via the per-family reachability check), non-finite numbers, invalid expiry/proximity values, unsupported ATR methods. A rulebook failing validation cannot be marked active — enforced in code and by a DB check on activation.

## 6. Target-before-entry uses only post-arm M1

`precision.server.ts` evaluates TP1 touch strictly on M1 candles with `open_time >= watch.armed_at`, never the full downloaded window. Explicit `precision.instruments[symbol].displacementM1Atr` (FX 0.70, XAUUSD 0.80) replaces `Math.min(1, rulebook.displacement_min_atr)` at `precision.server.ts:326`; trigger retest window 5 M1 bars; FX armed expiry 45m, XAUUSD 30m.

## 7. Lock design

Unique holder token (already present), plus: atomic expired-lease takeover in the acquire RPC, holder-scoped release, a hard runtime deadline set below the lease TTL that ends the run and reports partial/degraded completion, and optional mid-run lease renewal for long passes. Correctness no longer depends on `finally` running.

## 8. Canonical structural idea

`structural_idea_id` = hash of instrument + timeframe + direction + structure type + source level rounded to tick + source event time. Replaces the ATR/entry/stop geometry fingerprint (`fingerprint.server.ts`). One active watch and one alert per structural idea, even when several families label it differently; precision updates preferred entry in place.

## 9. Deterministic replay acceptance

Historical candle fixtures under `fixtures/` drive a replay harness that proves DETECTED → ARMED → MICRO_TRIGGERED → ENTRY_READY → notification record, per tier. No live-market window requirement, no synthetic alerts inserted. Forensic fixtures included: retest-before-break rejected, break-candle-cannot-be-retest (GBPUSD, USDJPY), CHOCH not rejected by generic bias, BOS opposite-bias rejected, neutral-bias valid B, armable-not-masked, durable-cache-survives-cold-start, 3-of-5-missing-is-degraded, v1.8 EURUSD dedup, all-tiers-entry-ready, no-daily-cap, no-execution-method.

## 10. Migration and rollback

New rulebook version (v2.2.0-live) inserted alongside the existing rows; `market_candles` and new columns are additive only. Rollback SQL reactivates v2.1.0-live and drops the new artefacts; no historical data is deleted or rewritten.

## 11. Notification channel verification

Terminal (`notifications` row), push (`push_subscriptions` delivery), and email (transactional send) each verified separately for creation, idempotency key uniqueness per signal+tier, delivery status, and per-user tier preference filtering.

## 12. Invariants preserved

LIVE_ALERTS stays on; MetaApi remains GET-only read-only; A+, A, B, C all actionable and all require ENTRY_READY; tier R:R floors 2.0 / 2.0 / 1.5 / 1.2 unchanged; no daily cap; arming thresholds (0.60 / 0.60 / 0.60 / 0.65 / 0.70 ATR) not lowered; no order-execution path.

## Build order

1. Lock hardening + honest completion accounting.
2. `sync-market-data` + `market_candles` + `scan-context` reading from Postgres.
3. Indexed events, chronology enforcement, bias policy, hierarchy extension.
4. `armable` rename, structural idea ID, watch creation.
5. Per-family scorecards + reachability tests.
6. Precision fixes (post-arm M1, explicit thresholds).
7. Rulebook schema validation gate.
8. Replay harness + forensic fixtures + channel verification.
9. Observability panels.
