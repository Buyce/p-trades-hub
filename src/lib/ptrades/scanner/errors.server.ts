import { AppError, toAppError } from "../errors";

/**
 * Scanner error recording. Every failure inside a run is written to
 * `scanner_errors` with a machine-readable code so health screens can show what
 * failed without the run silently swallowing it. Writes are service-role only
 * and never contain credentials.
 */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type ScannerStage =
  | "LOCK"
  | "RULEBOOK"
  | "MACRO"
  | "SYMBOL_RESOLUTION"
  | "MARKET_DATA"
  | "NORMALISATION"
  | "EVALUATION"
  | "PERSISTENCE"
  | "PROMOTION"
  | "NOTIFICATION";

export async function recordScannerError(
  admin: Admin,
  input: {
    runId: string | null;
    instrument?: string | null;
    stage: ScannerStage;
    error: unknown;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const appError: AppError = toAppError(input.error, "UNKNOWN", input.detail ?? {});
  const { error } = await admin.from("scanner_errors").insert({
    scanner_run_id: input.runId,
    instrument: input.instrument ?? null,
    stage: input.stage,
    error_code: appError.code,
    message: appError.message.slice(0, 500),
    detail: { ...appError.detail, ...(input.detail ?? {}) } as never,
  });
  if (error) console.error("scanner_errors insert failed", error.message);
}
