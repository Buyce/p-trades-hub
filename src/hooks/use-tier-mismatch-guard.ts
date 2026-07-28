/**
 * Client-side guard that verifies a rendered tier against the stored tier.
 *
 * It never changes what is displayed — the badge keeps rendering the value it
 * was given — it only reports the discrepancy so the incident is auditable and
 * the user is told the stored tier is authoritative.
 */

import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { reportTierMismatch } from "@/lib/ptrades/tier-mismatch.functions";
import { tierLabel } from "@/lib/ptrades/tiers";

/** Prevents repeat reports for the same signal + displayed tier per session. */
const reported = new Set<string>();

export function useTierMismatchGuard(
  signalId: string | null | undefined,
  displayedTier: string | null | undefined,
  surface: string,
) {
  const report = useServerFn(reportTierMismatch);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!signalId) return;
    const key = `${signalId}:${displayedTier ?? "none"}`;
    if (reported.has(key) || inFlight.current) return;
    reported.add(key);
    inFlight.current = true;

    let cancelled = false;
    void report({ data: { signalId, displayedTier: displayedTier ?? null, surface } })
      .then((result) => {
        if (cancelled || !result.mismatch) return;
        toast.error("Tier mismatch detected", {
          description: `Showing ${tierLabel(displayedTier)} but the stored tier is ${tierLabel(result.storedTier)}. The stored tier is authoritative.`,
        });
      })
      .catch(() => {
        // Detector must never break a screen; the server log carries the truth.
        reported.delete(key);
      })
      .finally(() => {
        inFlight.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [signalId, displayedTier, surface, report]);
}
