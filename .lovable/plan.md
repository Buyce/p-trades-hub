## Confirmed architectural boundaries

1. **Python/FastAPI is the only source of truth.** Market structure, qualification, entry, stop, targets, R:R, score, grade and invalidation are produced solely by the scanner.
2. **No frontend trading logic.** The app renders backend values verbatim, or renders "Unavailable" when a field is absent. No derived entries, stops, targets, grades or scores — the only computation is journal analytics over user-entered R multiples.
3. **No execution.** No order buttons, no MT5 order placement, no broker write path anywhere in the app.
4. **Lovable Cloud** provides auth, Postgres, server-side functions and secrets.
5. **Server-side only backend calls.** `P_TRADES_API_BASE_URL` and `P_TRADES_API_TOKEN` live in server secrets and are read inside server-function handlers; the browser never sees them.
6. **Separate frontend repository.** This project syncs to its own GitHub repo (`P-Trades-Dashboard`) via the Plus (+) menu → GitHub; the Python repo is untouched.

## Routes

```text
src/routes/
  __root.tsx                         app shell, head defaults, toaster
  index.tsx                          session-aware redirect → /auth or /dashboard
  auth.tsx                           invite-only sign in (public)
  _authenticated/route.tsx           client-side session gate → /auth
  _authenticated/dashboard.tsx       cockpit: link status, heartbeat, rulebook, 0/2 alerts, latest A/A+, no-trade state
  _authenticated/watchlist.tsx       instruments from scanner configuration
  _authenticated/signals.$signalId.tsx  immutable signal detail + decision capture
  _authenticated/journal.tsx         decisions + trade log
  _authenticated/performance.tsx     expectancy, win rate, R distribution
  _authenticated/scanner-health.tsx  staff-only diagnostics
  _authenticated/rulebook.tsx        active + historical rulebook versions
  _authenticated/settings.tsx        timezone, profile, sign out
  api/public/ingest/signal.ts        scanner → signal ingestion (shared-secret verified)
  api/public/ingest/heartbeat.ts     scanner → heartbeat/run ingestion
```

## Components and libraries

```text
src/components/ptrades/
  app-shell.tsx      mobile bottom tabs + desktop sidebar
  primitives.tsx     SectionCard, DataRow, StatTile, StatusPill, GradeBadge,
                     DirectionTag, EmptyState, PageHeader
src/lib/ptrades/
  format.ts          field()/num()/rr()/score()/formatTime() — "Unavailable" fallbacks, tz rendering
  queries.ts         TanStack Query adapters over the cloud DB + journal analytics
  session.ts         session, profile timezone, staff-role hooks
  backend.functions.ts  server functions: health, configuration, MT5 status
  backend.server.ts     server-only fetch wrapper holding base URL + token
```

## Database tables (Cloud, RLS enabled)

`profiles`, `user_roles` (owner/admin/trader), `rulebook_versions`, `scanner_runs`, `signals`, `signal_decisions`, `trades`, `trade_events`, `macro_events`, `system_heartbeats`, `notifications`.

Access rules:
- Signals, rulebook, heartbeats and macro events are readable by any signed-in user and never writable from the browser.
- Scanner runs are readable by owner/admin only.
- Decisions, trades, trade events, notifications and profile are scoped to the owning user for both read and write.
- Roles live in a separate `user_roles` table checked through security-definer helpers, never on the profile.

## Data-access boundaries

| Path | Client | Credentials |
| --- | --- | --- |
| Read signals/journal | browser Supabase client | user session, RLS enforced |
| Write decisions/trades | browser Supabase client | user session, own rows only |
| Backend health/config/MT5 | server functions | server-only API base URL + token |
| Scanner → app ingestion | public API routes | shared ingestion secret verified server-side, privileged write after verification |

## Technical notes

- Design system: dark-first institutional OKLCH tokens in `src/styles.css`, IBM Plex, tabular figures, 44px+ tap targets, semantic green/red only.
- Grade enum is `A_PLUS | A | B`; B records are journal-only and can never surface as alerts. Daily actionable count renders as `n/2`.
- Timestamps are stored UTC and rendered in the profile timezone.
- One outstanding schema item before decisions ship: a unique constraint on `signal_decisions (user_id, signal_id)` so a user's decision updates in place.

## Current state

The migration, design system, data/format/session libraries, shell primitives and several screens already exist from the initial scaffold. On approval I will finish the remaining screens (rulebook, settings, ingestion routes), add the unique constraint, and align everything with this structure.
