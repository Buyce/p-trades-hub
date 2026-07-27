import { queryOptions } from "@tanstack/react-query";
import type { Tables, Enums } from "@/integrations/supabase/types";
import { db, requireUserId, unwrapList } from "./client";
import { fromPostgrest } from "../errors";

/** Repository for the user's own signal decisions (journal write path). */

export type SignalDecision = Tables<"signal_decisions">;
export type DecisionValue = Enums<"decision_type">;

export const myDecisionsQuery = () =>
  queryOptions({
    queryKey: ["signal_decisions"],
    queryFn: () =>
      unwrapList(
        db.from("signal_decisions").select("*").order("decided_at", { ascending: false }),
        { repo: "decisions.mine" },
      ),
  });

export async function recordDecision(input: {
  userId: string | undefined;
  signalId: string;
  decision: DecisionValue;
  note?: string | null;
}): Promise<void> {
  const userId = requireUserId(input.userId);
  const { error } = await db.from("signal_decisions").upsert(
    {
      user_id: userId,
      signal_id: input.signalId,
      decision: input.decision,
      note: input.note?.trim() ? input.note.trim() : null,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "user_id,signal_id" },
  );
  if (error) throw fromPostgrest(error, { repo: "decisions.record" });
}
