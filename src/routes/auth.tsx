import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <p className="num text-xs uppercase tracking-[0.2em] text-muted-foreground">P-Trades</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Trading cockpit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isSignup
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
          <Button type="submit" className="h-12 w-full" disabled={pending}>
            {pending
              ? isSignup
                ? "Creating account…"
                : "Signing in…"
              : isSignup
                ? "Create account"
                : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode(isSignup ? "signin" : "signup")}
          className="mt-5 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {isSignup ? "Already have an account? Sign in" : "No account? Create one"}
        </button>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          P-Trades is read-only. It never places orders and never modifies your MT5 account.
        </p>
      </div>
    </main>
  );
}

