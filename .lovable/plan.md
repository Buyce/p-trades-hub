## Audit result (verified against the live backend)

| Question | Answer |
|---|---|
| Connected to MT5? | **Yes.** Account 5053558014, MetaQuotes-Demo, London, DEPLOYED / CONNECTED. Heartbeat every ~60s, status OK. |
| Scanning Gold + our markets? | **Yes.** XAUUSD, GBPAUD, GBPUSD, EURUSD, USDJPY every minute. NAS100 is present but disabled. |
| Rules applied? | **Yes.** Rulebook v1.2.0-shadow, all 14 gates firing with real counts. 2,717 candidates stored, 118 scored A-grade, 242 B-grade. |
| Alerts on A-grade only? | Logic is correct, but **nothing can alert today**: shadow mode is on, and no A-grade candidate has yet passed every hard gate (0 qualified). |
| Where do alerts go? | **Nowhere.** An alert is only a database row; there is no notification UI, no push, no email. This is the main gap. |
| Reports direction/entry/stop/targets/RR/score/why? | **Yes** — all seven are stored and rendered on the signal detail page. |

Defects found: 1,021 STALE_DATA rejections plus 132 MetaApi `getCandles` timeouts and a 504 — real setups are being dropped for data-freshness reasons. Duplicate-fingerprint rejections are re-logged every minute (1,219 today), flooding the health view. Scanner Health colours run pills against `"SUCCESS"` while heartbeats use `"OK"`.

## What I'll build

### 1. Go live (out of shadow mode)
Flip `scanner_settings.shadow_mode` to false and publish rulebook `v1.3.0-live`. Live behaviour: only A/A+ candidates that pass every gate promote to signals, the daily slot is claimed atomically, cap stays at 2 per UTC day, minimum 2.0R at TP1. B-grade stays journal-only. No execution path is added — the system stays strictly read-only.

### 2. In-app notification centre
- Bell in the app shell with an unread count, and a `/notifications` page listing each alert with instrument, direction, grade, R:R and time, linking to the signal detail.
- Mark-as-read, mark-all-read, delete. Live updates via realtime so an alert appears without a refresh.
- Insert policy added so the scanner can write notification rows per user.

### 3. Browser push
- Service worker plus VAPID web-push. A "Enable push alerts on this device" button in Settings requests permission and registers the device.
- New `push_subscriptions` table (user-scoped RLS). On a qualified signal the scanner sends a push containing instrument, direction, grade and R:R; tapping it opens the signal.
- Dead subscriptions are pruned on send failure.

### 4. Email alerts — user's choice, visible toggle
- Settings gains a clearly visible **"Also email me when an alert fires"** switch, off by default, stored on the profile.
- When on, a branded P-Trades email goes out from your verified domain with direction, entry zone, stop-loss, all three targets, R:R at TP1, confidence score and grade, and the qualifying reasons — plus a link to the signal.
- The switch is surfaced once in the notification centre too, so it's discoverable rather than buried.

### 5. Harden market data (fixes STALE_DATA)
- Raise the candle timeout, add bounded retry with backoff, and fetch timeframes with limited concurrency instead of five simultaneous calls.
- Cache the last good candle set per symbol/timeframe so a single slow call doesn't fail the whole instrument, while still rejecting genuinely stale data (fail-closed preserved).
- Record timeout/retry counts on the run so Scanner Health shows feed quality.

### 6. Health surface cleanup
- Log a duplicate rejection once per fingerprint per day instead of every minute.
- Fix the run status pill mapping, and add an "Alerts today x/2", "Feed quality" and "Live / Shadow" indicator to Scanner Health.

## Technical notes
- Alert fan-out lives in `notify.server.ts`, called from the existing live-mode branch in `run.server.ts`; delivery channels (in-app, push, email) run independently so one failing channel never blocks the others or the scan.
- Push send and email send happen inside the scanner's server-side path with the admin client; VAPID keys stored as backend secrets (I'll generate them).
- Migrations: `push_subscriptions` table with grants + RLS, `notifications` insert policy, `profiles.email_alerts_enabled` column, new rulebook version row, shadow-mode flag update.
- No frontend recalculation of any trading value — the UI keeps rendering stored backend fields only.

## What I still need from you
- Confirm you want to go live on the **demo** account feed (MetaQuotes-Demo) — that's what's wired now. Alerts will be real alerts on demo-account data until a live account is connected.
