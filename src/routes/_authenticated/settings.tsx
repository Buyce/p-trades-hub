import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsStaff, useProfile, useSessionUser } from "@/lib/ptrades/session";
import { TIMEZONES } from "@/lib/ptrades/format";
import { DataRow, PageHeader, SectionCard } from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — P-Trades" },
      {
        name: "description",
        content: "Display name, timezone and session controls for your P-Trades account.",
      },
      { property: "og:title", content: "Settings — P-Trades" },
      { property: "og:description", content: "Account preferences for the P-Trades cockpit." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useSessionUser();
  const { data: profile } = useProfile();
  const isStaff = useIsStaff();
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setTimezone(profile.timezone ?? "UTC");
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: user.id, display_name: displayName.trim() || null, timezone });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Preferences saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Account preferences and session." />

      <SectionCard title="Profile">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-12"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone" className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Timestamps are stored in UTC and rendered in this timezone.
            </p>
          </div>
          <Button className="h-12 w-full" onClick={() => save.mutate()} disabled={save.isPending}>
            Save preferences
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Account">
        <DataRow label="Email" value={user?.email ?? undefined} />
        <DataRow label="Access" value={isStaff ? "Owner / admin" : "Trader"} />
        <DataRow label="Execution" value="Disabled — P-Trades never places orders" mono={false} />
      </SectionCard>

      <Button variant="outline" className="h-12 w-full" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
