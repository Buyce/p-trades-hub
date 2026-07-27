import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { myProfileQuery, myRolesQuery } from "./queries";

export function useSessionUser() {
  return useQuery({
    queryKey: ["auth", "user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user ?? null;
    },
    staleTime: 30_000,
  });
}

export function useProfile() {
  const { data: user } = useSessionUser();
  return useQuery(myProfileQuery(user?.id));
}

export function useTimezone(): string {
  const { data: profile } = useProfile();
  return profile?.timezone ?? "UTC";
}

export function useIsStaff(): boolean {
  const { data: user } = useSessionUser();
  const { data: roles } = useQuery(myRolesQuery(user?.id));
  return Boolean(roles?.some((r) => r.role === "owner" || r.role === "admin"));
}
