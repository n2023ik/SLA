import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "neutral" | "info";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/12 text-ok",
  warn: "border-warn/40 bg-warn/12 text-warn",
  danger: "border-danger/50 bg-danger/15 text-danger",
  info: "border-primary/40 bg-primary/12 text-primary",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function toneForStatus(status: string): Tone {
  switch (status) {
    case "ON_TRACK":
      return "ok";
    case "AT_RISK":
    case "MEDIUM":
      return "warn";
    case "BREACHED":
    case "HIGH":
      return "danger";
    case "LOW":
      return "info";
    default:
      return "neutral";
  }
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const tone = toneForStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel p-5", className)}>
      {title ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground/80">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: Tone;
}) {
  const accent: Record<Tone, string> = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    info: "text-primary",
    neutral: "text-foreground",
  };
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("num mt-2 text-2xl font-semibold", accent[tone])}>
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 75 ? "bg-danger" : pct >= 60 ? "bg-warn" : "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-top text-sm", className)}>{children}</td>;
}

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}
