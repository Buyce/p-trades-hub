# P-Trades shared contracts

Canonical JSON Schema (draft 2020-12) definitions for every payload that crosses
a boundary in P-Trades. They are the single source of truth shared by:

- the live TypeScript scanner (`src/lib/ptrades/contracts/*`), and
- the Python reference/replay engine (`handoff/python-reference/`).

Rules:

- A schema change is a contract change. Update the TypeScript validators, the
  Pydantic models and the tests on both sides in the same change.
- Every schema is `"additionalProperties": false` so an unexpected field is a
  loud failure rather than silently dropped data.
- Times are UTC ISO-8601 strings. Prices and scores are numbers, never strings.
- Nothing here describes an order, a position or any trade-execution payload.
  P-Trades is read-only by mandate.

| File | Payload |
| --- | --- |
| `candle.schema.json` | One closed OHLC candle |
| `market-snapshot.schema.json` | Per-instrument candle set + quote at scan time |
| `rulebook.schema.json` | Versioned rulebook parameters |
| `macro-event.schema.json` | High-impact macro event and its lockout window |
| `candidate.schema.json` | Evaluated setup, scored and gated |
| `signal.schema.json` | Candidate promoted to a stored signal |
| `scanner-result.schema.json` | Summary of one scanner run |
| `trade.schema.json` | Journalled trade, planned vs actual |
