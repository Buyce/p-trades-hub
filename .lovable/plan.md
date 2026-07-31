## What production actually shows (verified just now)

**Your data feed is fine.** All five instruments have fresh candles — M1 up to 14:17, M15 up to 14:00, for XAUUSD, GBPAUD, GBPUSD, EURUSD and USDJPY. Nothing is unwatched.

**The three "Unavailable" chips are a labelling bug, not a scan failure.** A `grade` is only written when a signal reaches ENTRY_READY. GBPAUD (75.00), GBPUSD (51.69) and EURUSD (74.71) are real scanned signals sitting in ARMED/EXPIRED with `grade = NULL`, so the badge falls back to the generic "Unavailable" string. The terminal *did* scan them.

**The real reason there are no alerts: the jobs are running every 3 minutes, not every minute.** Heartbeats confirm it — context scans at 14:01, 14:04, 14:07, 14:10, 14:13, 14:16, 14:19; precision at 14:02, 14:05, 14:08, 14:11, 14:14, 14:17, 14:20. Your entry confirmation needs a rejection, a displacement, a break and *then* a retest — all on closed 1-minute candles. A retest window lasts one or two minutes. Precision only looks once every three. It is structurally almost impossible to catch. Watch history agrees: 20 EXPIRED, 4 MISSED, 1 INVALIDATED, 0 ever ENTRY_READY.

**Second cause: market-data sync rotates one instrument per tick.** Five instruments × a 3-minute tick means each symbol is refreshed roughly every 15 minutes. Heartbeats show repeated `MARKET_DATA_SYNC ERROR` with 16-second M1 timeouts on USDJPY, EURUSD and GBPUSD, which then shows up as 8 `STALE_DATA` rejections.

**Third: the funnel dies upstream.** Last 5 hours: 509 `NO_SETUP` (275 no structure event, 234 no displacement), 12 `INVALID_STOP`, 8 `STALE_DATA`. Only ~1 candidate survives per scan.

So: not a code-complexity problem, a **cadence + confirmation-depth** problem.

---

## The plan

### 1. Restore one-minute cadence and stop the jobs colliding
Reschedule the three cron jobs so each runs every minute, staggered inside the minute rather than sharing it:
- `sync-market-data` at second 0
- `scan-context` at second 20
- `scan-precision` at second 40

pg_cron is minute-granular, so the stagger is implemented as three per-minute jobs with a short in-handler delay, or by keeping sync/context at 1-minute and precision at 1-minute with its existing 55s lock TTL. Lock TTLs get shortened to match (context 55s, precision 45s) so a crashed tick never blocks the next one — there was already one `SKIPPED` at 13:58 from a stale 3-minute lock.

### 2. Simplify entry confirmation to trigger + close (your choice)
In `micro-trigger.server.ts`, the confirmation becomes:
- a closed M1 candle whose body breaks the trigger level in the signal's direction, **while price is inside the entry zone**;
- the candle must close beyond the level (no close-back-through);
- the displacement floor (`displacement_m1_min_atr`, 0.8) stays;
- the separate **retest requirement is removed** as a blocking condition.

The retest is still *detected and recorded* on the signal (`trigger_summary`, metadata) so the journal keeps the full picture — it just no longer gates the alert. `retest_deadline` handling collapses accordingly. Everything else stays: closed candles only, M1 ATR must exist (fail-closed), invalidation must be present, tier R:R floors unchanged, dedup unchanged, no daily cap.

This is the one change that touches trading rules, so it ships as a new rulebook version with a written change summary, and the old behaviour stays reachable by reactivating the previous rulebook.

### 3. Make sync cover every instrument every tick
`sync.server.ts` currently rotates. Change to: refresh M1 for **all** instruments each tick (it is the timeframe precision depends on), and keep rotation only for the slow frames (H1/H4/D1). Raise the M1 timeout to 10s with one retry and run the five symbols concurrently rather than serially, so one slow symbol cannot starve the rest. Heartbeat reports per-symbol M1 age so starvation is visible on Scanner Health.

### 4. Widen the top of the funnel — measured, not guessed
No threshold is changed blind. Instead, add a governance panel to Scanner Health showing the last 24h split of `NO_STRUCTURE_EVENT` vs `NO_DISPLACEMENT` vs downstream gates, per instrument. Once 1-minute cadence has run for a session, the numbers say whether `arming_displacement_min_atr` or the swing lookback is the binding constraint — and that becomes a separate, deliberate rulebook change with your sign-off.

### 5. Watchlist: explain the state instead of saying "Unavailable"
Replace the fallback badge for un-graded signals with an informative row:
- a **provisional tier** chip derived from the stored `provisional_grade` / score, marked "provisional";
- the lifecycle state in words — "Armed · waiting for entry trigger", "Expired · price never returned", "Missed · target hit before entry";
- a one-line explainer under the list: *"Provisional means the setup is being tracked live. A final tier is assigned only when the entry trigger completes."*

Instruments with no signal today keep "Watching" but gain the last-scan timestamp, so a quiet symbol never looks like an unmonitored one. This is presentation only — no score or tier is computed in the frontend; both come from the stored `provisional_score` / `provisional_grade` columns.

### 6. Verification before I call it done
- Confirm from `system_heartbeats` that context and precision tick every 60s for 15 consecutive minutes.
- Confirm `MARKET_DATA_SYNC` reports `OK` with M1 age < 120s for all five instruments.
- Replay the existing ARMED GBPAUD watch through the simplified trigger and show whether it would have fired.
- Full Vitest suite green, including updated micro-trigger tests.

---

### Technical notes
- Files: `sync.server.ts`, `micro-trigger.server.ts`, `precision.server.ts`, `lock.server.ts`, `run.server.ts` (telemetry), `scanner/types.ts` (rulebook fields), `watchlist.tsx`, `format.ts`, plus a rulebook-activation migration and a `cron.schedule` update run through the data tool.
- No execution capability is added anywhere; every change stays read-only against MetaApi.
- The frontend change reads only stored columns — no scoring moves client-side.
