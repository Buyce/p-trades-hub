import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UNAVAILABLE, gradeLabel } from "@/lib/ptrades/format";

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card", className)}
      aria-label={title}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DataRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  const unavailable = value === UNAVAILABLE || value === null || value === undefined;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right text-sm",
          mono && "num",
          unavailable ? "italic text-muted-foreground/70" : "text-foreground",
        )}
      >
        {unavailable ? UNAVAILABLE : value}
      </span>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "positive" | "negative" | "accent";
}) {
  const toneClass = {
    neutral: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
    accent: "text-primary",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("num mt-1.5 text-2xl font-semibold", toneClass)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatusPill({
  state,
  children,
}: {
  state: "ok" | "warn" | "down" | "idle";
  children: ReactNode;
}) {
  const styles = {
    ok: "border-success/40 bg-success/10 text-success",
    warn: "border-warning/40 bg-warning/10 text-warning",
    down: "border-destructive/40 bg-destructive/10 text-destructive",
    idle: "border-border bg-muted text-muted-foreground",
  }[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        styles,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/**
 * Renders the tier stored on the record. The badge never derives or upgrades a
 * tier — an unlabelled record shows as unavailable rather than guessing.
 */
export function GradeBadge({ grade }: { grade: string | null | undefined }) {
  const label = gradeLabel(grade);
  const top = grade === "A_PLUS" || grade === "A";
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold",
        top
          ? "border-primary/50 bg-primary/10 text-primary"
          : grade === "B"
            ? "border-warning/50 bg-warning/10 text-warning"
            : "border-border bg-muted text-muted-foreground",
      )}
      title={`Tier ${label}`}
    >
      {label}
    </span>
  );
}

export function DirectionTag({ direction }: { direction: string | null | undefined }) {
  if (!direction) return <span className="text-muted-foreground italic">{UNAVAILABLE}</span>;
  const long = direction.toUpperCase().startsWith("L") || direction.toUpperCase() === "BUY";
  return (
    <span
      className={cn(
        "num rounded px-1.5 py-0.5 text-xs font-semibold uppercase",
        long ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive",
      )}
    >
      {direction}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
