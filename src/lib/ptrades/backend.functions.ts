import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callBackend, type BackendResult } from "./backend.server";

export type BackendHealth = Record<string, unknown>;

export const getBackendHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendHealth>> => callBackend("/health"));

export const getBackendConfiguration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendHealth>> => callBackend("/configuration"));

export const getMt5Status = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendHealth>> => callBackend("/mt5/status"));
