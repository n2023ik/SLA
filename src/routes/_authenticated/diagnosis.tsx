import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { ConfidenceBar, EmptyState, KpiCard, Panel, StatusPill } from "@/components/ops/primitives";
import { STAGE_LABELS } from "@/lib/diagnosis/engine";
import type { Stage } from "@/lib/diagnosis/types";
import { snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/diagnosis")({
  head: () => ({
    meta: [
      { title: "Delay Diagnosis — SLA Control" },
      {
        name: "description",
        content:
          "Per-order root cause analysis: which stage caused the delay, expected vs actual time, supporting evidence, confidence and the corrective action.",
      },
      { property: "og:title", content: "Delay Diagnosis — SLA Control" },
      {
        property: "og:description",
        content: "Root cause, evidence and corrective action for every delayed order.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: DiagnosisPage,
});

const STAGES: Stage[] = ["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"];

function DiagnosisPage() {
  const { data } = useSuspenseQuery(snapshotQuery(30));
  const [stage, setStage] = useState<Stage | "ALL">("ALL");
  const [zone, setZone] = useState<string>("ALL");
  const [limit, setLimit] = useState(24);

  const orderById = useMemo(
    () => new Map(data.orders.map((o) => [o.orderId, o])),
    [data.orders],
  );

  const filtered = data.diagnoses.filter((d) => {
    if (stage !== "ALL" && d.stage !== stage) return false;
    if (zone !== "ALL" && orderById.get(d.orderId)?.zoneId !== zone) return false;
    return true;
  });

  const stageCounts = STAGES.map((s) => ({
    stage: s,
    count: data.diagnoses.filter((d) => d.stage === s).length,
  }));

  return (
    <AppShell
      title="Delay Diagnosis"
      subtitle="Every at-risk or breached order with the stage that caused the delay, the probable root cause and its evidence."
    >
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Diagnosed orders" value={data.diagnoses.length} tone="warn" />
        <KpiCard
          label="Recurring patterns"
          value={data.diagnoses.filter((d) => d.recurring).length}
          tone="danger"
        />
        {stageCounts.map(({ stage: s, count }) => (
          <KpiCard key={s} label={STAGE_LABELS[s]} value={count} />
        ))}
      </div>

      <Panel
        title="Filters"
        actions={
          <span className="text-xs text-muted-foreground">
            {filtered.length} matching diagnoses
          </span>
        }
      >
        <div className="flex flex-wrap gap-3">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Stage | "ALL")}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            aria-label="Filter by stage"
          >
            <option value="ALL">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            aria-label="Filter by zone"
          >
            <option value="ALL">All zones</option>
            {data.zones.map((z) => (
              <option key={z.zoneId} value={z.zoneId}>
                {z.zoneId} · {z.zoneName}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      {filtered.length === 0 ? (
        <EmptyState message="No diagnoses match these filters." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.slice(0, limit).map((d) => {
            const order = orderById.get(d.orderId);
            return (
              <article key={`${d.orderId}-${d.stage}`} className="panel p-5">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: d.orderId }}
                      className="num text-sm font-semibold text-primary hover:underline"
                    >
                      {d.orderId}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order?.zoneId} · {order?.shift.toLowerCase()} shift · {order?.hour}:00 ·{" "}
                      {order?.totalItems} items
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.recurring ? <StatusPill status="HIGH" label="Recurring" /> : null}
                    <StatusPill status={order?.slaStatus ?? "AT_RISK"} />
                  </div>
                </header>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Delayed stage</p>
                    <p className="mt-1 text-sm font-medium">{STAGE_LABELS[d.stage]}</p>
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Actual</p>
                    <p className="num mt-1 text-sm font-medium text-danger">{d.actualMinutes} min</p>
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected</p>
                    <p className="num mt-1 text-sm font-medium text-ok">{d.expectedMinutes} min</p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Root cause</p>
                  <p className="mt-1 text-sm font-medium">{d.rootCause}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Confidence</span>
                    <ConfidenceBar value={d.confidenceScore} />
                    <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {d.category.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Supporting evidence
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {d.evidence.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="text-primary">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                  → {d.recommendedAction}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {limit < filtered.length ? (
        <button
          type="button"
          onClick={() => setLimit((v) => v + 24)}
          className="mx-auto block rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Load more diagnoses
        </button>
      ) : null}
    </AppShell>
  );
}
