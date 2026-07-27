# P-Trades — Project Knowledge

Consolidated reference for the P-Trades Dashboard. This document, together with
the project memory files, governs how the system is built.

## 1. Authority order

1. **MetaApi + Lovable Cloud architecture** — decides how the system is wired.
2. **Master Handoff non-negotiable trading and security rules** — decides what
   the system is allowed to do.
3. **Phased build prompts** — decide sequencing.
4. **Current code function map** — functional reference only; it never overrides
   1–3.

Source document: `P-Trades_Lovable_Master_Handoff.md`.

## 2. What P-Trades is

A read-only MetaTrader 5 market scanner, discretionary trade assistant and
performance engine. It automates market-data input and the repeatable parts of
analysis while the user keeps the final decision. It never places a trade.

> We do not get paid for activity. We get paid for precision.

A day with no trade is a correct outcome when no A-grade opportunity exists.

## 3. Architecture of record

```text
MT5 account (investor / read-only password)
  -> MetaApi Cloud REST API (GET only, path allowlist)
  -> /api/public/hooks/scan-markets   (pg_cron, once per minute)
  -> Postgres (Lovable Cloud)
       candles_cache, scanner_runs, signal_candidates, signal_rejections,
       signals, daily_alert_counters, macro_events, system_heartbeats,
       notifications, instruments, rulebook_versions,
       profiles, user_roles, signal_decisions, trades, trade_events
  -> P-Trades Dashboard (renders stored data only)
```

Nothing depends on a laptop, Windows VPS or tunnel being online.

Secrets: `METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, `METAAPI_REGION`,
`P_TRADES_INGEST_SECRET`. Server-side only.

## 4. Superseded sections of the Master Handoff

These parts of the handoff are historical context and must not be implemented.

| Handoff section | Superseded item | Replacement |
| --- | --- | --- |
| 2, 16, 20 | Local Windows Python scanner as production backend | Cloud `scan-markets` server route |
| 17, 18 | FastAPI as the production API | TanStack server functions and server routes |
| 20 | Cloudflare Tunnel | Not needed; no inbound path to a laptop |
| 19, 20 | `P_TRADES_API_BASE_URL`, `P_TRADES_API_TOKEN` | `METAAPI_*` secrets |
| 16 | Local SQLite as the main database | Lovable Cloud Postgres |
| 19 | External Python-to-Lovable ingestion | In-app scanner writes directly |

Everything else in the handoff — trading methodology, qualification rules,
journal requirements, performance requirements, security requirements,
acceptance criteria — is retained in full.

## 5. Trading rules (retained)

Instruments: XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY. NASDAQ disabled pending
symbol calibration.

Timeframes: context H4/H1 (plus D1 for GBPAUD), structure M15, confirmation M5.
Closed candles only — the forming candle is excluded.

Daily mandate: 0–2 actionable alerts per UTC day, A or A+ only, minimum 2.0R at
TP1, no chasing, no FOMO, no revenge trading, no widening stops, capital
preservation first, every decision journalled.

Hard gates, score weights and grade bands: see `mem://trading/rulebook`.
Grade bands are A+ 95–100, A 90–94.99, B 80–89.99 (journal only), reject below 80.
Any hard-gate failure rejects regardless of score. The system is fail-closed.

Journal, trade-management and analytics requirements: see
`mem://trading/journal-performance`.

## 6. Security requirements (retained)

- MT5 is accessed through MetaApi with an investor / read-only password.
- MetaApi trade endpoints are never implemented or invoked; the client enforces
  a GET-only path allowlist before any request is issued.
- No secret ever reaches browser code, GitHub, browser storage or screenshots.
- Signals and scanner data are read-only to users; journal data is private to its
  owner via RLS scoped to `auth.uid()`.
- Scanner health is restricted to owner/admin through `is_staff`.
- Auth is invite-only; public sign-up is disabled.
- The rulebook is read-only in the UI until change-control and audit history exist.

## 7. Current status

Shadow mode is ON. Signals persist with `is_actionable` false and notifications
are suppressed. The scanner runs every minute against live MetaApi data.

## 8. Open conformance backlog

Recorded, not yet implemented:

1. Grade bands in code (`A+ 90 / A 80 / B 70`) differ from the handoff
   (`A+ 95–100 / A 90–94.99 / B 80–89.99`).
2. The session-filter gate is not implemented; the other 13 gates are.
3. Setup families 7.3 and 7.4 (GBPAUD pullback continuation, support-break
   retest) are not implemented.
4. No `/signals` list route yet, although navigation calls for a Signals tab.
5. Watchlist lacks bid/ask, spread, market regime, news-lockout indicator and
   data-freshness fields.
6. `trades` lacks planned-vs-actual entry/stop, partial exits, stop
   modifications, MAE/MFE in R, followed-plan flag and mistake tags.
7. Performance covers a subset of the required analytics; session, day/time,
   news-adjacent, late-entry cost, premature-exit cost and stop-widening
   frequency are missing.
8. Macro/news provider and notification delivery are not yet wired.
9. Journal CSV export is not implemented.
