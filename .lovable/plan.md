## What production actually shows (verified this turn)

- `precision_watches`: 24 rows ever. **0 reached ENTRY_READY.** 20 EXPIRED, 3 MISSED, 1 INVALIDATED.
- Last notification: **28 Jul 11:00**. Signals are still being created (latest 13:16 today), so arming works — promotion does not.
- Three distinct kill reasons are recorded in `metadata.resolution`:
  1. `"TP1 was reached before an entry formed."` — GBPAUD 13:16, resolved 60s later with `check_count = 0`. The watch was declared a miss on its very first evaluation.
  2. `"Watch rulebook v1.8.0-live does not match active v2.1.0-live."` — watches armed under the old rulebook are killed outright after the activation fix.
  3. `"The armed setup expired before an entry formed."` — 20 watches, 30-minute expiry, 6–22 checks, no M1 trigger ever fired.
- Upstream is also thin, so precision is not the whole story: only **5 qualified candidates in 6 hours**, 466 `NO_SETUP` rejections, and `MARKET_DATA_SYNC` is reporting `ERROR/DEGRADED` with **FAILED M1/M5/M15 reads for XAUUSD** (5–8s timeouts).
- Delivery is healthy: every precision heartbeat reports email transport ready, push ready, 2 recipients, all four tiers covered. Nothing is being blocked at the notification hop.

## Root cause of defect 1 (the clearest bug)

`runWatch` computes `extremeSinceArmed` by reducing over the **entire stored 120-bar M1 window** (`src/lib/ptrades/scanner/precision.server.ts`, lines 259–287). That window is two hours of history, most of it *before* `armed_at`. Any excursion that already happened before the setup was armed counts as "TP1 reached", so the watch is retired as MISSED on its first pass with zero checks. The variable name says "since armed"; the code does not filter by `armed_at`.

## Repair plan

1. **Make "already moved" mean since arming**
   - Filter the M1 series to candles at or after `armed_at` before computing the extreme.
   - If no candle exists after `armed_at` yet, skip the TP1-touched test entirely instead of failing it. Fail-closed here means *not resolving*, not resolving as MISSED.
   - Record the window used in `metadata.last_check` so the decision is auditable.

2. **Stop discarding watches on a rulebook version bump**
   - Instead of resolving a version-mismatched watch, mark it as legacy and let it run to its natural expiry under the rulebook it was armed with, or re-derive it under the active rulebook when the setup fields are still valid.
   - Only hard-kill when the two rulebooks disagree on a gate that would change the trade plan.

3. **Feed precision real M1 data**
   - `sync-market-data` is currently failing M1/M5/M15 for XAUUSD, so `readCandles(MICRO_TF)` returns a short or stale series and no trigger can ever form. Give M1 its own read budget and retry, and make the precision pass report explicitly when the stored M1 series is too short or too old to evaluate, rather than silently finding no trigger.
   - Surface "no trigger because no data" separately from "no trigger because no setup" in the heartbeat.

4. **Explain expiry instead of just recording it**
   - On expiry, persist the last observed distance-to-entry, whether a displacement was seen, and which trigger stage was reached. Twenty expiries with no diagnostic is why this took three days to localise.

5. **Verify without inventing a signal**
   - Replay the GBPAUD 13:16 watch through the corrected TP1 window and confirm it would not have been MISSED.
   - Confirm at least one watch survives past its first pass and accumulates checks with recorded trigger-stage telemetry.
   - Confirm M1 reads succeed for all five enabled instruments across three consecutive sync cycles.

## Technical notes

- Files: `src/lib/ptrades/scanner/precision.server.ts` (TP1 window, version handling, telemetry), `src/lib/ptrades/scanner/sync.server.ts` (M1 budget), `src/routes/api/public/hooks/scan-precision.ts` (heartbeat detail).
- New unit coverage in the forensic replay suite for the `armed_at` window boundary.

**Constraint honoured:** no score, R:R, proximity, displacement, session or expiry threshold changes. Every change above is a correctness or observability fix.
