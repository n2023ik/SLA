import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Gauge,
  ClipboardCheck,
  History,
  Lightbulb,
  Radar,
  Users,
  LogOut,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Operations Overview", icon: Gauge },
  { to: "/live-orders", label: "Live Orders", icon: Activity },
  { to: "/diagnosis", label: "Diagnosis", icon: AlertTriangle },
  { to: "/workforce", label: "Workforce Analytics", icon: Users },
  { to: "/bottlenecks", label: "Bottleneck Analysis", icon: Radar },
  { to: "/recommendations", label: "Recommendations", icon: Lightbulb },
  { to: "/interventions", label: "Interventions", icon: ClipboardCheck },
  { to: "/historical", label: "Historical Analysis", icon: History },
] as const;

interface AppShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Ordered sign-out: stop in-flight reads, drop cached operational data, clear
  // the session, then leave the console without keeping it on the back stack.
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-border bg-surface lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 px-5 py-5">
            <BarChart3 className="size-5 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold leading-tight">SLA Control</p>
              <p className="text-xs text-muted-foreground">Quick-commerce diagnosis</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-6">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                activeProps={{ className: "bg-accent text-accent-foreground font-medium" }}
              >
                <Icon className="size-4" aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="px-3 pb-4 lg:mt-auto">
            <button
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4" aria-hidden />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="grid-bg border-b border-border px-5 py-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                {subtitle ? (
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
              </div>
              {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </div>
          </header>
          <div className="space-y-6 px-5 py-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
