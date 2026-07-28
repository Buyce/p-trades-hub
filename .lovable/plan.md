## What I verified in production (read-only)

Facts, each from a live query:

- **The terminal, cron and feed are healthy.** 107 scanner runs in the last 2 hours, all `SUCCESS`, all 5 instruments scanned (XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY), ~13s per run, **zero** scanner errors in 6 hours. Nothing has crashed.
- **Last alert: 28 Jul 11:00 UTC** (17 notifications total). Now 13:55 UTC.
- **Rulebook `v2.0.0-live` (precision engine) became active at 13:04 UTC.** All 15 signals from today were created *before* that, under v1.8.0/v1.7.0/v1.6.0.
- **Every signal in the table is `lifecycle_state = DETECTED`, `armed_at = null`, `preferred_entry = null`, and `precision_watches` has 0 rows.** The two-stage arm → micro-trigger → ENTRY_READY path has therefore **never once executed in production**. It is untested against live data, not proven broken.
- **The real blocker right now is upstream of precision.** Candidate entry/stop derivation went to zero at a hard cutover: candidates with a derived entry per hour — 09:00 → 253/298, 10:00 → 251/296, 11:00 → 135/300, **12:00 → 0/210, 13:00 → 0/276**. Last candidate with an entry: 11:59:08 UTC. Since then every run rejects all 5 instruments with the same stack: `NO_SETUP` + `NO_SWEEP` + `NO_DISPLACEMENT` + `NO_RETEST` + `INVALID_STOP` + `RR_BELOW_MIN` (rr = null) and, since 13:04, the new mandatory `MISSING_INVALIDATION`.

I have **not** confirmed the root cause of that 12:00 cutover. The detection files (`setups.server.ts`, `sweep.server.ts`, `retest.server.ts`, `swings.server.ts`) were last committed at 09:23, before the drought began, so a code edit is not the obvious explanation — but a 100% detection failure across five uncorrelated instruments for two hours is not normal market behaviour either. Naming a cause now would be guessing, so step 1 of this plan is to prove it.

## Plan

**1. Prove the cause of the detection drought (before changing anything)**

Replay the exact live M15 candle series for each instrument through `detectSetup` offline and print the intermediate results — swings found, sweep found, displacement ATR, retest — for the current bars and for 08:00–09:00 bars (when detection worked). Two possible outcomes:
- *Inputs are fine, detectors return nothing* → real logic regression; fix the detector.
- *Inputs are degraded* (too few candles, stale/duplicate bars, wrong timeframe, ATR null) → fix the data path in `run.server.ts` / `market-data.server.ts`.

Also compare candle counts and last-bar timestamps per instrument now vs earlier today.

**2. Fix whatever step 1 identifies**, with a regression test built from the actual replayed candles so this exact drought cannot return silently.

**3. Make the precision stage observable and prove it end to end**

Right now a setup can be armed and die without leaving any trace of why. Add:
- Persisted per-watch evaluation reasons (near-entry distance in points, extension in R, which micro-trigger step failed, R:R at check time) written on each precision pass.
- A **"Execution funnel"** panel on Scanner Health: detected → armed → micro-triggered → entry-ready → alerted, for today, with the top blocking reason at each stage. This is the panel that answers "why no alert" in one glance.
- A replay harness that forces one real armed setup through the loop so the arm → trigger → alert path is verified once against live data rather than only in unit tests.

**4. Re-tune the precision thresholds once the funnel shows real data**

The v2.0.0 defaults are extremely tight and, stacked, may make ENTRY_READY practically unreachable: proximity 5 points on EURUSD/USDJPY (half a pip), `maxExtensionR` 0.15, a full closed-M1 rejection → displacement → BOS → held-retest sequence, mandatory structural invalidation, R:R ≥ 2 at trigger time, all inside a 30-minute armed window. I will not loosen these blindly — I will publish a new rulebook version only after the funnel shows which condition is actually eliminating watches, and every change ships as a versioned rulebook with a checksum, as usual.

**5. Safety net**

- Alert if a full trading session passes with armed setups but zero ENTRY_READY (the "silently unreachable" case), reusing the existing system-health alert with cooldown.
- Keep the audit trail: no purge of the new precision reasons before 24h.

## Guardrails held throughout

Read-only MT5 access, no execution endpoint, fail-closed on uncertainty, frontend renders stored values only, and every rule change goes out as a new versioned rulebook.

## Technical notes

- Cutover evidence: `signal_candidates` entry-derivation drops to 0 at 12:04 UTC; scanner run gap 12:00–12:04 indicates a deploy at that moment.
- `run.server.ts:490–539` — entry now comes solely from `entryAnchorForSetup`; when `setup.found` is false, `anchor`, `zone`, `entry`, `stop` and `rr` are all null, which is exactly the null pattern in the table. Consistent with "no setup found", not proof of a derivation bug.
- `run.server.ts:832–882` — arming and `openPrecisionWatch` are correctly wired; they simply have never been reached since 13:04 because nothing qualified.
- `precision.server.ts` runs inside the same one-minute cron invocation and is a no-op with zero watches, so it is currently invisible.
