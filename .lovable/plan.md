
# P-Trades Precision Entry Engine

## Audit of current implementation (verified by reading the code)

| Object / function | File | Current behaviour | Verdict | Action |
|---|---|---|---|---|
| `detectSetup`, three family detectors | `scanner/setups.server.ts` | M15 setup detection, returns level/extreme/entry bounds | Correct | Keep as the only setup detector; it becomes stage 1 (DETECTED) |
| `detectRetest` | `scanner/retest.server.ts` | Symmetric `±0.25 × ATR` tolerance produces the entry zone | Partial — it conflates "retest happened" with "where to enter" | Split: keep retest detection, move zone construction out |
| Entry zone + entry midpoint | `run.server.ts` ~441-443 | `entry = (entryLow + entryHigh) / 2`, rounded to digits | Obsolete | Replace with `preferredEntry` from entry anchor + asymmetric zone |
| Stop derivation | `run.server.ts` ~444-451 | `extreme ∓ 0.2 × ATR` | Correct | Keep; feeds invalidation price |
| `checkLateEntry` | `scanner/late-entry.server.ts` | ATR distance from zone only | Partial | Keep as the M15 coarse gate; add extension-R for execution stage |
| `signals.invalidation` | nowhere | **Never written by any scanner module** — that is why the UI shows "Unavailable" | Missing | Add authoritative invalidation builder + hard gate |
| Timeframes | `run.server.ts` `REQUIRED` | M5, M15, 1h, 4h, 1d — **no M1** | Missing | Add M1 fetch, precision stage only |
| Pip / point conversion | none | Spread stored and displayed as raw decimal | Missing | One `pips.ts` module |
| Lifecycle state | none | Signals have `status` only (ACTIVE/EXPIRED/…) | Missing | Add `SetupLifecycleState` |
| Precision scanner | none | Single 60s context scan | Missing | Add in-invocation precision loop |
| `notifyQualifiedSignal` | `scanner/notify.server.ts` | Tiered email/push, uncapped | Correct | Reuse unchanged; only the trigger condition changes |
| Python reference | `handoff/python-reference/ptrades_reference/` | `candles.py`, `features.py`, `models.py` only | Missing | Add precision modules in the same package (not a new `reference-python/` tree) |

Instrument metadata is already populated (`digits`/`point_size` for all 5 enabled symbols), so pip maths needs no new data.

## Decisions applied from your answers

- **Live precision immediately** — no shadow calibration stage. Risk to accept: ENTRY_READY is strictly narrower than today's M15 zone alerts, so alert volume will drop, possibly sharply, in the first days. I'll ship a calibration panel so you can see exactly where setups die and loosen parameters without a code change.
- **All four tiers (A+/A/B/C), no daily cap** — the prompt's "A/A+ only, max 2/day" rule is not implemented.
- **In-invocation 5s loop** — one cron call per minute runs a ~55s loop polling armed watches every 5s.

## Architecture

```text
D1/H4/H1 context → M15 setup      = stage 1, every 60s, all instruments
   ↓ DETECTED / ARMED
M5 confirmation → M1 rejection/displacement/BOS → M1 retest
                                  = stage 2, every 5s, armed watches only
   ↓ ENTRY_READY → alert
```

Only `ENTRY_READY` produces an alert. Closed candles only at every stage.

## What gets built

**Database** — one migration:
- `precision_watches` (signal_id, symbol, state, structural_level, entry_anchor, anchor_source, trigger_level, trigger_candle_time, preferred_entry, invalidation_price/condition/timeframe, armed_at, entry_ready_at, expires_at, last_checked_at, check_count, metadata) with grants, RLS (read-only to authenticated, service_role full), unique on signal_id.
- New columns on `signals`: `lifecycle_state`, `preferred_entry`, `zone_width_points`, `price_at_alert`, `distance_to_entry_points`, `trigger_timeframe`, `trigger_level`, `trigger_candle_time`, `trigger_summary`, `invalidation_price`, `invalidation_timeframe`, `armed_at`, `entry_ready_at`.
- Rulebook `v2.0.0-live` with a `precision` block (per-symbol min/max zone width, spread and ATR multipliers, maxExtensionR, proximityPoints; ARMED expiry 30min FX / 20min gold; MICRO_TRIGGERED 3 M1 bars).

