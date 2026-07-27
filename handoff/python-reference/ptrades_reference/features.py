"""Feature engine — Python mirror of the TypeScript scanner features.

Reference/replay only. Pure functions over closed candles, written from the
specification rather than transliterated, so agreement with the TypeScript
engine on the golden fixtures is meaningful evidence and not a copy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence

AtrMethod = Literal["WILDER", "SMA"]


@dataclass(frozen=True)
class Swing:
    index: int
    price: float
    time: str


def true_range(candles: Sequence[dict[str, Any]]) -> list[float]:
    """True range for every candle after the first (index 0 has no prior close)."""
    out: list[float] = []
    for i in range(1, len(candles)):
        c = candles[i]
        prev_close = candles[i - 1]["close"]
        out.append(
            max(
                c["high"] - c["low"],
                abs(c["high"] - prev_close),
                abs(c["low"] - prev_close),
            )
        )
    return out


def atr(
    candles: Sequence[dict[str, Any]], period: int = 14, method: AtrMethod = "WILDER"
) -> float | None:
    """ATR over closed candles; None when there is not enough data."""
    if len(candles) < period + 1:
        return None
    trs = true_range(candles)
    if len(trs) < period:
        return None
    if method == "SMA":
        return sum(trs[-period:]) / period
    value = sum(trs[:period]) / period
    for tr in trs[period:]:
        value = (value * (period - 1) + tr) / period
    return value


def swing_highs(candles: Sequence[dict[str, Any]], lookback: int = 5) -> list[Swing]:
    out: list[Swing] = []
    for i in range(lookback, len(candles) - lookback):
        pivot = candles[i]["high"]
        window = range(i - lookback, i + lookback + 1)
        if all(candles[j]["high"] < pivot for j in window if j != i):
            out.append(Swing(i, pivot, candles[i]["time"]))
    return out


def swing_lows(candles: Sequence[dict[str, Any]], lookback: int = 5) -> list[Swing]:
    out: list[Swing] = []
    for i in range(lookback, len(candles) - lookback):
        pivot = candles[i]["low"]
        window = range(i - lookback, i + lookback + 1)
        if all(candles[j]["low"] > pivot for j in window if j != i):
            out.append(Swing(i, pivot, candles[i]["time"]))
    return out


def reward_to_risk(entry: float, stop: float, target: float) -> float | None:
    """R:R at a target. None when the stop is on the wrong side or at entry."""
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    direction = 1 if target > entry else -1
    if (direction == 1 and stop >= entry) or (direction == -1 and stop <= entry):
        return None
    return abs(target - entry) / risk
