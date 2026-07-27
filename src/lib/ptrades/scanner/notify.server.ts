/**
 * Notifications. In SHADOW MODE nothing is sent: candidates and rejections are
 * stored and displayed, but no actionable alert reaches a user.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export async function notifyQualifiedSignal(
  admin: Admin,
  options: {
    shadowMode: boolean;
    signalId: string;
    instrument: string;
    direction: string;
    grade: string | null;
    rr: number | null;
  },
): Promise<{ sent: number; suppressed: boolean }> {
  if (options.shadowMode) {
    return { sent: 0, suppressed: true };
  }

  const { data: profiles, error } = await admin.from("profiles").select("id");
  if (error || !profiles?.length) {
    if (error) console.error("notification recipients lookup failed", error.message);
    return { sent: 0, suppressed: false };
  }

  const title = `${options.instrument} ${options.direction} — ${options.grade ?? "graded"}`;
  const body = options.rr
    ? `Qualified setup with ${options.rr.toFixed(2)}R to TP1. You place the trade manually.`
    : "Qualified setup. You place the trade manually.";

  const { error: insertError } = await admin.from("notifications").insert(
    profiles.map((p) => ({
      user_id: p.id,
      signal_id: options.signalId,
      title,
      body,
    })),
  );
  if (insertError) {
    console.error("notification insert failed", insertError.message);
    return { sent: 0, suppressed: false };
  }
  return { sent: profiles.length, suppressed: false };
}
