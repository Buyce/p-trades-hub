"""Golden feature parity against `fixtures/golden/features.json`.

The TypeScript suite asserts the same numbers, so the two engines cannot drift
apart silently.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ptrades_reference.features import atr, reward_to_risk, swing_highs, swing_lows, true_range

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = json.loads((ROOT / "fixtures" / "golden" / "features.json").read_text())
TOL = GOLDEN["tolerance"]

SOURCES = list(GOLDEN["sources"].items())


def load(path: str) -> list[dict]:
    return json.loads((ROOT / path).read_text())["candles"]


@pytest.mark.parametrize("name,expected", SOURCES, ids=[n for n, _ in SOURCES])
def test_true_range(name: str, expected: dict) -> None:
    candles = load(expected["path"])
    assert len(candles) == expected["candle_count"]
    trs = true_range(candles)
    assert len(trs) == expected["true_range"]["count"]
    for actual, want in zip(trs[:5], expected["true_range"]["first_5"]):
        assert actual == pytest.approx(want, abs=TOL)
    for actual, want in zip(trs[-5:], expected["true_range"]["last_5"]):
        assert actual == pytest.approx(want, abs=TOL)


@pytest.mark.parametrize("name,expected", SOURCES, ids=[n for n, _ in SOURCES])
def test_atr_both_methods(name: str, expected: dict) -> None:
    candles = load(expected["path"])
    assert atr(candles, 14, "WILDER") == pytest.approx(expected["atr"]["wilder_14"], abs=TOL)
    assert atr(candles, 14, "SMA") == pytest.approx(expected["atr"]["sma_14"], abs=TOL)
    assert atr(candles, 5, "WILDER") == pytest.approx(expected["atr"]["wilder_5"], abs=TOL)
    assert atr(candles[:10], 14, "WILDER") is None


@pytest.mark.parametrize("name,expected", SOURCES, ids=[n for n, _ in SOURCES])
def test_swings(name: str, expected: dict) -> None:
    candles = load(expected["path"])
    highs = swing_highs(candles, 5)
    lows = swing_lows(candles, 5)
    assert [s.index for s in highs] == [s["index"] for s in expected["swings"]["lookback_5"]["highs"]]
    assert [s.index for s in lows] == [s["index"] for s in expected["swings"]["lookback_5"]["lows"]]
    for swing, want in zip(highs, expected["swings"]["lookback_5"]["highs"]):
        assert swing.price == pytest.approx(want["price"], abs=TOL)
        assert swing.time == want["time"]
    assert len(swing_highs(candles, 3)) == expected["swings"]["lookback_3"]["high_count"]
    assert len(swing_lows(candles, 3)) == expected["swings"]["lookback_3"]["low_count"]


def test_reward_to_risk() -> None:
    for case in GOLDEN["reward_to_risk"]:
        actual = reward_to_risk(case["entry"], case["stop"], case["target"])
        if case["rr"] is None:
            assert actual is None
        else:
            assert actual == pytest.approx(case["rr"], abs=TOL)
