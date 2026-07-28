**What I found**

The terminal/backend is connected and scanning all watched instruments. The problem is in the new precision-engine release path:

- The market-data account is connected and deployed.
- Scans include all watched symbols: `XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY`.
- Shadow mode is off and daily caps are unlimited.
- The active rulebook is `v2.0.0-live`.
- Since the precision update, there are **zero `precision_watches`**, so the M1 precision loop has nothing to evaluate and cannot create alerts.
- Current scans now stop at `NO_SETUP` for every instrument.
- Older signals in the last 6 hours still show `lifecycle_state = DETECTED` and `is_actionable = true`, which means those were created by the old immediate-alert path before the precision handoff was fully active.
- Recent runs are also timing out because the cron job fires every minute while a scan + precision loop can run longer than one minute, creating lock congestion.

**Likely root cause**

The v2 precision implementation made setup detection too strict and/or put the precision handoff behind the old fully-qualified gate. A setup must pass the whole old M15 gate stack before it can even be armed, so the new execution engine never receives setups. In other words: the app is not broken at connectivity level; the new logic is stuck before `ARMED`.

**Plan**

1. **Separate “armable setup” from “actionable alert” correctly**
   - Update the scanner so M15 setup detection can create an `ARMED` signal/watch when the structural setup is valid enough to monitor.
   - Keep actual alerts locked to `ENTRY_READY` only.
   - Do not notify, email, or mark actionable at M15 setup detection time.

2. **Stop using old execution gates to block arming**
   - Keep these as arming requirements: session, required data, candle sanity, freshness, news, setup found, direction/bias sanity, structural invalidation, valid stop, non-duplicate.
   - Move execution-timing requirements fully into the precision loop: near entry, M1 trigger, M1 retest, TP1 still >= 2R, spread at execution, target not already touched, expiry, daily cap.

3. **Fix scan runtime/cron congestion**
   - Reduce the precision loop budget inside the minute cron invocation so one run is less likely to overlap the next run.
   - Keep the lock TTL aligned with the actual scan budget.
   - Ensure skipped overlapping ticks do not create misleading “no alerts” telemetry.

4. **Repair lifecycle consistency**
   - Ensure live signals created by the new engine start as `ARMED`, not old-style `DETECTED/is_actionable=true`.
   - Only `markSignalEntryReady` can flip a signal to `ENTRY_READY` and notify users.
   - Preserve read-only safety: no trade execution endpoints or UI.

5. **Improve diagnostics on Scanner Health**
   - Make the Execution Funnel show the real bottleneck: Detected → Armed → M1 Triggered → Entry Ready → Notified.
   - Surface the top blocking precision gates from watch metadata once watches exist.
   - Keep “No setup” telemetry for market droughts, but distinguish it from engine failure.

6. **Validate with targeted tests and live data checks**
   - Add/update scanner tests proving a valid M15 setup creates a precision watch instead of alerting immediately.
   - Add/update tests proving a watch only alerts after the M1 precision conditions pass.
   - After implementation, verify database counts move from `0 precision_watches` to actual `ARMED`/`MICRO_TRIGGERED`/`ENTRY_READY` states before claiming the issue is fixed.

**Expected outcome**

After publishing the fix, the scanner should begin arming valid setups again. Alerts will still be selective because `ENTRY_READY` requires M1 confirmation, but the system should no longer sit at zero watches/zero alerts because the precision loop never receives work.