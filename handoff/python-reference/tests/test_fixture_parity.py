"""Parity tests over the shared fixtures in `fixtures/`.

The TypeScript suite asserts the same expectations against the same files, so a
divergence in either implementation fails a test.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from ptrades_reference.candles import normalise_candles, parse_utc

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
EXPECTED = json.loads((FIXTURES / "expected" / "normalisation.json").read_text())
NOW: datetime = parse_utc(EXPECTED["now"])


def load(name: str) -> dict:
    return json.loads((FIXTURES / "candles" / name).read_text())


@pytest.mark.parametrize("case", EXPECTED["cases"], ids=lambda c: c["fixture"])
def test_normalisation_matches_shared_expectations(case: dict) -> None:
    fixture = load(case["fixture"])
    result = normalise_candles(fixture["candles"], "M5", NOW)
    assert len(result.candles) == case["kept"]
    reasons = sorted({r.reason for r in result.rejected})
    assert reasons == sorted(case["reject_reasons"])


def test_malformed_candles_are_never_repaired() -> None:
    fixture = load("xauusd-m5-malformed.json")
    for candle in normalise_candles(fixture["candles"], "M5", NOW).candles:
        assert candle["high"] >= candle["low"]
        assert candle["low"] <= candle["open"] <= candle["high"]
        assert candle["low"] <= candle["close"] <= candle["high"]


def test_candles_are_time_ordered() -> None:
    fixture = load("xauusd-m5-clean.json")
    times = [parse_utc(c["time"]) for c in normalise_candles(fixture["candles"], "M5", NOW).candles]
    assert times == sorted(times)
