## What the audit found (verified against code and the live database)

| Area | Current state | Verdict |
|---|---|---|
| `precision_watches` | **0 rows, ever** | Broken handoff |
| Watch creation (`run.server.ts:850`) | `if (!result.candidate.qualified) continue;` — a watch only opens when *every* arming gate passes **and** a score band is reached | Wrong condition; contradicts "armable ≠ qualified" |
| `qualified` (`run.server.ts:671`) | `failed.length === 0 && scoreGrade !== null` | Score gate blocks arming |
| Signals last 24h | 12 rows, **all `lifecycle_state = DETECTED`, `is_actionable = true`** (A+ 1, A 5, B 7, C 2) | Legacy immediate-alert path still writing |
| Lifecycle beyond DETECTED | **0 ARMED / 0 MICRO_TRIGGERED / 0 ENTRY_READY** | Engine never receives work |
| Scanner runs | 80 `TIMEOUT`, last `SUCCESS` 15:09, one stuck `RUNNING` | Minute cron overlaps the in-request precision sleep loop |
| Daily cap | Rulebook `v2.0.0-live` already has cap `0`, but `claimActionableSlot` / `isUnlimitedCap` / `DAILY_CAP` gate code still exists (`precision.server.ts:348-357`, `persist.server.ts:329`, `gates.server.ts:168`, `types.ts:60`) | Cap logic must be removed, not zeroed |
| Live price | `precision.server.ts:203` uses `lastClosedM1.close` as current price | No bid/ask quote |
| Shadow mode | `precision.server.ts:408` hard-codes `shadowMode: false` | Must read scanner settings |
| Rulebook drift | `scanner_settings.rulebook_version = v1.6.0-live` while active row is `v2.0.0-live` | Inconsistent reporting |
| Micro-trigger state | Full sequence re-searched every pass; `MICRO_TRIGGERED` never persisted as a resumable state | Loses partial progress |

Top rejection gates (5h): NO_SETUP 801, NO_DISPLACEMENT 770, INVALID_STOP 714, RR_BELOW_MIN 704, NO_RETEST 704, NO_SWEEP 704, MISSING_INVALIDATION 294.

## Plan

**1. Authoritative tier policy (one module, no duplicates)**
- Add `src/lib/ptrades/tiers-policy.ts` with `ACTIONABLE_TIERS = [A_PLUS, A, B, C]`, `isActionableTier`, and a single `isActionable({grade, lifecycleState, hardGateFailures, systemMode, notificationAlreadySent})`.
- Keep the existing `tiers.ts` labels and `scoring.ts` `tierFor` as the single resolver; delete no second copy exists — re-export rather than duplicate.
- Default alert preferences (email, push, terminal) become all four tiers.

**2. Remove daily-cap enforcement**
- Delete `claimActionableSlot`, `isUnlimitedCap`, the `DAILY_CAP` gate code and its call site; drop `max_daily_actionable` / `tier_daily_max` from rulebook reads and UI text. Historical `daily_alert_counters` rows and columns stay intact (deprecated, no longer read or written).
- Regression tests: the 1st, 3rd, 10th and 50th unique `ENTRY_READY` of the same UTC day all become actionable; `DAILY_CAP` can never appear as a blocking gate.

**3. Fix the arming handoff (the actual outage)**
- Replace `candidate.qualified` with `isArmableCandidate(setup, armingGates)`: structural setup (direction, level, sweep-or-structure, displacement) plus arming-only gates — session, data present, candle sanity, freshness, news, invalidation, valid stop, bias sanity, non-duplicate.
- Arming must not require score band, execution R:R, M1 trigger/retest, spread, proximity, late-entry.
- Every armable setup writes an `ARMED` signal (`is_actionable = false`, no notification) plus a `precision_watches` row. All four tiers use the same flow.

**4. Recalculate score and tier at ENTRY_READY**
- The M15 score becomes provisional/diagnostic. At ENTRY_READY, re-score with the confirmed retest, live spread, final R:R and entry timing, then resolve the final tier with `tierFor` (floors A+/A 2.0, B 1.5, C 1.2). Persist provisional score/grade, final score/grade, components and a scored-at timestamp. Only the final grade drives notification.

**5. Live quote handling (read-only)**
- Add `MarketQuote {symbol, bid, ask, time}` and `getQuote()` to the read-only market-data interface; use ask for LONG, bid for SHORT for proximity and execution price. M1 candles remain trigger-confirmation only.
- Add a test asserting the market-data interface exposes no order/modify/close/cancel method.

**6. Persist micro-trigger progress**
- On trigger, persist `state = MICRO_TRIGGERED`, trigger level, BOS candle time, retest deadline. Later passes with that state search only for the retest of the persisted level and resolve to ENTRY_READY / MISSED / EXPIRED / INVALIDATED. When searching fresh, pick the latest *complete* valid sequence.

**7. Split the cron into two jobs (fixes the timeouts)**
- `scan-context` (1/min): HTF/M15/M5 fetch, detect armable setups, open watches, exit — no sleep loop.
- `scan-precision` (frequent): load open watches, one evaluation pass each, fetch quote, fetch M1 only when a new M1 close exists, persist, exit.
- Separate locks per job; skipped overlapping ticks recorded as `SKIPPED`, not silent.

**8. Live mode, not shadow**
- Remove the hard-coded `shadowMode: false`; thread the mode from `scanner_settings` everywhere. Sync `scanner_settings.rulebook_version` to the active rulebook and publish a `v2.1.0-live` rulebook carrying the per-instrument precision parameters from the brief (proximity points, displacement M1 ATR, max extension R, armed expiry) with no cap fields.
- Notification eligibility uses the single `isActionable` plus an idempotency key `signal_id|type|user_id|channel`. User tier preferences filter delivery only.

**9. UI**
- Dashboard: remove all cap language, default tier filters to all four, show live-mode status.
- Signal card: final tier, lifecycle state, preferred entry, zone, current price, distance to entry, trigger summary, stop, targets, R:R plus the tier minimum, invalidation, expiry, timestamp.
- Scanner Health funnel: Detected → Armed → Micro triggered → Entry ready → Notified, broken down by A+/A/B/C with the top blocker per stage.

**10. Fixtures, parity and tests**
- Shared JSON fixtures for all 12 required IDs, run by both Vitest and the Python reference (`tiers.py`, `scoring.py`, `lifecycle.py`, `actionable.py`, `notification_policy.py`, `rulebook.py`, `fixtures.py`) with identical results.
- The 24 required assertions from the brief, added to the existing suites.

**11. Deploy and verify with production data**
- Ship only if build, typecheck, all suites, migrations and the no-execution scan pass; otherwise fail closed and report the exact failure.
- After publish, query production and report scanner mode, context runs, ARMED, MICRO_TRIGGERED, ENTRY_READY and notifications **split by A+, A, B and C**, plus top blockers and proof no cap function was evaluated. No success claim before those counts show real movement.

## Technical notes

Files to change: `run.server.ts`, `precision.server.ts`, `persist.server.ts`, `gates.server.ts`, `notify.server.ts`, `market-data.server.ts`, `micro-trigger.server.ts`, `types.ts`, `scoring.ts`, new `tiers-policy.ts`, new `src/routes/api/public/hooks/scan-context.ts` and `scan-precision.ts` (retiring `scan-markets.ts`), health repo + Scanner Health and dashboard routes, the Python reference package, and the fixture/test suites. Database work: a new active rulebook row, a cron repoint to the two jobs, a profile default-tier update, and a deprecation note on the cap columns — no historical data deleted. The system stays strictly read-only throughout.
