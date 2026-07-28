## Audit of the recent scanner data

Verified against the live database (630 finished runs, 3,088 candidates, 21,853 rejections):

| Finding | Evidence | Verdict |
| --- | --- | --- |
| **Zero alerts have ever been issued** | `signals` table: 0 rows, in 630 runs | Bug |
| **DUPLICATE gate poisons every setup** | 2,671 DUPLICATE rejections; the check reads `signal_candidates`, and a candidate row is written for every instrument on every minute, so from the 2nd minute onward the fingerprint always exists. Not one candidate in the whole table has zero failing gates. | Critical bug — this alone makes an alert mathematically impossible |
| **Hard-coded 4× ATR stop cap** | Best-scoring candidate (EURUSD, score 92.5, RR 2.00) rejected with `INVALID_STOP: stop distance exceeds 4x ATR` (14.6 pips vs 3.4 pip M15 ATR) | Rule not in the rulebook contract, violating the "no trading constant outside the rulebook" mandate |
| **Grades assigned to setups that failed hard gates** | 137 A-grade and 297 B-grade candidates, all with failing gates; score credits RR/structure even when the stop is invalid | Misleading labels |
| **51 runs stuck in `RUNNING`** | Concentrated at 23:00–01:00 UTC; never got a `finished_at` | Worker timeout — run row is never closed even though the lock TTL expires |
| **B grade is dead weight today** | 297 B candidates, none can ever alert (`qualified` requires A/A+) | Motivates the tier work below |
| **Rulebook v1.4.0-live has no `grades` block** | `rules->'grades'` is null; code silently falls back to defaults 95/90/80 | Silent config drift |
| Correct behaviour confirmed | Session windows, stale-data budget (feed + one M15), spread, sanity and macro gates all fire with sane reasons; read-only mandate intact (no execution code paths) | OK |

## What I'll build

### 1. Scanner correctness fixes
- **Duplicate scoping**: fingerprint uniqueness moves off "any candidate seen today" onto *promoted signals* for the day (plus a short re-evaluation cooldown), so a setup that improves over subsequent minutes can still alert once.
- **Stop sanity into the rulebook**: `max_stop_atr_multiple` becomes a rulebook field (default 4, contract + Python reference updated) instead of a magic number in `gates.server.ts`.
- **Honest grading**: a candidate that fails a hard gate is stored with its score but is not labelled with a tradable tier; the UI shows "rejected" rather than a tier badge.
- **Stuck runs**: any `RUNNING` run older than the lock TTL is closed as `TIMEOUT` at the start of the next scan, and the existing 51 rows are backfilled.
- **Rulebook completeness**: publish `v1.5.0-live` carrying explicit grade bands and the new tier config, so nothing relies on code defaults.

### 2. B and C tier alerts (all watched instruments)
Tier model, per your choice — same hard safety gates for every tier, **C relaxes reward-to-risk only**:

```text
A+  score >= 95   RR >= 2.0
A   score >= 90   RR >= 2.0
B   score >= 80   RR >= 1.5
C   score >= 70   RR >= 1.2
```

All tiers must still pass: data present, candle sanity, freshness, session, spread, news lockout, bias alignment, valid stop, late entry, expiry, duplicate. Fail-closed is unchanged. Per-tier daily caps (A-family keeps the 30 cap; B and C get their own caps so lower tiers can't flood the terminal). `C` is added to the `signal_grade` enum and threaded through contracts, Python reference, scoring, persistence and the UI badge.

### 3. Tier controls for the user
- **Settings** — persisted per-user opt-ins: which tiers arrive by **email** and which by **push**, as A+/A/B/C toggle buttons.
- **Terminal** — A+/A/B/C filter chips on Dashboard, Watchlist and Signals; a saved default per user plus instant client-side filtering.
- Notification fan-out reads the per-user tier opt-ins, so a user who only wants A+ gets only A+ emails while the terminal still shows everything they enabled.

### 4. Correct tier labelling everywhere
One shared tier helper drives the badge text, colour and email subject/heading, so the tier shown in the terminal, the push title, and the email body always come from the stored `grade` on the signal row — never recomputed on the frontend.

## Technical notes
- Migration: extend `signal_grade` enum with `C`; add `alert_tiers_email`, `alert_tiers_push`, `alert_tiers_terminal` (text arrays) to `profiles`; add `tier` to `daily_alert_counters` with a composite key so caps are per-tier; insert rulebook `v1.5.0-live` and retire `v1.4.0-live`; backfill stuck `scanner_runs`.
- `claim_actionable_slot` becomes tier-aware (`_tier`, `_max`), still atomic and fail-closed.
- Touched code: `scoring.server.ts`, `gates.server.ts`, `run.server.ts`, `persist.server.ts`, `notify.server.ts`, `alert-email.server.ts`, `types.ts`, `format.ts`, `profile.repo.ts`, `settings.tsx`, `dashboard.tsx`, `watchlist.tsx`, `signals.$signalId.tsx`, `contracts/*.json`, Python reference models.
- Tests: new cases for tier bands, per-tier RR, duplicate scoping, rulebook-driven stop cap, tier-filtered notification fan-out; existing 304 Vitest + 19 pytest suites must stay green.
- After deploy I'll re-query `signals`, `signal_candidates` and `scanner_runs` to confirm alerts actually fire and that stuck runs stop accumulating.
