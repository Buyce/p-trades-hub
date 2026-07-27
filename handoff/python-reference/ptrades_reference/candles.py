"""Candle normalisation — Python mirror of the TypeScript scanner.

Reference/replay only. This module is never wired to live market data or to a
scheduler. It exists so the Python replay engine and the production TypeScript
scanner can be proven to agree on the same shared fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

TIMEFRAME_SECONDS: dict[str, int] = {
    "M1": 60,
    "M5": 300,
    "M15": 900,
    "M30": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}

REASONS = (
    "INVALID_TIME",
    "NON_FINITE_PRICE",
    "NON_POSITIVE_PRICE",
    "INVERTED_RANGE",
    "BODY_OUTSIDE_RANGE",
    "DUPLICATE_TIME",
    "NOT_CLOSED",
)


@dataclass(frozen=True)
class CandleReject:
    index: int
    time: str | None
    reason: str


@dataclass(frozen=True)
class NormalisedCandles:
    candles: list[dict[str, Any]]
    rejected: list[CandleReject]


def parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_closed_candle(open_iso: str, timeframe: str, now: datetime) -> bool:
    opened = parse_utc(open_iso)
    if opened is None:
        return False
    return (now - opened).total_seconds() >= TIMEFRAME_SECONDS[timeframe]


def _malformed_reason(candle: dict[str, Any]) -> str | None:
    values = [candle.get(k) for k in ("open", "high", "low", "close")]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or v != v for v in values):
        return "NON_FINITE_PRICE"
    o, h, l, c = values  # noqa: E741
    if any(v <= 0 for v in values):
        return "NON_POSITIVE_PRICE"
    if h < l:
        return "INVERTED_RANGE"
    if o > h or o < l or c > h or c < l:
        return "BODY_OUTSIDE_RANGE"
    return None


def normalise_candles(
    raw: Iterable[dict[str, Any]], timeframe: str, now: datetime
) -> NormalisedCandles:
    """Sorts, de-duplicates, validates and drops the forming candle.

    Malformed candles are dropped and reported, never repaired or interpolated.
    """
    rejected: list[CandleReject] = []
    kept: list[dict[str, Any]] = []
    seen: set[datetime] = set()

    indexed = list(raw or [])
    order = sorted(
        range(len(indexed)),
        key=lambda i: (parse_utc(indexed[i].get("time")) or datetime.max.replace(tzinfo=timezone.utc)),
    )

    for position, original_index in enumerate(order):
        candle = indexed[original_index]
        opened = parse_utc(candle.get("time"))
        if opened is None:
            rejected.append(CandleReject(position, candle.get("time"), "INVALID_TIME"))
            continue
        bad = _malformed_reason(candle)
        if bad:
            rejected.append(CandleReject(position, candle["time"], bad))
            continue
        if opened in seen:
            rejected.append(CandleReject(position, candle["time"], "DUPLICATE_TIME"))
            continue
        if not is_closed_candle(candle["time"], timeframe, now):
            rejected.append(CandleReject(position, candle["time"], "NOT_CLOSED"))
            continue
        seen.add(opened)
        kept.append(candle)

    return NormalisedCandles(candles=kept, rejected=rejected)
