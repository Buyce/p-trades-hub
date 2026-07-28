## P-Trades — full audit (code, logic, data, runtime)

Everything below was verified this turn against the live database, the cron schedule and the source files. Nothing has been changed yet.

---

### P0 — Production scanner is running the preview build

`cron.job` id 1 (`ptrades-scan-markets`, every minute) posts to:

```text
https://project--4af8a9c2-...-dev.lovable.app/api/public/hooks/scan-markets
```

That is the **preview** deployment, not the published site. Consequences: the live scanner changes every time the preview rebuilds, can run half-finished code, and published fixes never take effect until the preview happens to match. This explains the earlier "live scanner still using the old 2.0 R:R floor" symptom.

Fix: repoint the cron job to the stable production host and add a heartbeat field recording which deployment answered, surfaced on Scanner Health.

### P0 — Tier C is mathematically unreachable (again)

Active rulebook `v1.7.0-live` bands: `A+ 95 / A 90 / B 80 / C 70`. Last 24h of `signal_candidates`:

| grade | count | score range | R:R range |
|---|---|---|---|
| A+ | 1 | 97.65 | 3.89 |
| A | 137 | 90.03 – 92.51 | 2.00 – 2.02 |
| B | 325 | 80.10 – 89.94 | 1.97 – 2.04 |
| C | **0** | — | — |

The R:R gate is correct (it uses the lowest tier floor, 1.2), but any setup that clears all 14 hard gates already scores ≥ 80, so the 70–80 band never fires. The Tier Reachability panel already flags dead bands; the bands themselves were never adjusted.

Fix: re-cut the bands against the observed distribution (e.g. C 70–84, B 84–90) in a new rulebook version, and make the reachability panel block activation of a rulebook with a provably dead band.

### P0 — Alert emails cannot be delivered

The only profile has `email_alerts_enabled = false` and `alert_tiers_email = [A_PLUS, A]`. Push is on for all four tiers. So the email pipeline (fixed earlier) is fine; the account is simply opted out, and even when enabled it would skip B and C. Fix: make the Settings email card state the live state unambiguously and warn when the selected email tiers exclude tiers that are enabled for the terminal.

### P1 — MetaApi reliability

132 `MARKET_DATA` / `TIMEOUT` errors in 24h (`getCandles timed out after 15000ms`) and 50 runs ending `TIMEOUT`, ~6.5% of runs. The account is a 1-slot `MetaQuotes-Demo` with 2.5s quote streaming. Fix: retry once with backoff on candle fetch, serve the previous cached candle set when a retry fails instead of failing the whole instrument, and record every fetch failure to `scanner_errors` (see below).

### P1 — Failures that never reach `scanner_errors`

- `run.server.ts:367` — `getSpread` failure is swallowed (`catch {}`), so a spread outage silently turns into mass `SPREAD` rejections with no trace.
- `symbols.server.ts:80` — symbol resolution swallows *all* exceptions, cannot tell "unknown symbol" from "network blip".
- `persist.server.ts` — every write returns `null` on failure; a failed `saveCandidate` still lets `promoteToSignal` run, producing a signal with `candidate_id: null` and no audit trail.

### P1 — Symbol-resolution cache can pin a wrong symbol

`symbols.server.ts:33` is a module-level `Map` with no TTL. On a warm worker, one transient failure on the correct broker symbol permanently caches the fallback until the process recycles. Fix: TTL + only cache successful resolutions, never fallbacks.

### P2 — Backend correctness details

- `sanity.server.ts:31-45` — a malformed candle `continue`s before `previousTime` is updated, so the next gap measurement is taken from the wrong candle (spurious or hidden gaps). This is the same family as the XAUUSD gap issue.
- `DAILY_CAP` gate runs even in shadow mode, where slots are never consumed.
- With unlimited caps, `incrementActionableCount(..., 0, bucket)` writes `max_allowed: 0`, which reads as "capped at zero" to anything querying that table.
- Lock TTL 180s vs stale-run cleanup 600s vs a 120s default — three numbers for one concept, none rulebook-governed.
- `setups.server.ts:178-183` — the "best partial" fallback can never pick a break/retest partial once any sweep exists, so rejection reasons under-report the real best setup.

### P2 — Web terminal reliability

- **No screen checks `isError`.** A failed fetch renders exactly like "nothing today" — the signal detail page even says "Signal not found" on a network/RLS error. This is the single most dangerous UI issue for a trading cockpit.
- **No refetch interval** on `signalsTodayQuery`, `recentSignalsQuery`, `signalQuery`, trades, decisions, rulebook. An open, focused tab never shows a new alert until focus changes or a mutation fires; the dashboard's UTC-day query key also never rolls over at midnight.
- **Contradictory cap copy**: dashboard says "no daily cap", Settings and Notifications say each tier has a cap.
- Mobile bottom nav is `slice(0,5)` — Invites and Rulebook are unreachable on mobile for staff, and Alerts is only reachable via the header bell.
- Two duplicate tier-label maps (`tiers.ts` and `format.ts`) that can drift apart.
- Signal detail "Back" always routes to Dashboard regardless of origin.
- `trades.repo.ts:75` derives WIN/LOSS/BREAKEVEN client-side from the user's R — the only place the frontend classifies a trading result.

---

## Proposed remediation, in order

1. **Repoint cron to production** and stamp the answering deployment into the heartbeat + Scanner Health.
2. **New rulebook version** with re-cut grade bands so C can fire; block activating a rulebook with a dead band.
3. **Error-state pass on the terminal**: a shared `QueryState` wrapper so every screen distinguishes loading / error / empty, plus global QueryClient defaults (`refetchInterval` on live data, retry policy) and a UTC-day roll-over tick.
4. **Scanner observability**: record spread, symbol-resolution and persistence failures to `scanner_errors`; add candle-fetch retry with cached fallback.
5. **Correctness fixes**: candle-sanity `previousTime`, symbol cache TTL, skip `DAILY_CAP` in shadow mode, `max_allowed` semantics for unlimited, single governed lock/stale TTL, best-partial selection.
6. **Copy and navigation cleanup**: one source of truth for cap wording and tier labels, mobile nav coverage, contextual back navigation, email-tier mismatch warning in Settings.
7. **Regression tests** for each of the above (reachability of every tier band, sanity gap after a malformed candle, cap-unlimited path, error-state rendering).

### Technical notes

- Rulebook changes ship as a new versioned row with a fresh SHA-256 checksum; no in-place edits.
- No trading logic moves to the frontend; the outcome-label fix moves derivation to the backend write path.
- Cron repoint and rulebook activation are data changes, applied via the appropriate tool, not a schema migration.
