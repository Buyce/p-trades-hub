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
import { getAlertTestMode, setAlertTestMode } from "@/lib/ptrades/alert-test.functions";
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
import { TierToggle } from "@/components/ptrades/tier-toggle";
import {
  DEFAULT_EMAIL_TIERS,
  DEFAULT_PUSH_TIERS,
  DEFAULT_TERMINAL_TIERS,
  parseTiers,
  type Tier,
} from "@/lib/ptrades/tiers";
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

  const tierPrefs = useMutation({
    mutationFn: (patch: { emailTiers?: Tier[]; pushTiers?: Tier[]; terminalTiers?: Tier[] }) =>
      updateAlertPreferences({ userId: user?.id, ...patch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Alert tiers updated.");
    },
    onError: (error) => toast.error(userMessageOf(error)),
  });

  const emailTiers = parseTiers(profile?.alert_tiers_email, DEFAULT_EMAIL_TIERS);
  const pushTiers = parseTiers(profile?.alert_tiers_push, DEFAULT_PUSH_TIERS);
  const terminalTiers = parseTiers(profile?.alert_tiers_terminal, DEFAULT_TERMINAL_TIERS);

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

  /* ---- staff: alert delivery test mode ---- */
  const readTestMode = useServerFn(getAlertTestMode);
  const writeTestMode = useServerFn(setAlertTestMode);
  const { data: testMode } = useQuery({
    queryKey: ["scanner", "alertTestMode"],
    queryFn: () => readTestMode(),
    enabled: isStaff,
    retry: false,
  });
  const toggleTestMode = useMutation({
    mutationFn: (enabled: boolean) => writeTestMode({ data: { enabled } }),
    onSuccess: (_d, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["scanner", "alertTestMode"] });
      toast.success(
        enabled
          ? "Alert test mode on — the next armed setup sends a sample alert."
          : "Alert test mode off.",
      );
    },
    onError: (e: unknown) => toast.error(userMessageOf(e)),
  });

  /* ---- staff: historical review (past x days) ---- */
  const readBackfill = useServerFn(getBackfillConfig);
  const writeBackfill = useServerFn(setBackfillConfig);
  const { data: backfill } = useQuery({
    queryKey: ["scanner", "backfillConfig"],
    queryFn: () => readBackfill(),
    enabled: isStaff,
    retry: false,
    refetchInterval: 60_000,
  });
  const saveBackfill = useMutation({
    mutationFn: (input: {
      days: number;
      maxBarsPerTick: number;
      budgetMs: number;
      restart?: boolean;
    }) => writeBackfill({ data: input }),
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: ["scanner", "backfillConfig"] });
      toast.success(
        input.days === 0
          ? "Historical review switched off."
          : `Reviewing the past ${input.days} day${input.days === 1 ? "" : "s"}.`,
      );
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
            Every tier passes the same safety gates; only the reward-to-risk floor differs (A+/A
            2.0R, B 1.5R, C 1.2R). There is no daily cap. Alerts always appear in the
            in-app list — these controls decide what is delivered and what the terminal shows.
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

          <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-3">
            <Label className="text-xs">Email me these tiers</Label>
            <TierToggle
              idPrefix="tier-email"
              value={emailTiers}
              disabled={tierPrefs.isPending || !profile?.email_alerts_enabled}
              onChange={(next) => tierPrefs.mutate({ emailTiers: next })}
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

          <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-3">
            <Label className="text-xs">Push me these tiers</Label>
            <TierToggle
              idPrefix="tier-push"
              value={pushTiers}
              disabled={tierPrefs.isPending || !profile?.push_alerts_enabled}
              onChange={(next) => tierPrefs.mutate({ pushTiers: next })}
            />
          </div>

          <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-3">
            <Label className="text-xs">Show these tiers in the terminal</Label>
            <TierToggle
              idPrefix="tier-terminal"
              value={terminalTiers}
              disabled={tierPrefs.isPending}
              onChange={(next) => tierPrefs.mutate({ terminalTiers: next })}
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


      {isStaff ? (
        <SectionCard title="Alert delivery test">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="alert-test-mode">Send a sample alert when a setup arms</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Proves the in-app, push and email channels end to end without waiting for an
                  execution trigger. Test alerts are labelled [TEST], are never actionable and
                  never change detection, scoring or tiers. Switch it off once delivery is
                  confirmed.
                </p>
              </div>
              <Switch
                id="alert-test-mode"
                checked={Boolean(testMode?.enabled)}
                disabled={toggleTestMode.isPending}
                onCheckedChange={(checked) => toggleTestMode.mutate(checked)}
              />
            </div>
            <DataRow
              label="Status"
              value={testMode?.enabled ? "Test mode active" : "Off"}
              mono={false}
            />
          </div>
        </SectionCard>
      ) : null}

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
