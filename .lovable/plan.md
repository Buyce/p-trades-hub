## Short answer

Your MetaApi settings are fine. The scanner is not broken by configuration — the version of the scanner that actually runs every minute is **an older build than the code in this project**, so none of the tier/duplicate fixes are live yet.

## Evidence (from your database, not assumptions)

- `signals` table: **0 rows, ever**. 3,279 candidates in the last 3 days, **0 qualified**.
- A GBPUSD candidate at 08:02 today passed every gate except two, and was graded `B` while `qualified = false`. Current code can never do that — it stores `grade = null` when a candidate is not qualified. So the running build is older.
- That same candidate's reward-to-risk gate recorded `minRr: 2`. The active rulebook `v1.5.0-live` stores `tier_min_rr = {A+ 2.0, A 2.0, B 1.5, C 1.2}`, and current code gates on the **lowest** floor (1.2). A hard `2.0` is exactly what the pre-tier build used. **This is why no B or C alert can ever fire** — every B/C setup is killed by an A-tier R:R floor.
- `DUPLICATE` is the #1 rejection (2,671 in 3 days) even though zero signals have ever been promoted. Current code scopes duplicates to promoted `signals`; the running build still scopes to `signal_candidates`, so every setup is "a duplicate of itself" one minute after it appears.
- The cron job posts every minute to the **preview** URL (`...-dev.lovable.app/api/public/hooks/scan-markets`), which serves the last built preview deployment — that build predates the tier work.

## Real issues that remain even after the correct build is live

1. **Late-entry gate is very tight.** `late_entry_max_atr_from_entry = 0.5`. Today's fully-valid GBPUSD short was rejected at 2.04 ATR; other rejections show 3.36 ATR. On M5 with a 1-minute scan cadence, price routinely travels >0.5 ATR before the retest candle closes. 957 rejections in 12h come from this alone.
2. **MetaApi timeouts.** 132 `TIMEOUT` errors (`getCandles timed out after 15000ms`) and 50 scanner runs ended in `TIMEOUT` status. Your account has **1 resource slot** and you are pulling 5 timeframes per symbol every 60 seconds. This is a throughput limit, not a code bug.
3. **Stale-data budget is inconsistent.** Some rejections show `maxAge: 180` (rulebook default) against 966s-old data, others show `maxAge: 1080` (per-instrument override). Instruments without `max_data_age_seconds` set are being judged on a budget shorter than one M15 candle.
4. **`rulebook_checksum` is null on every run and on the active rulebook row** — the governance/traceability trail is not being written.

## Proposed fix, in order

1. **Publish the app** so the current scanner build actually serves the cron endpoint, then verify against live data that a fresh candidate records `minRr: 1.2` and that `DUPLICATE` stops firing while `signals` is empty. This alone should unblock B and C alerts.
2. **Relax the late-entry gate** in rulebook `v1.6.0-live` from `0.5` to a value that matches M5 reality (proposed `1.5` ATR), keeping every other hard gate untouched. Scoring already penalises late entries, so late setups will land in B/C rather than A.
3. **Reduce MetaApi load**: fetch D1/H4 less often than every minute (cache them), and raise the candle fetch timeout with one retry. Optionally raise resource slots to 2 on the MetaApi side.
4. **Backfill `max_data_age_seconds` per instrument** to `entry timeframe duration + feed budget`, so no symbol is judged on a 180s budget.
5. **Write the rulebook checksum** on every run and backfill it on the active rulebook row.
6. Add a **daily "why nothing alerted" summary** on Scanner Health: top blocking gate per instrument, so this is visible without querying the database.

## Technical notes

- Steps 2, 4 and 5 are database migrations (a new rulebook version row plus instrument updates); the scanner reads the rulebook from the database, so no code change is needed for the gate values themselves.
- Step 1 requires no code change at all — it is a deployment step, and it is the single largest cause of the symptom you reported.
- Nothing in this plan adds, or moves toward, any trade-execution path. All MetaApi access stays on the read-only allowlist.
