"""Pydantic mirrors of the shared JSON Schemas in `contracts/`.

The schemas are the source of truth. These models exist so the Python replay
engine parses exactly the same payloads as the TypeScript scanner, and so a
drift between the two fails a test rather than a live run.

Every model forbids extra fields, matching `"additionalProperties": false`.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Direction = Literal["LONG", "SHORT"]
Bias = Literal["LONG", "SHORT", "NEUTRAL"]
Grade = Literal["A_PLUS", "A", "B"]
Session = Literal["ASIA", "LONDON", "NEWYORK"]
Timeframe = Literal["M5", "M15", "1h", "4h", "1d"]

GateCode = Literal[
    "MISSING_DATA",
    "STALE_DATA",
    "SPREAD",
    "NEWS_LOCKOUT",
    "BIAS_CONFLICT",
    "NO_SWEEP",
    "NO_DISPLACEMENT",
    "NO_RETEST",
    "INVALID_STOP",
    "RR_BELOW_MIN",
    "LATE_ENTRY",
    "DUPLICATE",
    "DAILY_CAP",
    "SESSION",
    "CANDLE_SANITY",
    "EXPIRED",
    "NO_SETUP",
]

SignalStatus = Literal[
    "ACTIVE", "EXPIRED", "INVALIDATED", "TRIGGERED", "CLOSED", "CANCELLED"
]

Score = Annotated[float, Field(ge=0, le=100)]


class Strict(BaseModel):
    """Base model: unknown fields are an error, never silently dropped."""

    model_config = ConfigDict(extra="forbid")


class Candle(Strict):
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class MarketSnapshot(Strict):
    instrument: str
    broker_symbol: str | None = None
    fetched_at_utc: datetime
    bid: float | None = None
    ask: float | None = None
    spread: Annotated[float, Field(ge=0)] | None = None
    data_age_seconds: Annotated[float, Field(ge=0)] | None = None
    candles: dict[Timeframe, list[Candle]] = Field(default_factory=dict)


class Grades(Strict):
    A_PLUS: Score
    A: Score
    B: Score


class Rulebook(Strict):
    version: str
    closed_candles_only: bool
    min_rr_tp1: Annotated[float, Field(ge=0)]
    max_daily_actionable: Annotated[int, Field(ge=0, le=10)]
    grades: Grades
    max_data_age_seconds: float | None = None
    max_spread_atr_ratio: float | None = None
    late_entry_max_atr_from_entry: float | None = None
    atr_period: int | None = None
    atr_method: Literal["WILDER", "SMA"] | None = None
    swing_lookback: int | None = None
    displacement_min_atr: float | None = None
    allowed_sessions: list[Session] | None = None
    signal_expiry_minutes: float | None = None
    max_candle_gap_multiple: float | None = None
    macro_lookahead_minutes: float | None = None


class MacroEvent(Strict):
    title: str
    impact: Literal["LOW", "MEDIUM", "HIGH"]
    event_time_utc: datetime
    id: str | None = None
    currency: str | None = None
    lockout_start_utc: datetime | None = None
    lockout_end_utc: datetime | None = None
    symbols: list[str] = Field(default_factory=list)


class GateResult(Strict):
    code: GateCode
    passed: bool
    reason: str
    detail: dict = Field(default_factory=dict)


class Candidate(Strict):
    instrument: str
    direction: Direction
    setup_type: str
    gate_results: list[GateResult]
    qualified: bool
    broker_symbol: str | None = None
    timeframe: str | None = None
    bias: Bias | None = None
    entry_zone_low: float | None = None
    entry_zone_high: float | None = None
    stop_loss: float | None = None
    targets: list[float] = Field(default_factory=list)
    rr_tp1: float | None = None
    atr: float | None = None
    spread: float | None = None
    score: Score | None = None
    grade: Grade | None = None
    score_components: dict[str, float] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)
    fingerprint: str | None = None
    candle_time_utc: datetime | None = None


class Signal(Strict):
    instrument: str
    direction: Direction
    is_actionable: bool
    status: SignalStatus
    shadow_mode: bool
    id: str | None = None
    external_id: str | None = None
    broker_symbol: str | None = None
    setup_type: str | None = None
    timeframe: str | None = None
    entry_zone_low: float | None = None
    entry_zone_high: float | None = None
    stop_loss: float | None = None
    targets: list[float] = Field(default_factory=list)
    rr_tp1: float | None = None
    score: Score | None = None
    grade: Grade | None = None
    score_components: dict[str, float] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)
    rejection_reasons: list[str] = Field(default_factory=list)
    invalidation: str | None = None
    macro_context: dict = Field(default_factory=dict)
    spread: float | None = None
    rulebook_version: str | None = None
    signal_time_utc: datetime | None = None
    expires_at_utc: datetime | None = None
    trading_day_utc: date | None = None
    fingerprint: str | None = None


class ScannerResult(Strict):
    ok: bool
    started_at_utc: datetime
    symbols_scanned: list[str]
    candidates: Annotated[int, Field(ge=0)]
    alerts: Annotated[int, Field(ge=0)]
    shadow_mode: bool
    run_id: str | None = None
    finished_at_utc: datetime | None = None
    status: Literal["RUNNING", "OK", "PARTIAL", "ERROR", "SKIPPED"] | None = None
    rejections: Annotated[int, Field(ge=0)] | None = None
    rulebook_version: str | None = None
    error: str | None = None


class PartialExit(Strict):
    price: float
    fraction: Annotated[float, Field(gt=0, le=1)]
    at_utc: datetime


class Trade(Strict):
    instrument: str
    direction: Direction
    status: Literal["OPEN", "CLOSED", "CANCELLED"]
    id: str | None = None
    signal_id: str | None = None
    outcome: Literal["WIN", "LOSS", "BREAKEVEN", "PARTIAL"] | None = None
    planned_entry: float | None = None
    actual_entry: float | None = None
    planned_stop: float | None = None
    actual_stop: float | None = None
    entry_price: float | None = None
    stop_price: float | None = None
    exit_price: float | None = None
    partial_exits: list[PartialExit] = Field(default_factory=list)
    risk_amount: Annotated[float, Field(ge=0)] | None = None
    result_cash: float | None = None
    r_multiple: float | None = None
    mae_r: float | None = None
    mfe_r: float | None = None
    followed_plan: bool | None = None
    mistake_tags: list[str] = Field(default_factory=list)
    setup_type: str | None = None
    grade: Grade | None = None
    session: Session | None = None
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    notes: str | None = None
