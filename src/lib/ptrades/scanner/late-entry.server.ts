/**
 * Late-entry rejection: price has already travelled too far from the entry zone
 * for the published entry to remain valid.
 */

export type LateEntryResult = {
  late: boolean;
  distanceAtr: number | null;
};

export function checkLateEntry(
  lastClose: number | null,
  entryLow: number | null,
  entryHigh: number | null,
  atrValue: number | null,
  maxAtr = 0.5,
): LateEntryResult {
  if (
    lastClose === null ||
    entryLow === null ||
    entryHigh === null ||
    !atrValue ||
    atrValue <= 0
  ) {
    return { late: false, distanceAtr: null };
  }
  const distance =
    lastClose > entryHigh
      ? lastClose - entryHigh
      : lastClose < entryLow
        ? entryLow - lastClose
        : 0;
  const distanceAtr = distance / atrValue;
  return { late: distanceAtr > maxAtr, distanceAtr };
}
