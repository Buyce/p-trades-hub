import { supabase } from "@/integrations/supabase/client";
import { AppError, fromPostgrest } from "../errors";

/**
 * The only module in the browser bundle that touches the database client for
 * application data. Repositories import `db` from here; screens import
 * repositories. Auth session handling lives in `session.ts`.
 */
export const db = supabase;

type Result<T> = { data: T; error: { message: string; code?: string | null } | null };

/** Unwraps a PostgREST result into data or a typed AppError. */
export async function unwrap<T>(
  promise: PromiseLike<Result<T>>,
  context: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw fromPostgrest(error, context);
  return data;
}

/** Unwraps a list read, normalising null to an empty array. */
export async function unwrapList<T>(
  promise: PromiseLike<Result<T[] | null>>,
  context: Record<string, unknown> = {},
): Promise<T[]> {
  return (await unwrap(promise, context)) ?? [];
}

/** Guards a write that requires a signed-in user. */
export function requireUserId(userId: string | undefined | null): string {
  if (!userId) throw new AppError("UNAUTHENTICATED", "write attempted without a session");
  return userId;
}
