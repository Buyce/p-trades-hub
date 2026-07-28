## What the data shows (verified just now)

Every enabled instrument **is** being scanned, once per minute:

- The last 10 scanner runs each list `XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY`.
- In the last 60 minutes the scanner produced ~60 evaluated records per instrument: EURUSD 60, USDJPY 60, XAUUSD 60, GBPAUD 59, GBPUSD 56.

So coverage is not the problem. Only GBPUSD alerts because the other four are blocked by gates:

```text
EURUSD   no sweep / no displacement / no setup      (60/60 minutes)
USDJPY   no setup / no displacement, bias conflict  (60/60)
GBPAUD   bias conflict (60/60), invalid stop (50)
XAUUSD   candle sanity failure (60/60)  <-- abnormal
GBPUSD   only late-entry rejections (17)  -> the one producing signals
```

EURUSD/USDJPY/GBPAUD are legitimate "market isn't offering the setup" outcomes. **XAUUSD failing the candle-sanity gate on 100% of scans is not normal** — that means its candle feed is being rejected before it is ever evaluated, so gold effectively cannot alert at all.

## Part 1 — Remove the daily alert cap

Currently caps live in the active rulebook `v1.6.0-live` (`max_daily_actionable: 30`, `tier_daily_max: A 30, B 20, C 20`) and are enforced by an atomic slot claim before promotion.

- Publish rulebook **v1.7.0-live**, identical to v1.6.0 except the caps are set to unlimited. All gates, R:R floors and score bands stay exactly the same.
- Update the scanner so an unlimited cap skips the slot claim entirely instead of claiming against a huge number, so `DAILY_CAP` can never be the reason a signal is withheld.
- Keep writing the per-tier daily counters (they remain useful as a "how many fired today" statistic), just stop using them as a limit.
- UI: the dashboard tile changes from "4/30 — A/A+ only" to "Alerts today — 4, all tiers, no cap", and the Scanner Health cap row is relabelled accordingly.

## Part 2 — Fix XAUUSD candle sanity

Diagnose first, then fix — the exact cause is not yet confirmed:

1. Read the stored `detail` on XAUUSD candle-sanity rejections to see which check fires (gap multiple, zero range, out-of-order timestamps, non-positive prices).
2. Most likely candidates are the `max_candle_gap_multiple: 6` rule against gold's larger tick sizes, or a broker-symbol/digits mismatch for `XAUUSD` in the instruments row.
3. Apply the narrowest correct fix — either an instrument-level metadata correction, or a per-instrument sanity tolerance carried in the rulebook, not a blanket loosening of the gate for all symbols.

If the detail shows the feed itself is fine and the threshold is simply too strict for gold, that becomes part of the same v1.7.0-live rulebook publish.

## Part 3 — Visibility

Add a per-instrument line to the Scanner Health "why nothing alerted" panel showing, for each watched instrument, whether it was evaluated in the last run and its single top blocking gate — so a symbol silently blocked at the data layer (like XAUUSD today) is obvious at a glance instead of needing a database query.

## Technical notes

- Files touched: `src/lib/ptrades/scanner/run.server.ts` (skip slot claim when unlimited), `src/lib/ptrades/scanner/types.ts` (cap fields accept unlimited), `src/lib/ptrades/scanner/gates.server.ts` (`dailyCap` returns pass when unlimited), `scanner-health.tsx` and `dashboard.tsx` for copy, plus a rulebook insert for v1.7.0-live and retiring v1.6.0-live.
- No change to any hard gate, R:R floor, tier band, or scoring weight.
- Read-only guarantee unchanged: nothing here touches order placement.
- After merge the app must be published, since the cron scanner runs the deployed build.
