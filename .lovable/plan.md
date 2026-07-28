## What your two screenshots show

**Image 1 — Dashboard / Market data link.** The backend is healthy: heartbeat 13s old, scanner status OK, MT5 connection Connected, active rulebook `v1.3.0-live` (live mode, shadow off). "Broker feed: Unavailable" is a cosmetic gap — that field isn't being populated by the health payload.

**Image 2 — Alerts.** "No alerts yet" is the empty state, not an error. The scanner is running and evaluating, it simply hasn't produced a setup that passes every gate.

## Why no alert has arrived (verified from the database)

- Last 2 hours: 114 scanner runs, all `SUCCESS`. 2,814 candidates evaluated in the last day.
- Zero qualified. Rejections in the last day, by gate: DUPLICATE 2671, STALE_DATA 2242, SESSION 2199, NO_DISPLACEMENT 2103, RR_BELOW_MIN 1859, BIAS_CONFLICT 1671, INVALID_STOP 1530, NO_SETUP 1475, NO_SWEEP/NO_RETEST 1260 each.
- `daily_alert_counters` has no row for today, so no actionable slot has ever been claimed.

So the pipeline works end to end; the rulebook is just very strict, which is by design. One thing is **not** by design: `STALE_DATA` is firing on all five instruments roughly every run (≈140 each in 3 hours). That gate alone can veto otherwise-valid setups, and it points at market-data freshness rather than trading logic. This is a suspected, not yet confirmed, cause — diagnosing it is step 1 below.

## Plan

1. **Diagnose STALE_DATA.** Instrument the market-data path to log, per symbol and timeframe, the last candle time vs. now and the configured `max_data_age_seconds`. Determine whether the age threshold is simply too tight for the higher timeframes (e.g. an H1 candle is by definition up to an hour old) or whether MetaApi reads are genuinely lagging. Fix accordingly: correct per-timeframe age budgets, or per-instrument `max_data_age_seconds` on `instruments`.
2. **Raise the daily alert cap to 30.** Three places must move together:
   - `scanner_settings.max_daily_alerts` → 30 (migration).
   - A new rulebook version `v1.4.0-live` with `max_daily_actionable: 30`, set active, everything else copied from `v1.3.0-live` (migration).
   - `contracts/rulebook.schema.json` currently caps `max_daily_actionable` at 10 — raise the schema maximum to 30, and update `DEFAULT_RULEBOOK` in `src/lib/ptrades/scanner/types.ts` plus the two tests that assert `2` / reject `25`.
3. **Fix "Broker feed: Unavailable"** on the dashboard by surfacing the field the heartbeat actually reports.
4. **Verify.** Re-run typecheck and the full Vitest suite, then confirm from the database that the active rulebook reads 30 and that the cap gate no longer references 2.

## Note on the safety envelope

Your stored project rule is "0–2 actionable alerts per UTC day". Raising the cap to 30 supersedes that; I'll update the project memory so future sessions don't revert it. A/A+ only and minimum 2.0R at TP1 stay unchanged — the cap is a volume limit, not a quality filter, so this makes the system louder, not looser.

## Technical detail

No trade-execution surface is added or touched. All changes are configuration, one schema bound, one UI field, and diagnostics.
