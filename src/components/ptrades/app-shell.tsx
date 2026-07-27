import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ListChecks,
  NotebookPen,
  BarChart3,
  Activity,
  BookOpen,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsStaff } from "@/lib/ptrades/session";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, staff: false },
  { to: "/watchlist", label: "Watchlist", icon: ListChecks, staff: false },
  { to: "/journal", label: "Journal", icon: NotebookPen, staff: false },
  { to: "/performance", label: "Performance", icon: BarChart3, staff: false },
  { to: "/scanner-health", label: "Scanner", icon: Activity, staff: true },
  { to: "/rulebook", label: "Rulebook", icon: BookOpen, staff: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, staff: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const isStaff = useIsStaff();
  const items = NAV.filter((item) => !item.staff || isStaff);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-surface lg:block">
        <div className="px-5 py-5">
          <p className="num text-sm font-semibold tracking-tight text-foreground">P-TRADES</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Trading cockpit
          </p>
        </div>
        <nav className="px-2 pb-6">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <p className="num text-sm font-semibold tracking-tight">P-TRADES</p>
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground data-[status=active]:text-foreground"
          >
            <SettingsIcon className="h-5 w-5" aria-hidden />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-28 lg:max-w-4xl lg:px-8 lg:pt-8 lg:pb-12">
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/98 backdrop-blur lg:hidden">
          <ul className="grid grid-cols-5">
            {items.slice(0, 5).map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium text-muted-foreground",
                    "transition-colors data-[status=active]:text-primary",
                  )}
                >
                  <item.icon className="h-5 w-5" aria-hidden />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
