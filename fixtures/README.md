# Shared fixtures

Deterministic data used by **both** the TypeScript scanner tests and the Python
reference package under `handoff/python-reference/`. No randomness, no clock
reads: every file pins explicit UTC timestamps.

- `candles/*.json` — raw candle series exactly as a market-data adapter would
  hand them over, including deliberately malformed rows.
- `expected/normalisation.json` — the result the single candle normaliser must
  produce for each candle fixture. Both languages assert against this file, so a
  divergence in either implementation fails a test.

Rules:

- Never edit a fixture to make a failing test pass. Fix the implementation, or
  add a new fixture describing the new behaviour.
- Fixtures describe data only. They never contain credentials, account
  identifiers or any order/execution field.
