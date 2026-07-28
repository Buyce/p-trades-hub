import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  updateProfile,
  updateAlertPreferences,
  savePushSubscription,
  removePushSubscription,
} from "@/lib/ptrades/queries";
import { getPushPublicKey } from "@/lib/ptrades/push.functions";
import {
  pushPermission,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  currentPushSubscription,
} from "@/lib/ptrades/push";
import { userMessageOf } from "@/lib/ptrades/errors";
import { useIsStaff, useProfile, useSessionUser } from "@/lib/ptrades/session";
import { TIMEZONES } from "@/lib/ptrades/format";
import { DataRow, PageHeader, SectionCard } from "@/components/ptrades/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
      await updateProfile({
        userId: user?.id,
        displayName: displayName.trim() || null,
        timezone,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Preferences saved");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  /* ---- alert channels ---- */
  const keyFn = useServerFn(getPushPublicKey);
  const { data: pushKey } = useQuery({
    queryKey: ["push", "publicKey"],
    queryFn: () => keyFn(),
    staleTime: Infinity,
    retry: false,
  });

  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    let active = true;
    currentPushSubscription()
      .then((sub) => active && setDeviceSubscribed(Boolean(sub)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const emailAlerts = useMutation({
    mutationFn: (enabled: boolean) =>
      updateAlertPreferences({ userId: user?.id, emailAlertsEnabled: enabled }),
    onSuccess: (_d, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success(enabled ? "Email alerts on" : "Email alerts off");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  const pushAlerts = useMutation({
    mutationFn: (enabled: boolean) =>
      updateAlertPreferences({ userId: user?.id, pushAlertsEnabled: enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  const enableDevice = useMutation({
    mutationFn: async () => {
      if (!pushKey?.publicKey) throw new Error("Push is not configured on the server.");
      const keys = await subscribeToPush(pushKey.publicKey);
      await savePushSubscription({
        userId: user?.id,
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      });
    },
    onSuccess: () => {
      setDeviceSubscribed(true);
      pushAlerts.mutate(true);
      toast.success("Push notifications enabled on this device");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  const disableDevice = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await removePushSubscription(endpoint);
    },
    onSuccess: () => {
      setDeviceSubscribed(false);
      toast.success("Push notifications disabled on this device");
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
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

      <SectionCard title="Alerts">
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Alerts fire only for A / A+ setups that pass every rulebook gate, capped at the daily
            limit. They always appear in the in-app alert list; these switches add delivery.
          </p>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="email-alerts">Email alerts</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Sent to {user?.email ?? "your account email"} with direction, entry, stop, targets
                and R:R.
              </p>
            </div>
            <Switch
              id="email-alerts"
              checked={Boolean(profile?.email_alerts_enabled)}
              disabled={emailAlerts.isPending}
              onCheckedChange={(checked) => emailAlerts.mutate(checked)}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="push-alerts">Browser push</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {supported
                  ? deviceSubscribed
                    ? "This device is registered for push notifications."
                    : "Register this device to receive alerts even when the app is closed."
                  : "This browser does not support push notifications."}
              </p>
            </div>
            <Switch
              id="push-alerts"
              checked={Boolean(profile?.push_alerts_enabled)}
              disabled={pushAlerts.isPending}
              onCheckedChange={(checked) => pushAlerts.mutate(checked)}
            />
          </div>

          <Button
            variant="outline"
            className="h-12 w-full"
            disabled={
              !supported ||
              !pushKey?.publicKey ||
              enableDevice.isPending ||
              disableDevice.isPending
            }
            onClick={() => (deviceSubscribed ? disableDevice.mutate() : enableDevice.mutate())}
          >
            {deviceSubscribed ? "Unregister this device" : "Enable push on this device"}
          </Button>

          <DataRow
            label="Permission"
            value={pushPermission()}
            mono={false}
          />
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