**New TypeScript modules** (one authoritative implementation each, exported through `scanner/features/index.ts`):
- `pips.server.ts` — `getPipSize`, `priceDistanceToPips`, point conversion.
- `entry-anchor.server.ts` — anchor per setup family, returns `{ anchor, source, sourceCandleTime }`.
- `entry-zone.server.ts` — `calculateAdaptiveZoneWidthPoints` + asymmetric zone (BUY: `[anchor − width, anchor]`; SELL: `[anchor, anchor + width]`).
- `invalidation.server.ts` — price, condition text, timeframe; derived from the structural stop side.
- `micro-trigger.server.ts` — closed-M1 rejection → displacement → BOS/CHOCH → retest sequence, reusing the existing `displacement`, `structure`, `retest` and `swings` primitives (no new copies).
- `proximity.server.ts` — `isPriceNearEntry`, `calculateExtensionR`.
- `lifecycle.server.ts` — the state machine and its legal transitions.
- `precision.server.ts` — the 5s loop: load armed watches, batch quotes and M1 candles, advance states, promote ENTRY_READY.

**Reused unchanged:** gates, scoring, tiers, fingerprint/duplicate, macro, sessions, sanity, persist, notify, email/push templates. The existing hard-gate battery runs again at ENTRY_READY so spread, news, freshness, duplicate and R:R are re-checked against live conditions, plus the new mandatory-invalidation gate and a re-computed TP1 ≥ 2R against the preferred entry.

**Scanner wiring** — `run.server.ts` stops emitting alerts for M15 setups. A qualifying setup writes the signal at `DETECTED`/`ARMED` and opens a precision watch. `scan-markets` route runs the context scan, then the precision loop for the rest of the minute, guarded by the existing scan lock plus a per-watch idempotency check.

**UI** — `signals.$signalId.tsx` and the dashboard/watchlist cards show preferred entry, acceptable zone, current price, distance in pips, lifecycle state, trigger status/timeframe, valid until, stop, targets, R:R, structural invalidation, spread in pips. `scanner-health.tsx` gains a lifecycle funnel panel (DETECTED → ARMED → MICRO_TRIGGERED → ENTRY_READY → MISSED/EXPIRED counts, average alert distance, old vs new zone width).

**Python reference** — added to the existing `ptrades_reference` package: `entry_zone.py`, `precision_entry.py`, `micro_trigger.py`, `lifecycle.py`, `proximity.py`, `expiry.py`, plus contract models. Golden fixtures shared with the TypeScript suite guarantee parity on anchor, zone width, pip conversion, proximity, extension R, expiry and lifecycle transitions.

**Tests** — lifecycle transitions, anchor selection, asymmetric zones, adaptive widths, pip conversion, M1 closed-candle enforcement, each micro-trigger stage, proximity, late entry/extension R, expiry, missing-invalidation rejection, target-touched-before-entry, scheduler overlap, TS/Python parity.

## Technical notes

- MetaApi has a single resource slot; the precision loop only requests M1 candles and quotes for symbols with an open watch, and reuses the existing retry/last-good fallback. Cost stays near flat when nothing is armed.
- Zone width is expressed in points and converted for display, so gold (digits 2) and JPY (digits 3) are handled by the same code path.
- No execution surface is added anywhere: the precision engine reads quotes and writes analysis rows only.

## Deliverable

An end report covering files audited, duplicates consolidated, authoritative functions, migration, scheduler change, UI change, tests, TS/Python parity, and old-vs-new EURUSD zone width with the precision/fill-rate trade-off.
