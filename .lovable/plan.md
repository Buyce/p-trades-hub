## Confirmed production diagnosis

This is a runtime failure, not a lack of market setups and not a precision-threshold problem:

- The hosted backend and database are healthy, and all three scheduled jobs fire every minute.
- `sync-market-data` requests are being terminated with no HTTP response. No candles have been stored since about **14:51 UTC**; M1 data is now roughly **108 minutes stale** across all five instruments.
- Context runs repeatedly remain `RUNNING` until the **110-second lock TTL**, are then marked `TIMEOUT`, and the following tick is `SKIPPED`. The latest completed context scan was about an hour ago.
- Precision is healthy but `IDLE` with **zero watches**, so it has nothing that can become `ENTRY_READY` and nothing to alert.
- The immediate code defect is nested queueing and timeouts:
  - Sync launches five M1 operations concurrently, while the provider transport serializes every request.
  - Timed-out callers do not cancel the queued provider request, and M1 retries enqueue additional abandoned work.
  - Both sync and context call live symbol-resolution APIs despite the intended durable-store boundary. In a stateless invocation, the in-memory symbol cache does not protect later runs.
  - Context defines a 50-second budget but does not enforce it in its instrument loop.

## Repair plan

1. **Make context analysis fully provider-independent**
   - Use each instrument’s configured `broker_symbol` directly when reading `market_candles`.
   - Fail closed with one clear mapping error when a broker symbol is absent; do not call provider symbol/spec/list endpoints from context.
   - Preserve all current setup, score, tier, R:R, gate, and precision rules unchanged.

2. **Replace the leaking market-data request queue**
   - Propagate an `AbortSignal` through the read-only market-data client into the provider `fetch`, so a timeout cancels the actual request rather than leaving it queued.
   - Remove stacked outer/inner retries and use one bounded request per symbol/timeframe per tick.
   - Keep provider access strictly GET-only and retain the existing endpoint allowlist.

3. **Make sync deterministic and live-data-first**
   - Refresh M1 sequentially for every enabled instrument within one explicit pass deadline; do not use `Promise.all` against a serialized provider.
   - Attempt every instrument once so one slow symbol cannot prevent the others from updating.
   - Use remaining budget for rotating M5/M15/H1/H4/D1 refreshes.
   - Always write a final heartbeat containing per-symbol status, timeout/cancellation reason, duration, and whether the pass deadline was reached.

4. **Bound context execution and lock lifetime**
   - Enforce the existing context deadline between instruments and finish the run as `PARTIAL` with completed/pending symbols instead of allowing the worker to be killed.
   - Align the context lock lease with the one-minute cadence so an abandoned pass cannot force alternate-minute skips.
   - Coalesce stale-store diagnostics instead of awaiting multiple repetitive error inserts per timeframe and instrument.
   - Ensure every exit path finishes the run, reports a heartbeat, and releases its owned lock.

5. **Strengthen operational alerts**
   - Treat fresh `SKIPPED` heartbeats without a recent completed pass as a failure, not healthy liveness.
   - Alert owners/admins when candle storage stops advancing, context has no completed pass, or a lock overruns.
   - Keep the existing cooldown to prevent notification spam.

6. **Add regression coverage**
   - Test that timed-out provider calls are aborted and cannot continue consuming the serialized queue.
   - Test that context performs zero provider calls.
   - Test fair M1 scanning when one instrument times out.
   - Test deadline-driven `PARTIAL` completion, lock release, and no alternating `TIMEOUT`/`SKIPPED` cycle.
   - Test watchdog detection for stale candles and fresh-but-nonprogressing jobs.

7. **Verify the repaired production funnel after publish**
   - Confirm M1 `fetched_at` advances for XAUUSD, GBPAUD, GBPUSD, EURUSD, and USDJPY.
   - Confirm sync returns an HTTP response and reports a final heartbeat every minute.
   - Confirm context completes within its budget with all five symbols, with no new `TIMEOUT` runs or lock-overrun skips.
   - Confirm candidates/rejections resume from fresh data and precision receives watches when a setup legitimately reaches `ARMED`.
   - Confirm notification channels remain ready; do not manufacture a production signal or weaken a trading gate to force an alert.