## P-Trades — Build Programme 5–15 Roadmap

One phase per turn. Every phase begins with the mandatory audit (files, functions, DB objects, duplicates) and ends with the mandatory report naming real files, functions, tables, policies and tests. Shadow mode stays on until Phase 15 explicitly clears it. No trade-execution path is ever added.

### Ground rules for every phase
- The TypeScript cloud scanner is the only live engine. Python is reference/replay only, delivered as an export under `handoff/python-reference/` for manual transfer to `Buyce/P-Trades`; never wired to production MetaApi or scheduling.
- Keep the current `src/lib/ptrades/*` layout and enforce the documented boundaries inside it instead of moving to `src/domain`, `src/data`, `src/services`: no direct backend calls in pages, one repository module per domain, one typed `AppError`.
- Fail closed. No invented data, no mock fallback in production.
- Reuse before adding. A second implementation of an existing function or table counts as a defect.

### Three conflicts to settle before Phase 7 code
The prompts contradict decisions already locked into the codebase and tests:

| Item | Prompt 7 says | Current code (tested) |
| --- | --- | --- |
| ATR | Simple moving average | Wilder smoothing |
| Confirmed swing window | 3 candles each side | 5 |
| Setup family names | `LIQUIDITY_SWEEP_REVERSAL`, `BREAKOUT_RETEST_CONTINUATION`, `BEARISH_PULLBACK_CONTINUATION`, `SUPPORT_BREAK_RETEST` | `SWEEP_DISPLACEMENT_RETEST`, `PULLBACK_CONTINUATION`, `BREAK_RETEST` |

Proposed resolution: make all three rulebook-driven rather than hard-coded (`atr_method`, `swing_window`, family registry), default them to the current tuned values so live behaviour does not change, and adopt the prompt's four-family naming with a data migration of stored `setup_type` values. Confirmed with you at the start of Phase 7.

---

### Phase 5 — Auth, database, RLS, shared contracts, Python models
- Audit table of every table, policy and helper function; flag duplicates and obsolete objects.
- Reconcile schema against the prompt's required list. Candidate gaps: `scanner_errors`, `audit_log`, signal constraints (direction/grade/status enums, score 0–100, `qualified` only for A/A+), trade planned-vs-actual and mistake-tag columns.
- Add `is_admin()` alongside `is_staff()`/`has_role()`, or consolidate to one helper.
- Prove browser immutability of scanner data with regression tests.
- Create `contracts/*.schema.json` (candle, market-snapshot, rulebook, candidate, signal, scanner-result, macro-event, trade); TypeScript validates against them.
- Export `handoff/python-reference/` skeleton with Pydantic models and contract tests.

### Phase 6 — Data access, adapters, normalisation
- Consolidate backend reads behind repository modules (`signals`, `decisions`, `trades`, `health`, `rulebooks`). Pages call services, never the backend client.
- One `AppError` shape; one time utility module (`toUtcIso`, `formatInUserTimezone`, `getUtcDayBoundary`, `isClosedCandle`); one symbol mapper backed by `instruments`.
- One server-side candle normaliser; malformed candles rejected and recorded.
- Shared fixtures under `fixtures/` consumed by both TypeScript and Python tests.
- Mock adapter isolated and provably inert in production.

### Phase 7 — MetaApi read-only adapter + feature engine
- Single `ReadOnlyMarketDataClient` interface; no raw SDK object escapes the adapter; timeouts, safe-read retries, redacted errors.
- Grep report for `order|trade|position|closePosition|create*Order|modifyPosition|cancelOrder`, each match classified safe/obsolete/prohibited.
- Consolidate feature functions into one folder with the prompt's naming; remove duplicate indicator implementations.
- Golden fixtures under `fixtures/golden/*` shared with the Python reference core.

### Phase 8 — Setup builders, gates, scoring, scheduler, replay
- Four setup builders behind one `SetupBuilder` interface; documented call graph; obsolete branches removed.
- One authoritative hard-gate function covering all 15 listed gates, storing passes and failures.
- Verify and lock scoring weights and bands (20/20/15/15/15/10/5; 95/90/80) by test.
- Scheduler flow verified against the existing lock and atomic daily-slot claim.
- Python replay engine export with the 11 golden scenarios; TypeScript and Python must agree.

### Phase 9 — Journal, trade events, decisions, reconciliation
- Extend `trades` with planned vs actual entry/stop, partial exits, followed-plan flag, mistake tags; add the seven trade-event types with stop-widening detection.
- One authoritative result-in-R function; MAE/MFE return null when no price path exists.
- Read-only reconciliation contract for MetaApi historical deals; suggestions only, user confirms.
- Journal filters and CSV export in UTC.

### Phase 10 — Performance engine
- Metric-definition table first, then one canonical implementation per metric (server-side or SQL view).
- Add missing analytics: session, day-of-week, time-of-day, taken vs skipped, late-entry cost, premature-exit cost, mistakes.
- Sample-size guardrails: `<10 Insufficient sample`, `10–29 Preliminary`, `30+ More reliable`.

### Phase 11 — Health and rulebook governance
- Full health surface (MetaApi, last candle per symbol/timeframe, run, lock, schedule, providers, mode, rulebook version) with admin-only refresh and single shadow scan.
- Rulebook lifecycle with checksum; every signal stores version + checksum; remove hard-coded trading constants in favour of rulebook values.

### Phase 12 — Notifications
- Four alert types, explicit suppression list, shadow-mode records marked `suppressed_shadow_mode` with the exact payload that would have been sent.
- Deduplication on fingerprint + type + channel + cooldown, enforced by a unique constraint.
- Management actions KEEP / MOVE_STOP / TAKE_PARTIAL / EXIT_EARLY / CANCEL; never suggests widening a stop.
- Preferences: in-app, email/web-push placeholders, quiet hours, symbol filters.

### Phase 13 — Testing, security, parity, duplicate elimination
- Unit, integration, replay, RLS and end-to-end layers; duplicate and dead-code sweep; secret-in-bundle scan; security scan run and findings resolved.

### Phase 14 — Repository structure, Python handoff, CI
- Finalise `handoff/python-reference/` with pyproject, tests and transfer instructions; CI running typecheck, lint, tests and parity fixtures.

### Phase 15 — Production readiness and live-alert decision
- Final consistency audit and readiness checklist. Shadow mode is turned off only on your explicit instruction, never automatically.

---

### Technical notes
- Migrations follow the required order: `CREATE TABLE` → `GRANT` → `ENABLE RLS` → policies. New scanner-internal tables (`scanner_errors`, `audit_log`) are service-role write, staff read.
- Setup-family renaming needs a data migration for existing `signal_candidates.setup_type` and `signals.setup_type` rows; historical rows are remapped, not deleted.
- The Python export cannot be pushed to `Buyce/P-Trades` from here; each phase reports "generated for manual transfer" with the file list.
- Each phase ends with the full test suite run and the numbers reported (currently 158 passing).

### Suggested start
Phase 5, then stop for your review before Phase 6.
