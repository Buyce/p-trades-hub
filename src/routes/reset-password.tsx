import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — P-Trades" },
      {
        name: "description",
        content: "Set a new password for your P-Trades trading cockpit account.",
      },
      { property: "og:title", content: "Reset password — P-Trades" },
      {
        property: "og:description",
        content: "Set a new password for your P-Trades account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let done = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        done = true;
        setValid(true);
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (done) return;
      setValid(Boolean(data.session));
      setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated.");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <p className="num text-xs uppercase tracking-[0.2em] text-muted-foreground">P-Trades</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Set a new password</h1>

        {!ready ? (
          <p className="mt-4 text-sm text-muted-foreground">Verifying your reset link…</p>
        ) : !valid ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Button
              className="mt-6 h-12 w-full"
              onClick={() => navigate({ to: "/auth", replace: true })}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-12"
                />
              </div>
              <Button type="submit" className="h-12 w-full" disabled={pending}>
                {pending ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          P-Trades is read-only. It never places orders and never modifies your MT5 account.
        </p>
      </div>
    </main>
  );
}
