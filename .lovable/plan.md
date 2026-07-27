## Confirmed change of architecture

The secret request for `P_TRADES_API_BASE_URL` and `P_TRADES_API_TOKEN` is cancelled. New chain:

```text
MT5 account (investor / read-only password)
  -> MetaApi Cloud REST (read-only market data)
  -> Lovable Cloud scheduled server function: scan-markets (1 min)
  -> Postgres (signals, candidates, rejections, runs, heartbeats)
  -> P-Trades Dashboard (read-only display) + notifications (suppressed in shadow mode)
```

No laptop, no Cloudflare Tunnel, no Windows VPS, no external FastAPI.

## 1. Existing files that change

| File | Change |
| --- | --- |
| `src/lib/ptrades/backend.server.ts` | Deleted. Replaced by `src/lib/ptrades/metaapi/*`. |
| `src/lib/ptrades/backend.functions.ts` | Rewritten: `getScannerStatus` (heartbeat + last run + MetaApi reachability, read from DB) replaces `getBackendHealth` / `getBackendConfiguration` / `getMt5Status`. |
| `src/routes/_authenticated/dashboard.tsx` | Uses `getScannerStatus`; adds a persistent SHADOW MODE banner. |
| `src/routes/_authenticated/scanner-health.tsx` | Shows MetaApi link state, last scan run, per-symbol scan result, rejection counts. |
| `src/routes/_authenticated/watchlist.tsx` | Reads the watchlist from the DB (`instruments` table) instead of the FastAPI `/configuration` call; NAS100 shown as Disabled. |
| `src/routes/_authenticated/signals.$signalId.tsx` | Adds the pass/fail gate breakdown (why it qualified or was rejected). |
| `src/routes/api/public/ingest/signal.ts`, `heartbeat.ts` | Kept but demoted: no longer the primary path (the in-cloud scanner writes directly). Retained behind the existing shared secret for replay/backfill only. |
| `src/lib/ptrades/queries.ts` | New read adapters: candidates, rejections, instruments, scan runs. |
| `.lovable/plan.md` | Updated to the cloud-only architecture. |

Untouched: auth, `_authenticated/route.tsx`, journal, performance, rulebook, settings, primitives, app-shell, design system.

## 2. Secrets removed

- `P_TRADES_API_BASE_URL` — never created; request cancelled.
- `P_TRADES_API_TOKEN` — never created; request cancelled.
- `P_TRADES_INGEST_SECRET` — kept (replay/backfill endpoints only).

## 3. Secrets added

- `METAAPI_TOKEN`
- `METAAPI_ACCOUNT_ID`
- `METAAPI_REGION`

All three are server-runtime only, read inside handler bodies, never `VITE_`-prefixed, never returned to the browser, never written to the repo.

## 4. New database flow

New tables (migration, with grants + RLS):

- `instruments` — symbol, broker symbol, enabled flag, min RR, max spread. Seeded with XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY enabled; NAS100 inserted disabled with a null broker symbol until discovery.
- `signal_candidates` — every evaluated setup per symbol per scan: timeframe, direction, computed levels, gate results, score, grade, `qualified`, `fingerprint`, `shadow_mode`.
- `signal_rejections` — candidate id, gate code, human-readable reason (stale data, spread, late entry, duplicate, invalid stop, missing data, news lockout, RR < 2.0).
- `candles_cache` — last closed candle per symbol/timeframe, for staleness checks and to cut MetaApi calls.
- `daily_alert_counters` — `(trading_day_utc)` with actionable count, enforcing the hard 2/day cap in SQL.

Changes to existing tables: `signals` gains `candidate_id`, `fingerprint` (unique with `trading_day_utc`), and `shadow_mode`. Read policies stay authenticated-read; all writes are service-role only from the scanner.

Flow per minute: scan run row opened -> candles fetched -> candidates written -> rejections written -> qualified A/A+ promoted to `signals` (with `is_actionable=false` while shadow mode is on) -> heartbeat + run row closed.

## 5. Protecting MetaApi account data

- Only the three secrets above; read via `process.env` inside server handlers.
- All MetaApi HTTP calls live in `*.server.ts` modules, which are blocked from the client bundle; route/`*.functions.ts` files import them dynamically inside handlers.
- The dashboard never receives the account id, token, region or raw MetaApi payloads — only derived, already-stored rows.
- Instruction to you: use an MT5 **investor (read-only) password** when provisioning the MetaApi account, so trading is impossible at the broker level too.

## 6. The one-minute schedule

`pg_cron` + `pg_net` calling a public server route `/api/public/hooks/scan-markets` on the stable project URL, at `* * * * *`, authenticated with the project anon key in the `apikey` header. The handler:

- takes an advisory lock so overlapping minutes cannot double-run;
- exits early outside symbol trading sessions and during news lockouts;
- always writes a heartbeat, even on failure.

If per-step durability becomes necessary later (retries, long fan-out), the same handler can be moved behind Inngest without changing the modules.

## 7. Guarantee that no trading endpoint exists

- The MetaApi client module exposes exactly three read functions: `getCandles`, `getSymbolSpec`, `getCurrentSpread`. There is no order, position, or trade method anywhere in the codebase.
- The client is hard-restricted to a `GET`-only allowlist of MetaApi paths; any non-GET or non-allowlisted path throws before the request is made.
- A repository test asserts no source file references `trade`, `order`, `position` MetaApi endpoints, and that only the allowlist is reachable.
- The UI has no execution affordance; the dashboard states "read-only assistant, you place every trade" and shadow mode additionally suppresses alerts.

## Server-side modules to create

```text
src/lib/ptrades/scanner/
  metaapi.server.ts        read-only MetaApi client (GET allowlist)
  candles.server.ts        normalisation, closed-candle-only guard
  atr.server.ts
  swings.server.ts
  bias.server.ts           H4/D1 higher-timeframe bias
  sweep.server.ts          liquidity sweep detection
  displacement.server.ts
  retest.server.ts         breakout-and-retest
  late-entry.server.ts
  gates.server.ts          hard rejection gates
  scoring.server.ts        deterministic qualification score -> grade
  fingerprint.server.ts    duplicate suppression
  persist.server.ts        candidates, rejections, signals
  notify.server.ts         notifications (no-op while shadow mode)
  heartbeat.server.ts
  run.server.ts            orchestration for one scan
src/routes/api/public/hooks/scan-markets.ts   cron entry point
```

Rules are versioned in `rulebook_versions.rules` and read at scan time, so every stored candidate records which rulebook version judged it. The frontend computes nothing — it only renders stored rows and the stored pass/fail reasons.

## Shadow mode

A `scanner_settings` row holds `shadow_mode = true`. While true: candidates and rejections are stored and displayed, `signals.is_actionable` is forced false, and `notify` writes nothing. Leaving shadow mode is a deliberate DB flip after tests, replay tests and a security scan pass.

## What I need from you before implementation

The three MetaApi secrets, which I will request through the secure form once you approve this plan.
