import { queryOptions } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { db, unwrap, unwrapList } from "./client";

/** Repository for rulebook versions. Read-only in the browser by design. */

export type RulebookVersion = Tables<"rulebook_versions">;

export const activeRulebookQuery = () =>
  queryOptions({
    queryKey: ["rulebook", "active"],
    queryFn: () =>
      unwrap(
        db
          .from("rulebook_versions")
          .select("*")
          .eq("is_active", true)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
        { repo: "rulebooks.active" },
      ),
  });

export const rulebookVersionsQuery = () =>
  queryOptions({
    queryKey: ["rulebook", "all"],
    queryFn: () =>
      unwrapList(
        db.from("rulebook_versions").select("*").order("effective_from", { ascending: false }),
        { repo: "rulebooks.all" },
      ),
  });
