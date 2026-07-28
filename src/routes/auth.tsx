import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PUBLISHED_APP_ORIGIN = "https://getptrades.com";

function getAuthRedirectOrigin() {
  if (window.location.hostname.endsWith("lovable.app") || window.location.hostname === "localhost") {
    return PUBLISHED_APP_ORIGIN;
  }
  return window.location.origin;
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — P-Trades" },
      {
        name: "description",
        content: "Sign in or create an account for the P-Trades discretionary trading cockpit.",
      },
      { property: "og:title", content: "Sign in — P-Trades" },
      {
        property: "og:description",
        content: "Sign in or create an account for the P-Trades cockpit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function HelpPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <h2 className="text-sm font-semibold text-foreground">Account access help</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        P-Trades accounts are invite-only. If you do not have an invite, contact an owner or admin.
      </p>

      <ol className="mt-3 space-y-2.5 text-xs text-muted-foreground">
        <li className="flex gap-2">
          <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-medium text-foreground">
            1
          </span>
          <span>
            An owner or admin sends an invite to your email. Wait for the invitation message.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-medium text-foreground">
            2
          </span>
          <span>
            Open the invite link and choose a secure password. This confirms your account.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-medium text-foreground">
            3
          </span>
          <span>
            Return to this page and sign in with your email and password.
          </span>
        </li>
      </ol>

      <p className="mt-3 text-xs text-muted-foreground">
        Did not receive the invite? Check your spam folder, or ask the admin to resend it. If you already signed up but have not confirmed, use the resend button above.
      </p>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);

  async function resendConfirmation() {
    if (!email) {
      toast.error("Enter your email address first.");
      return;
    }
    setResending(true);
    const redirectOrigin = getAuthRedirectOrigin();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: redirectOrigin },
    });
    setResending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If that account is still unconfirmed, a new link is on its way.");
  }


  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);

    if (mode === "forgot") {
      const redirectOrigin = getAuthRedirectOrigin();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectOrigin}/reset-password`,
      });
      setPending(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("If that email has an account, a reset link is on its way.");
      setMode("signin");
      return;
    }

    if (mode === "signup") {
      const redirectOrigin = getAuthRedirectOrigin();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectOrigin },
      });
      setPending(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      toast.success("Check your email to confirm your account.");
      setMode("signin");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";


  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <p className="num text-xs uppercase tracking-[0.2em] text-muted-foreground">P-Trades</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Trading cockpit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isForgot
            ? "Enter your email and we'll send you a password reset link."
            : isSignup
              ? "Create an account to access the read-only trading cockpit."
              : "Sign in to your P-Trades account."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12"
            />
          </div>
          {!isForgot && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
                minLength={isSignup ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12"
              />
            </div>
          )}
          <Button type="submit" className="h-12 w-full" disabled={pending}>
            {pending
              ? isForgot
                ? "Sending link…"
                : isSignup
                  ? "Creating account…"
                  : "Signing in…"
              : isForgot
                ? "Send reset link"
                : isSignup
                  ? "Create account"
                  : "Sign in"}
          </Button>
        </form>

        {!isForgot && (
          <button
            type="button"
            onClick={() => setMode("forgot")}
            className="mt-5 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot your password?
          </button>
        )}

        {!isForgot && (

          <button
            type="button"
            onClick={resendConfirmation}
            disabled={resending}
            className="mt-3 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
          >
            {resending ? "Sending confirmation email…" : "Didn't get the confirmation email? Resend"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setMode(isSignup || isForgot ? "signin" : "signup")}
          className="mt-3 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {isSignup || isForgot ? "Back to sign in" : "No account? Create one"}
        </button>



        <HelpPanel className="mt-6" />

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          P-Trades is read-only. It never places orders and never modifies your MT5 account.
        </p>
      </div>
    </main>
  );
}

