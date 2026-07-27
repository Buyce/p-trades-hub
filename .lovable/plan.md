## Goal

Record the Master Handoff as the governing product and trading document, with the MetaApi + Lovable Cloud architecture overriding its local-backend sections. No application code, database schema or scanner behaviour changes in this step. Shadow mode stays on and alerts stay suppressed.

## Authority order to be written down

1. MetaApi + Lovable Cloud migration plan (architecture)
2. Master Handoff non-negotiable trading and security rules
3. Phased build prompts
4. Current code function map (reference only)

## Superseded, recorded as never-to-implement

Local Windows Python scanner as production backend; FastAPI as production API; Cloudflare Tunnel; `P_TRADES_API_BASE_URL`; `P_TRADES_API_TOKEN`; local SQLite as the cloud database; external Python-to-Lovable ingestion.

Current architecture of record:

```text
MT5 account -> MetaApi Cloud (read-only) -> scan-markets server route (pg_cron, 1/min)
  -> Postgres (candidates, rejections, signals, runs, heartbeats) -> P-Trades Dashboard
```

## Files to be written

- `mem://index.md` — Core rules: read-only assistant, never place trades, no client-side signal calculation, no B-grade as actionable, 0–2 actionable alerts per UTC day, min 2.0R at TP1, shadow mode on, dark institutional style, no casino visuals.
- `mem://architecture/cloud-scanner` — the flow above, the superseded list, secret names in use (`METAAPI_TOKEN`, `METAAPI_ACCOUNT_ID`, `METAAPI_REGION`, `P_TRADES_INGEST_SECRET`), and the read-only GET-only allowlist rule.
- `mem://trading/rulebook` — instruments and timeframe model, candle rule, setup families (implemented vs planned), the 14 hard rejection gates, score weights, grade bands, fail-closed principle.
- `mem://trading/journal-performance` — required candidate/decision/trade fields and the full analytics list, marked as target state.
- `mem://constraints/never-do` — the "Lovable must never" list from section 24.
- `docs/PROJECT_KNOWLEDGE.md` — human-readable consolidation of the above, with an explicit "superseded sections" table so the original handoff can still be read safely.
- Security memory updated to state: read-only market assistant, no trade endpoint may ever exist, MetaApi credentials are server-only, MT5 access is investor/read-only.

## Known conformance gaps to be recorded (not fixed in this step)

Written into the knowledge doc as an open backlog so the next build has a checklist:

- Grade bands in code (`A+ 90 / A 80 / B 70`) differ from the handoff (`A+ 95–100 / A 90–94.99 / B 80–89.99`).
- Session filter gate is not implemented; the other 13 gates are.
- Setup families 7.3 and 7.4 (GBPAUD models) are not implemented.
- No `/signals` list route yet, though navigation calls for a Signals tab.
- Watchlist lacks bid/ask, spread, regime, news-lockout and freshness fields.
- Trades table lacks planned-vs-actual, partials, stop modifications, MAE/MFE, followed-plan and mistake tags; performance analytics cover a subset of the required list.
- Macro/news provider and notification delivery are not yet wired.

## Verification

Read back each written file, confirm the superseded list contains no live references in code (`grep` for `P_TRADES_API`, `fastapi`, `cloudflare`), and confirm no schema or scanner file was touched.
