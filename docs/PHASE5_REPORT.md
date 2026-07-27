# Phase 5 report — Auth, database, RLS, contracts, Python models

Date: 2026-07-27. Shadow mode unchanged (ON). No trade-execution path added.

## 1. Audit before changes

Twenty tables in `public`, all with RLS enabled. Helper functions before this
phase: `has_role`, `is_staff`, `handle_new_user`, `update_updated_at_column`,
`acquire_scanner_lock`, `release_scanner_lock`, `claim_actionable_slot`.

Findings:

| # | Finding | Action |
| --- | --- | --- |
| 1 | No `is_admin()` helper as required by the prompt | Added, `SECURITY DEFINER`, `authenticated` only |
| 2 | No `scanner_errors` table — scan failures were only console output | Created |
| 3 | No `audit_log` table | Created |
| 4 | Only 2 CHECK constraints existed in the whole schema; direction, status, outcome and score were unconstrained free text/number | Added constraints on `signals`, `signal_candidates`, `trades`, `trade_events` |
| 5 | `signals.fingerprint` had no unique index, so a duplicate promotion was possible | Unique partial index added |
| 6 | `trades` lacked planned-vs-actual, partials, mistake tags, MAE/MFE, followed-plan | 13 columns added |
| 7 | `anon` and `authenticated` held blanket INSERT/UPDATE/DELETE privileges on every table; only RLS stood between the browser and scanner data | Privileges revoked; scanner data is now SELECT-only at the grant level too |
| 8 | No shared contracts; TypeScript and any Python reference could drift silently | `contracts/*.schema.json` created as the single source of truth |

No duplicate helper functions or duplicate tables were found. `is_staff` and
`has_role` were kept; `is_admin()` is a thin owner/admin convenience over the
same `user_roles` table, not a second source of truth.

## 2. Database changes

New tables (service-role write, owner/admin read):

- `public.scanner_errors` — `scanner_run_id`, `instrument`, `stage`,
  `error_code`, `message`, `detail`, `occurred_at`. Policy
  `scanner errors staff read`.
- `public.audit_log` — `actor_user_id`, `actor_kind`, `action`, `entity_type`,
  `entity_id`, `detail`. Policy `audit log staff read`.

New constraints:

- `signals_direction_chk`, `signals_status_chk`, `signals_score_range_chk`
- `signal_candidates_direction_chk`, `signal_candidates_score_range_chk`,
  `signal_candidates_qualified_grade_chk` (qualified implies A or A+)
- `trades_direction_chk`, `trades_status_chk`, `trades_outcome_chk`
- `trade_events_type_chk` (ENTRY, STOP_MOVE, PARTIAL_EXIT, TARGET_HIT,
  MANUAL_EXIT, STOP_HIT, CANCELLED)
- `signals_fingerprint_uidx` unique partial index

Added as `NOT VALID` so historical rows are preserved while every new write is
enforced.

New `trades` columns: `planned_entry`, `actual_entry`, `planned_stop`,
`actual_stop`, `partial_exits`, `result_cash`, `followed_plan`, `mistake_tags`,
`mae_r`, `mfe_r`, `setup_type`, `grade`, `session`.

## 3. Browser immutability — verified

Privileges after the lockdown migration (`has_table_privilege`):

- `anon`: no privilege on any table in `public`.
- `authenticated` INSERT/UPDATE/DELETE: only `profiles`, `notifications`
  (update/delete only), `signal_decisions`, `trades`, `trade_events`.
- `authenticated` on `signals`, `signal_candidates`, `signal_rejections`,
  `scanner_runs`, `scanner_errors`, `scanner_locks`, `scanner_settings`,
  `system_heartbeats`, `audit_log`, `instruments`, `rulebook_versions`,
  `candles_cache`, `daily_alert_counters`, `macro_events`, `user_roles`:
  SELECT only.

Scanner data is therefore immutable from the browser at both layers: no write
grant and no write policy. `scanner_locks` and `scanner_runs`/`scanner_errors`
/`audit_log` reads remain gated on `is_staff(auth.uid())`.

Linter after the migrations: 4 warnings, all pre-existing and accepted —
`pg_cron`/`pg_net` living in `public` (required by the managed schedule) and
three `SECURITY DEFINER` helpers callable by signed-in users
(`has_role`, `is_staff`, `is_admin`), which is exactly how the RLS policies use
them. `is_admin()` execution was revoked from `PUBLIC`/`anon`.

## 4. Shared contracts

`contracts/` (draft 2020-12, `additionalProperties: false` everywhere):
`candle`, `market-snapshot`, `rulebook`, `macro-event`, `candidate`, `signal`,
`scanner-result`, `trade`.

TypeScript side: `src/lib/ptrades/contracts/validate.server.ts` compiles all
eight with Ajv and exposes `checkContract`, `assertContract` and
`ContractViolationError`. Validation is fail-closed — an invalid payload throws
rather than being coerced.

Tests: `src/lib/ptrades/contracts/__tests__/contracts.test.ts`, 22 cases,
including explicit assertions that a signal payload carrying `order_type`,
`volume` or any other execution field is rejected.

## 5. Python reference export

`handoff/python-reference/` — generated for manual transfer to
`Buyce/P-Trades`; nothing is pushed from here.

```text
handoff/python-reference/pyproject.toml
handoff/python-reference/README.md
handoff/python-reference/ptrades_reference/__init__.py
handoff/python-reference/ptrades_reference/models.py
handoff/python-reference/tests/test_contracts.py
```

`models.py` mirrors every contract as a strict Pydantic model
(`extra="forbid"`). `tests/test_contracts.py` validates the same payloads
against both the JSON Schemas and the models, so a drift between the two fails
a test. The package has no MetaApi client, no scheduler and no database writer.

## 6. Verification

- `bunx vitest run` — 180 tests passing across 16 files (158 before this phase).
- `bunx tsgo --noEmit` — clean.
- Scheduled scanner unaffected: runs at 19:37 and 19:38 UTC completed with
  status `SUCCESS`, 0 alerts, shadow mode on.

## 7. Carried into Phase 6

- `candles_cache` is unique on `(instrument, timeframe)` only, so it stores one
  row per pair rather than a candle history. Confirm this is intended when the
  normaliser is consolidated.
- The three parity conflicts (ATR method, swing window, setup-family names)
  are still unresolved and are due at the start of Phase 7.
- Nothing writes to `scanner_errors` or `audit_log` yet; wiring belongs with
  the repository/error-shape work in Phase 6.
