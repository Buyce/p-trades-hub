## Confirmed production diagnosis

- **MetaApi is connected, but unstable under the current request pattern.** The account is deployed and reports `CONNECTED`, and one sync completed successfully across all five instruments. The next sync exceeded its deadline with repeated M5/H4/D1 timeouts; live spread reads and Precision M1 reads are also timing out.
- **The database activation flags are wrong.** `v1.8.0-live` is marked `is_active = true` even though its status is `RETIRED`; `v2.1.0-live` is marked `is_active = false` even though its status is `ACTIVE`. The scanner loads by `is_active`, so it is genuinely executing v1.8.0. The `scanner_settings` row saying v2.1.0 does not override that query.
- **The terminal has produced no new notification since July 28.** Recent context runs scan all five enabled instruments, but emit zero signals. Two current watches are ARMED, while Precision has not promoted either because price is far from entry, no closed-M1 trigger/retest exists, and the watches are already beyond their extension limit.
- **The three schedulers are active**, but they all fire on the same minute boundary. Market sync, context evaluation, and Precision therefore contend for the same MetaApi account/resource slot. This explains the intermittent timeout bursts and skipped/late passes.
- Recent context rejections are all `NO_SETUP`; this is valid for the current M15 bars and will not be “fixed” by weakening thresholds.

## Repair plan

1. **Correct rulebook governance atomically**
   - Deactivate every rulebook row, then activate only `v2.1.0-live`.
   - Keep its status `ACTIVE`, mark v1.8.0 `RETIRED`, and align `scanner_settings.rulebook_version`.
   - Add a database invariant preventing more than one active rulebook and preventing a retired rulebook from being activated.

2. **Remove MetaApi scheduler contention without changing trading rules**
   - Stagger sync, context, and Precision execution so they do not start simultaneously.
   - Keep market sync as the sole historical M5/M15/H1/H4/D1 downloader.
   - Make Precision consume stored M1 data where appropriate and perform only the minimum live quote read needed for entry timing.
   - Ensure failed upstream requests stop within the job budget instead of continuing after timeout and congesting the next minute.

3. **Make market-data health truthful per instrument/timeframe**
   - Record successful fetch, fallback use, timeout, candle age, and provider latency separately.
   - Do not report MetaApi healthy solely because account metadata is connected.
   - Surface partial degradation when quotes work but one or more candle streams time out.

4. **Repair the lifecycle/version consistency checks**
   - Fail closed if `scanner_settings.rulebook_version`, the active rulebook row, and the loaded rulebook version disagree.
   - Include the loaded version and checksum in context and Precision heartbeats.
   - Prevent new watches/signals from mixing v1.8 and v2.1 lifecycle semantics.

5. **Verify the live pipeline before declaring recovery**
   - Confirm fresh candles for every enabled instrument and required timeframe.
   - Confirm three consecutive sync/context/Precision cycles complete without overlap or stale locks.
   - Confirm context runs show `v2.1.0-live`, all five instruments, and valid candidate/rejection telemetry.
   - Confirm Precision evaluates every open watch and expires or promotes it deterministically.
   - Validate terminal, email, and push delivery with a controlled notification transport test that does not fabricate a trading signal.
   - Report the exact remaining blocker if no genuine market setup reaches `ENTRY_READY`.

**Constraint:** no score, R:R, setup, proximity, displacement, session, or other trading threshold will be changed.