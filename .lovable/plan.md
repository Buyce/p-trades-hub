## What the data shows

Verified against live tables (last 40 minutes and full day 2026-07-28):

- **Coverage is fine.** Every minute-run scans all 5 enabled instruments (XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY) — 389–391 candidates each today. NAS100 is disabled by configuration, as intended. The published build is live: the R:R gate now correctly applies the lowest tier floor (`minRr 1.2`), and rulebook `v1.6.0-live` with the 1.5 ATR late-entry allowance is in effect.
- **C tier is mathematically unreachable.** Every hard gate is also a large scoring component: sweep = 20 pts, retest = 15, displacement ≥ 1 ATR = 15, bias-aligned = 12. Anything that survives all hard gates already scores ≈ 83.5 minimum. Today: 477 candidates landed in the C band (70–79.9), and every single one failed a hard gate (NO_SETUP, NO_DISPLACEMENT, BIAS_CONFLICT). A C-band score and a passing candidate are mutually exclusive by construction.
- **A+ is also unreachable.** Targets are hard-coded at 2R/3R from the stop, so `rr_tp1` is ≈2.00 for every candidate and `structure_confirmation` is permanently pinned at 7.5/15. Maximum attainable score = 92.5, below the A+ band of 95.
- **Reachable range is 83.5 – 92.5**, i.e. only B and A can ever fire. Two B alerts in 20 minutes is the system working exactly as coded.
- Side effect of the fixed 2R target: float rounding produces `rr_tp1` of 1.9655 / 1.998 / 2.003, which used to trip the old 2.0 hard floor.

## The fix

### 1. Structure-based targets (`risk.server.ts`, `run.server.ts`)

Replace the fixed 2R/3R target ladder with targets derived from real market structure:

- TP1 = nearest opposing liquidity level ahead of entry (prior swing high/low from the existing swing detector, or the swept level on the opposite side), floored so it never sits inside the entry zone.
- TP2 / TP3 = next two structural levels out; fall back to the current R-multiples only when no further structure exists within a sane distance.
- Reject a setup only through the existing `RR_BELOW_MIN` gate (lowest tier floor, 1.2) — no new hard gate.
- Round targets to instrument digits once, and round `rr_tp1` to 2 dp on write so 1.9999 stops presenting as "2.00 but rejected".

Effect: `rr_tp1` genuinely varies, `structure_confirmation` uses its full 0–15 range, and the per-tier R:R floors (2.0 / 2.0 / 1.5 / 1.2) become meaningful for the first time.

### 2. Observe, then recalibrate bands (rulebook `v1.7.0-live`)

Structure-based targets change the score distribution, so bands are recalibrated *after* measuring, not guessed:

- Ship step 1, let the scanner run through a full London + New York session.
- Query the observed score distribution for gate-passing candidates only.
- Set bands to quartiles of that real distribution so each tier is populated, e.g. roughly A+ ≈ top decile, A ≈ next quartile, B ≈ middle, C ≈ the weakest gate-passing setups. Exact numbers come from the measured data.
- Publish as rulebook `v1.7.0-live` through the versioning system with checksum and change summary. **No hard gate, no tier R:R floor and no daily cap changes** — C stays fully gate-compliant, just the weakest qualifying band, as you chose.

### 3. Guardrail against this recurring

Add a "tier reachability" check to Scanner Health: for the active rulebook, compute the theoretical minimum and maximum score a gate-passing candidate can achieve, and flag any tier band that falls outside that window as unreachable. This would have surfaced the C and A+ dead bands immediately.

## Technical notes

- Files touched: `src/lib/ptrades/scanner/risk.server.ts` (target derivation), `src/lib/ptrades/scanner/run.server.ts` (wire structural levels from the swing/sweep detector into target building), `src/lib/ptrades/scanner/scoring.server.ts` (unchanged weights; only the now-live R:R range), `src/routes/_authenticated/scanner-health.tsx` + `health.repo.ts` (reachability panel), plus a rulebook migration for `v1.7.0-live`.
- Test updates: `risk.test.ts` and `scoring.test.ts` gain cases for varying R:R; a new test asserts every tier band is reachable given the active rulebook.
- Nothing in this plan adds any execution capability — targets are still descriptive plan data only.

## Sequencing

Step 1 and step 3 ship together now. Step 2 (band recalibration) needs one session of live data first; I'll run the distribution query and propose exact band numbers before publishing v1.7.0.
