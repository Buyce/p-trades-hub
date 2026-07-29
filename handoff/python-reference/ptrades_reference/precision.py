"""Precision entry engine — Python mirror of the TypeScript execution layer.

Reference and replay only: nothing here connects to a broker, writes to the
database, or places a trade. The purpose is parity — if this module and
`src/lib/ptrades/scanner/*.server.ts` disagree on a replayed setup, one of them
is wrong and a test says so.

Written from the specification, not transliterated: the same rules, expressed
independently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Sequence

from .features import atr, swing_highs, swing_lows

Direction = Literal["LONG", "SHORT"]

LifecycleState = Literal[
    "DETECTED",
    "ARMED",
    "MICRO_TRIGGERED",
    "ENTRY_READY",
    "MISSED",
    "EXPIRED",
    "INVALIDATED",
]

TERMINAL_STATES: tuple[LifecycleState, ...] = ("MISSED", "EXPIRED", "INVALIDATED")

_TRANSITIONS: dict[LifecycleState, tuple[LifecycleState, ...]] = {
    "DETECTED": ("ARMED", "EXPIRED", "INVALIDATED", "MISSED"),
    "ARMED": ("MICRO_TRIGGERED", "MISSED", "EXPIRED", "INVALIDATED"),
    "MICRO_TRIGGERED": ("ENTRY_READY", "ARMED", "MISSED", "EXPIRED", "INVALIDATED"),
    "ENTRY_READY": ("EXPIRED", "INVALIDATED", "MISSED"),
    "MISSED": (),
    "EXPIRED": (),
    "INVALIDATED": (),
}


def can_transition(source: LifecycleState, target: LifecycleState) -> bool:
    if source == target:
        return True
    return target in _TRANSITIONS.get(source, ())


def transition(source: LifecycleState, target: LifecycleState) -> LifecycleState:
    if not can_transition(source, target):
        raise ValueError(f"Illegal lifecycle transition {source} -> {target}")
    return target


def is_alertable(state: LifecycleState) -> bool:
    """Only ENTRY_READY may ever produce an alert."""
    return state == "ENTRY_READY"


# --------------------------------------------------------------------------- #
# Points and pips
# --------------------------------------------------------------------------- #


def pip_size(point: float, digits: int) -> float:
    if point <= 0:
        return 0.0
    return point * 10 if digits in (3, 5) else point


def price_distance_to_points(distance: float, point: float) -> float:
    return distance / point if point > 0 else 0.0


def points_to_price(points: float, point: float) -> float:
    return points * point if point > 0 else 0.0


# --------------------------------------------------------------------------- #
# Execution zone
# --------------------------------------------------------------------------- #


def adaptive_zone_width_points(
    *,
    spread_points: float,
    atr_m1: float,
    atr_m5: float,
    point: float,
    minimum: float,
    maximum: float,
    spread_mult: float,
    atr_m1_mult: float,
    atr_m5_mult: float,
) -> float:
    """Zone width in points: absorbs the spread, tracks the calmer volatility."""
    spread_width = max(0.0, spread_points) * spread_mult
    atr_m1_width = (atr_m1 / point) * atr_m1_mult if point > 0 else 0.0
    atr_m5_width = (atr_m5 / point) * atr_m5_mult if point > 0 else 0.0

    if atr_m1_width > 0 and atr_m5_width > 0:
        volatility_width = min(atr_m1_width, atr_m5_width)
    else:
        volatility_width = max(atr_m1_width, atr_m5_width)

    return min(maximum, max(minimum, max(spread_width, volatility_width)))


@dataclass(frozen=True)
class ExecutionZone:
    preferred_entry: float
    entry_low: float
    entry_high: float
    zone_width_points: float


def build_execution_zone(
    preferred_entry: float,
    direction: Direction,
    zone_width_points: float,
    point: float,
) -> ExecutionZone:
    """Asymmetric zone: it only ever extends towards the better price."""
    width = points_to_price(max(0.0, zone_width_points), point)
    if direction == "LONG":
        return ExecutionZone(preferred_entry, preferred_entry - width, preferred_entry, zone_width_points)
    return ExecutionZone(preferred_entry, preferred_entry, preferred_entry + width, zone_width_points)


# --------------------------------------------------------------------------- #
# Proximity and extension
# --------------------------------------------------------------------------- #


def is_price_near_entry(
    current_price: float, preferred_entry: float, point: float, proximity_points: float
) -> bool:
    if point <= 0:
        return False
    return abs(current_price - preferred_entry) / point <= proximity_points


def distance_to_entry_points(current_price: float, preferred_entry: float, point: float) -> float:
    return abs(current_price - preferred_entry) / point if point > 0 else 0.0


def extension_r(
    direction: Direction, planned_entry: float, current_price: float, stop_loss: float
) -> float:
    """How far price has already run past the entry, in R. Fails closed."""
    risk = abs(planned_entry - stop_loss)
    if risk <= 0:
        return float("inf")
    move = current_price - planned_entry if direction == "LONG" else planned_entry - current_price
    return move / risk


def target_already_touched(
    direction: Direction, target: float | None, extreme_since_armed: float | None
) -> bool:
    if target is None or extreme_since_armed is None:
        return False
    return extreme_since_armed >= target if direction == "LONG" else extreme_since_armed <= target


# --------------------------------------------------------------------------- #
# Invalidation
# --------------------------------------------------------------------------- #


def is_invalidated(direction: Direction, invalidation_price: float | None, closed_price: float | None) -> bool:
    if invalidation_price is None or closed_price is None:
        return False
    return closed_price < invalidation_price if direction == "LONG" else closed_price > invalidation_price


# --------------------------------------------------------------------------- #
# M1 micro trigger
# --------------------------------------------------------------------------- #


@dataclass
class MicroTrigger:
    confirmed: bool = False
    triggered: bool = False
    rejection_candle_time: str | None = None
    displacement_candle_time: str | None = None
    bos_candle_time: str | None = None
    broken_level: float | None = None
    retest_candle_time: str | None = None
    failures: list[str] = field(default_factory=list)


def _is_rejection(candle: dict[str, Any], direction: Direction) -> bool:
    rng = candle["high"] - candle["low"]
    if rng <= 0:
        return False
    body = abs(candle["close"] - candle["open"])
    if body > rng * 0.6:
        return False
    if direction == "LONG":
        lower_wick = min(candle["open"], candle["close"]) - candle["low"]
        return lower_wick >= rng * 0.4 and candle["close"] >= candle["low"] + rng * 0.5
    upper_wick = candle["high"] - max(candle["open"], candle["close"])
    return upper_wick >= rng * 0.4 and candle["close"] <= candle["high"] - rng * 0.5


def detect_micro_trigger(
    candles: Sequence[dict[str, Any]],
    direction: Direction,
    zone_low: float,
    zone_high: float,
    *,
    atr_period: int = 14,
    displacement_min_atr: float = 0.8,
    swing_lookback: int = 2,
    retest_within_bars: int = 3,
    window: int = 20,
) -> MicroTrigger:
    """Rejection, displacement, micro BOS, then a held retest — in that order."""
    result = MicroTrigger()
    if len(candles) < swing_lookback * 2 + 4:
        result.failures.append("Not enough closed M1 candles.")
        return result

    atr_m1 = atr(candles, atr_period)
    if not atr_m1 or atr_m1 <= 0:
        result.failures.append("M1 ATR unavailable.")
        return result

    highs = swing_highs(candles, swing_lookback)
    lows = swing_lows(candles, swing_lookback)
    start = max(swing_lookback, len(candles) - window)

    rejection_index = -1
    for i in range(len(candles) - 1, start - 1, -1):
        c = candles[i]
        touches = c["low"] <= zone_high and c["high"] >= zone_low
        if touches and _is_rejection(c, direction):
            rejection_index = i
            break
    if rejection_index < 0:
        result.failures.append("No M1 rejection candle at the armed entry area.")
        return result
    result.rejection_candle_time = candles[rejection_index]["time"]

    displacement_index = -1
    for i in range(rejection_index, len(candles)):
        c = candles[i]
        directional = c["close"] > c["open"] if direction == "LONG" else c["close"] < c["open"]
        if directional and abs(c["close"] - c["open"]) / atr_m1 >= displacement_min_atr:
            displacement_index = i
            break
    if displacement_index < 0:
        result.failures.append("No M1 displacement candle.")
        return result
    result.displacement_candle_time = candles[displacement_index]["time"]

    bos_index = -1
    for i in range(displacement_index, len(candles)):
        pool = [s for s in (highs if direction == "LONG" else lows) if s.index < i - 1]
        if not pool:
            continue
        protected = pool[-1]
        broke = (
            candles[i]["close"] > protected.price
            if direction == "LONG"
            else candles[i]["close"] < protected.price
        )
        if broke:
            bos_index = i
            result.broken_level = protected.price
            break
    if bos_index < 0 or result.broken_level is None:
        result.failures.append("No M1 close beyond the protected micro swing.")
        return result

    result.bos_candle_time = candles[bos_index]["time"]
    result.triggered = True

    tolerance = atr_m1 * 0.5
    level = result.broken_level
    for i in range(bos_index + 1, min(len(candles), bos_index + retest_within_bars + 1)):
        c = candles[i]
        if direction == "LONG":
            touched, held = c["low"] <= level + tolerance, c["close"] > level
        else:
            touched, held = c["high"] >= level - tolerance, c["close"] < level
        if touched and held:
            result.confirmed = True
            result.retest_candle_time = c["time"]
            return result

    result.failures.append("The broken M1 level has not been retested and held.")
    return result


def entry_ready(
    *,
    state: LifecycleState,
    trigger: MicroTrigger,
    near_entry: bool,
    extension: float,
    max_extension_r: float,
    rr_tp1: float | None,
    min_rr: float,
    invalidation_price: float | None,
    gates_passed: bool = True,
) -> bool:
    """The full ENTRY_READY predicate. Every condition is required."""
    return (
        state in ("ARMED", "MICRO_TRIGGERED")
        and trigger.confirmed
        and near_entry
        and extension <= max_extension_r
        and rr_tp1 is not None
        and rr_tp1 >= min_rr
        and invalidation_price is not None
        and gates_passed
    )
