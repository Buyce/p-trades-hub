# P-Trades Python reference engine (handoff export)

**This directory is not executed by the live system.** The TypeScript cloud
scanner under `src/lib/ptrades/scanner/` is the only production engine. This
package exists so the deterministic logic can be replayed and cross-checked
offline, and so it can be transferred by hand into the separate
`Buyce/P-Trades` repository.

Hard boundaries:

- Never point this package at production MetaApi credentials.
- Never schedule it. There is no cron, no daemon, no writer to the production
  database.
- No order, position or trade-execution code may ever exist here, exactly as in
  the live engine.

## Contents

```text
handoff/python-reference/
  pyproject.toml
  README.md
  ptrades_reference/
    __init__.py
    models.py          # Pydantic models mirroring contracts/*.schema.json
  tests/
    test_contracts.py  # validates the models against the JSON Schemas
```

## Contract parity

`ptrades_reference/models.py` mirrors the JSON Schemas in the repository root
`contracts/` directory. Those schemas are the source of truth. When a schema
changes, the Pydantic model and `tests/test_contracts.py` change with it.

## Running the tests locally

```bash
cd handoff/python-reference
python -m pip install -e ".[dev]"
python -m pytest
```

The tests locate the schemas at `../../contracts`. When this package is moved
to `Buyce/P-Trades`, copy the `contracts/` directory alongside it and keep the
relative layout, or set `PTRADES_CONTRACTS_DIR`.

## Transfer

Generated for manual transfer. Nothing here is pushed to GitHub from Lovable.
