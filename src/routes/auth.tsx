/**
 * Operator sign-in. Operational data is only readable by an authenticated
 * operator, so this is the entry point to the console.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  // Auth state is browser-only; avoid hydrating a server placeholder into the
  // interactive sign-in form after a protected-route redirect.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operator Sign In — SLA Control" },
      {
        name: "description",
        content:
          "Sign in to the quick-commerce SLA operations console to review breach diagnosis, workforce bottlenecks and recorded interventions.",
      },
      { property: "og:title", content: "Operator Sign In — SLA Control" },
      {
        property: "og:description",
        content: "Authenticated access to SLA diagnosis and workforce bottleneck analytics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // An agent client's consent screen sends unauthenticated operators here and
  // preserves the page to return to.
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  component: AuthPage,
});

const field =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

/** Only same-origin relative paths are followed after sign in. */
const safeNext = (next: string | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") ? next : null;

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const goOn = () => {
    const target = safeNext(next);
    if (target) {
      window.location.replace(target);
      return;
    }
    navigate({ to: "/", replace: true });
  };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const target = safeNext(next);
      if (target) window.location.replace(target);
      else navigate({ to: "/", replace: true });
    });
  }, [navigate, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${safeNext(next) ?? "/"}`,
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required, then sign in.");
        setMode("signin");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      goOn();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      toast.error(
        message.toLowerCase().includes("invalid login credentials")
          ? "Invalid email or password. Create an account first, or check your credentials."
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!email) {
      toast.error("Enter your email address first.");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}${safeNext(next) ?? "/"}` },
    });
    setResending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Confirmation email sent. Check spam or junk folders too.");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          SLA Control
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Operator sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Order, workforce and intervention data is restricted to signed-in operators.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block text-xs uppercase tracking-wide text-muted-foreground">
            Work email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </label>
          <label className="block text-xs uppercase tracking-wide text-muted-foreground">
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`mt-1 ${field}`}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
        {mode === "signin" && (
          <button
            type="button"
            onClick={() => void resendConfirmation()}
            disabled={resending}
            className="mt-3 w-full text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-60"
          >
            {resending ? "Sending confirmation..." : "Resend confirmation email"}
          </button>
        )}
      </div>
    </main>
  );
}
