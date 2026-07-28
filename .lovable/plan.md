## Goal

Automatically purge old scanner diagnostic data on a fixed retention schedule, so the database stays small without touching signals, trades, journal or notification data.

Retention (rows older than the age are deleted; recent rows always stay):

| Table | Keep | Cleanup runs |
| --- | --- | --- |
| signal_rejections | 5 hours | every hour |
| signal_candidates | 24 hours | every hour |
| scanner_runs | 3 days | daily |
| scanner_errors | 7 days | daily |

Current volume: 23,249 rejections, 3,496 candidates, 757 runs, 133 errors in ~15 hours — so the first run will remove most of it.

## Important detail: linked records

These tables reference each other:
- `signal_rejections.candidate_id` → `signal_candidates`
- `signal_candidates.scanner_run_id` → `scanner_runs`, and `signals.scanner_run_id` / `signals.candidate_id` also point at them.

So the cleanup cannot simply delete parents. The job will detach links before deleting (set the reference to empty), and deletion order is rejections → candidates → runs. Promoted **signals stay forever** — only the diagnostic breadcrumb behind them is dropped. A signal detail page will still show its stored reasons, gates and score; it will just no longer link back to a deleted run row.

## Technical implementation

1. Migration: create `public.purge_scanner_diagnostics(retain_rejections interval, retain_candidates interval, retain_runs interval, retain_errors interval)` as a `SECURITY DEFINER` function that:
   - deletes `signal_rejections` older than the cutoff,
   - nulls `signals.candidate_id` for expiring candidates, then deletes `signal_candidates`,
   - nulls `signals.scanner_run_id` / `scanner_errors.scanner_run_id` for expiring runs, then deletes `scanner_runs`,
   - deletes `scanner_errors` older than the cutoff,
   - writes one summary row to `audit_log` (`actor_kind: 'system'`, `action: 'SCANNER_DIAGNOSTICS_PURGE'`) with per-table deleted counts.
   - Execute revoked from `public`/`anon`; callable by service role only.
2. Insert step (pg_cron, not a migration since it is environment data):
   - `ptrades-purge-hourly` at `7 * * * *` → purges rejections (5h) and candidates (24h).
   - `ptrades-purge-daily` at `20 3 * * *` UTC → purges runs (3 days) and errors (7 days).
   - Both call the SQL function directly — no HTTP endpoint, no new secret.
3. Health visibility: add a "Data retention" line to `scanner-health.tsx` showing the retention windows and the last purge time/counts read from `audit_log`.

No frontend business logic, scanner rules or trading behaviour change.

## Verification

- Run the function once manually with the configured intervals and confirm counts drop to the retention window.
- Confirm `signals`, `trades`, `signal_decisions`, `notifications` row counts are unchanged.
- Confirm both cron jobs appear in the schedule list and their next executions succeed.
