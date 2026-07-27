import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { callBackend, type BackendResult } from "./backend.server";

export type BackendPayload = { [key: string]: Json | undefined };

export const getBackendHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendPayload>> => callBackend("/health"));

export const getBackendConfiguration = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendPayload>> => callBackend("/configuration"));

export const getMt5Status = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<BackendResult<BackendPayload>> => callBackend("/mt5/status"));
