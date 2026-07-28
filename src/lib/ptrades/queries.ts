/**
 * Facade over the repository layer.
 *
 * Screens keep importing from `@/lib/ptrades/queries`; the actual reads live in
 * `repositories/*`. No trading logic lives in this file (or anywhere in the
 * frontend) — the analytics helpers below are reporting only.
 */

export {
  signalsTodayQuery,
  recentSignalsQuery,
  signalQuery,
  myDecisionsQuery,
  recordDecision,
  myTradesQuery,
  tradeEventsQuery,
  createTrade,
  closeTrade,
  latestHeartbeatQuery,
  heartbeatHistoryQuery,
  scannerRunsQuery,
  blockingGatesTodayQuery,
  lastPurgeQuery,
  RETENTION_WINDOWS,

  instrumentsQuery,
  macroEventsQuery,
  activeRulebookQuery,
  rulebookVersionsQuery,
  myProfileQuery,
  myRolesQuery,
  updateProfile,
  updateAlertPreferences,
  myNotificationsQuery,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  myPushSubscriptionsQuery,
  savePushSubscription,
  removePushSubscription,
} from "./repositories";

export type {
  Signal,
  SignalDecision,
  DecisionValue,
  Trade,
  TradeEvent,
  Heartbeat,
  ScannerRun,
  Instrument,
  MacroEvent,
  RulebookVersion,
  Profile,
  Notification,
} from "./repositories";

import type { Trade } from "./repositories";
import { utcTradingDay } from "./time";

export { utcTradingDay };

/** Kept for reference only: the scanner no longer enforces a daily alert cap. */
export const MAX_DAILY_ALERTS = 0;


/* ---- journal / performance analytics (reporting only, not trading logic) ---- */

export function closedTrades(trades: Trade[]) {
  return trades.filter((t) => t.status === "CLOSED" && t.r_multiple !== null);
}

export function expectancy(trades: Trade[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  const total = closed.reduce((sum, t) => sum + Number(t.r_multiple ?? 0), 0);
  return total / closed.length;
}

export function winRate(trades: Trade[]): number | null {
  const closed = closedTrades(trades);
  if (closed.length === 0) return null;
  return closed.filter((t) => Number(t.r_multiple) > 0).length / closed.length;
}

export function tradesSince(trades: Trade[], sinceMs: number) {
  return trades.filter((t) => new Date(t.opened_at).getTime() >= sinceMs);
}
