## What the JSON tells us

The value currently stored in `METAAPI_ACCOUNT_ID` (`067203c067c11bc7d5a60157395637f2`) is the `userId` field from that payload — your MetaApi *user* ID, not the trading account ID. That's why the account lookup returns 404 and the scanner has been falling back to the single deployed account it finds under your token.

The account this JSON describes is the same one the fallback already found:

- Account ID: `f6a72106-7709-4835-8022-75cad470a505`
- Region: `london`
- Name: `boatengampomah@gmail.com`
- Login `5053558014` on `MetaQuotes-Demo`, `cloud-g2`, state `DEPLOYED`, connection `CONNECTED`

So the scanner is already reading the correct account — it's just doing it via the fallback path instead of the configured one.

## Plan

1. **Correct the secrets**
   - Set `METAAPI_ACCOUNT_ID` to `f6a72106-7709-4835-8022-75cad470a505`.
   - Confirm `METAAPI_REGION` is `london`.
   - `METAAPI_TOKEN` stays unchanged.

2. **Tighten account resolution** in `src/lib/ptrades/scanner/metaapi.server.ts`
   - Keep the provisioning lookup that resolves the live region from the account itself.
   - Keep the single-deployed-account fallback as a safety net, but surface it loudly: when it fires, the heartbeat detail records `accountIdMismatch: true` plus the resolved ID, so a wrong secret is visible on the Scanner Health screen rather than silently absorbed.
   - Add a guard that rejects an account ID that isn't a UUID with a clear message ("this looks like a MetaApi user ID, not a trading account ID"), so this specific mix-up can't recur unnoticed.

3. **Record account context in heartbeats**
   - Store non-sensitive account metadata (`login`, `server`, `region`, `state`, `connectionStatus`, `reliability`) in the `system_heartbeats.detail` payload each run. No token, no password, no balance.

4. **Surface it on Scanner Health**
   - Show broker server, login, region and connection status alongside the existing run stats, plus a warning row if the configured account ID doesn't match the resolved one.

5. **Verify**
   - Hit the diagnostic endpoint and confirm `lookupError` is null and `resolvedFromToken` is false.
   - Run one scan and confirm candidates are still produced from live candles with no rejections of type `MISSING_DATA`.

## Unchanged boundaries

Still read-only throughout: the GET-only path allowlist stays, no order/position/trade endpoint is added, shadow mode remains on and alerts remain suppressed.
