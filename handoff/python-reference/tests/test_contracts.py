"""Parity tests: the Pydantic models must agree with the shared JSON Schemas.

Both sides validate the same payloads. If a schema and a model drift apart,
one of these assertions fails.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.validators import RefResolver
from pydantic import ValidationError

from ptrades_reference import Candidate, Candle, MarketSnapshot, Rulebook, Signal, Trade

CONTRACTS_DIR = Path(
    os.environ.get(
        "PTRADES_CONTRACTS_DIR",
        Path(__file__).resolve().parents[3] / "contracts",
    )
)


def load(name: str) -> dict:
    return json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text())


def validator_for(name: str) -> Draft202012Validator:
    schema = load(name)
    store = {
        load(other)["$id"]: load(other)
        for other in (
            "candle",
            "market-snapshot",
            "rulebook",
            "macro-event",
            "candidate",
            "signal",
            "scanner-result",
            "trade",
        )
    }
    resolver = RefResolver(base_uri=schema["$id"], referrer=schema, store=store)
    return Draft202012Validator(schema, resolver=resolver)


CANDLE = {
    "time": "2026-07-27T10:00:00Z",
    "open": 1.0,
    "high": 2.0,
    "low": 0.5,
    "close": 1.5,
    "volume": 100.0,
}


def test_contracts_directory_is_present():
    assert CONTRACTS_DIR.is_dir(), f"contracts not found at {CONTRACTS_DIR}"


def test_candle_accepted_by_both_sides():
    validator_for("candle").validate(CANDLE)
    assert Candle.model_validate(CANDLE).close == 1.5


def test_candle_extra_field_rejected_by_both_sides():
    bad = {**CANDLE, "forming": True}
    assert not validator_for("candle").is_valid(bad)
    with pytest.raises(ValidationError):
        Candle.model_validate(bad)


def test_market_snapshot_roundtrip():
    payload = {
        "instrument": "XAUUSD",
        "fetched_at_utc": "2026-07-27T10:00:05Z",
        "candles": {"M15": [CANDLE]},
    }
    validator_for("market-snapshot").validate(payload)
    assert MarketSnapshot.model_validate(payload).instrument == "XAUUSD"


def test_rulebook_cap_bounds():
    payload = {
        "version": "v1.2.0-shadow",
        "closed_candles_only": True,
        "min_rr_tp1": 2.0,
        "max_daily_actionable": 2,
        "grades": {"A_PLUS": 95, "A": 90, "B": 80},
    }
    validator_for("rulebook").validate(payload)
    assert Rulebook.model_validate(payload).max_daily_actionable == 2

    bad = {**payload, "max_daily_actionable": 25}
    assert not validator_for("rulebook").is_valid(bad)
    with pytest.raises(ValidationError):
        Rulebook.model_validate(bad)


def test_candidate_score_bounds():
    payload = {
        "instrument": "EURUSD",
        "direction": "LONG",
        "setup_type": "SWEEP_DISPLACEMENT_RETEST",
        "gate_results": [{"code": "RR_BELOW_MIN", "passed": True, "reason": "2.4R"}],
        "qualified": True,
        "score": 91,
        "grade": "A",
    }
    validator_for("candidate").validate(payload)
    assert Candidate.model_validate(payload).grade == "A"

    with pytest.raises(ValidationError):
        Candidate.model_validate({**payload, "score": 140})


def test_signal_has_no_execution_fields():
    payload = {
        "instrument": "GBPUSD",
        "direction": "SHORT",
        "is_actionable": False,
        "status": "ACTIVE",
        "shadow_mode": True,
    }
    validator_for("signal").validate(payload)
    assert Signal.model_validate(payload).is_actionable is False

    for forbidden in ({"order_type": "MARKET"}, {"volume": 0.5}, {"ticket": 1}):
        bad = {**payload, **forbidden}
        assert not validator_for("signal").is_valid(bad)
        with pytest.raises(ValidationError):
            Signal.model_validate(bad)


def test_trade_partial_exit_fraction():
    payload = {
        "instrument": "XAUUSD",
        "direction": "LONG",
        "status": "CLOSED",
        "partial_exits": [
            {"price": 2410.0, "fraction": 0.5, "at_utc": "2026-07-27T12:00:00Z"}
        ],
    }
    validator_for("trade").validate(payload)
    assert Trade.model_validate(payload).partial_exits[0].fraction == 0.5

    with pytest.raises(ValidationError):
        Trade.model_validate(
            {
                **payload,
                "partial_exits": [
                    {"price": 2410.0, "fraction": 1.5, "at_utc": "2026-07-27T12:00:00Z"}
                ],
            }
        )
