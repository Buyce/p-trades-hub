"""P-Trades reference engine.

Offline replay and parity checking only. This package never connects to a live
broker account, never writes to the production database and never places,
modifies or cancels a trade.
"""

from .models import (  # noqa: F401
    Candle,
    Candidate,
    GateResult,
    MacroEvent,
    MarketSnapshot,
    PartialExit,
    Rulebook,
    ScannerResult,
    Signal,
    Trade,
)

__all__ = [
    "Candle",
    "Candidate",
    "GateResult",
    "MacroEvent",
    "MarketSnapshot",
    "PartialExit",
    "Rulebook",
    "ScannerResult",
    "Signal",
    "Trade",
]
