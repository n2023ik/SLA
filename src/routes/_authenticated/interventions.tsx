/**
 * Intervention history: what an operator recorded, what they measured before and
 * after, and whether the recorded outcome was an improvement. Nothing on this
 * page is inferred — an empty table means no action has been recorded.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/ops/AppShell";
import { DataTable, EmptyState, KpiCard, Panel, StatusPill, Td, Th } from "@/components/ops/primitives";
import {
  ABSOLUTE_CHANGE_LABEL,
  METRIC_LABEL,
  METRIC_UNIT,
  OUTCOMES,
  OUTCOME_LABEL,
  interventionKpis,
  outcomeBreakdown,
  type Outcome,
} from "@/lib/interventions";
import { updateIntervention } from "@/lib/ops.functions";
import { interventionsQuery, snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/interventions")({
  head: () => ({
    meta: [
      { title: "Intervention History — SLA Control" },
      {
        name: "description",
        content:
          "Recorded operational interventions with the recommendation behind them, before and after measurements, improvement and outcome.",
      },
      { property: "og:title", content: "Intervention History — SLA Control" },
      {
        property: "og:description",
        content: "Before/after measurement and recorded outcome for every logged intervention.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: InterventionsPage,
});

const field = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground";

function InterventionsPage() {
  const { data: snapshot } = useSuspenseQuery(snapshotQuery(30));
  const interventions = useQuery(interventionsQuery());
  const queryClient = useQueryClient();
  const update = useServerFn(updateIntervention);

  const [filters, setFilters] = useState({
    from: "",
    to: "",
    stage: "",
    rootCause: "",
    zone: "",
    outcome: "",
  });
  const [measure, setMeasure] = useState<{ id: string; after: string; outcome: Outcome } | null>(
    null,
  );

  const rows = useMemo(() => {
    const all = interventions.data ?? [];
    return all.filter((i) => {
      const day = i.actionAt.slice(0, 10);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      if (filters.stage && i.stage !== filters.stage) return false;
      if (filters.rootCause && i.rootCause !== filters.rootCause) return false;
      if (filters.zone && i.zoneId !== filters.zone) return false;
      if (filters.outcome && i.outcome !== filters.outcome) return false;
      return true;
    });
  }, [interventions.data, filters]);

  const kpis = useMemo(() => interventionKpis(rows), [rows]);
  const byRootCause = useMemo(() => outcomeBreakdown(rows, (r) => r.rootCause), [rows]);

  /** Before vs after per recorded intervention — only rows with both measurements. */
  const chartData = useMemo(
    () =>
      rows
        .filter((r) => r.beforeSla !== null && r.afterSla !== null)
        .slice(0, 12)
        .reverse()
        .map((r, index) => ({
          name: `${index + 1}. ${r.stage ?? r.rootCause ?? "action"}${
            r.zoneId ? ` ${r.zoneId}` : ""
          }`,
          before: r.beforeSla!,
          after: r.afterSla!,
          change: r.improvementAbs ?? 0,
          unit: METRIC_UNIT[r.metric],
        })),
    [rows],
  );

  const saveMeasurement = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: measure!.id,
          afterSla: measure!.after === "" ? null : Number(measure!.after),
          outcome: measure!.outcome,
        },
      }),
    onSuccess: () => {
      toast.success("After measurement recorded");
      setMeasure(null);
      void queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not record the measurement"),
  });

  const zones = [...new Set(snapshot.orders.map((o) => o.zoneId))].sort();

  if (interventions.isError) {
    return (
      <AppShell title="Intervention History" subtitle="Recorded actions and their measured result.">
        <Panel title="Sign in required">
          <EmptyState message="Intervention records are only visible to signed-in operators." />
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Intervention History"
      subtitle="Every action an operator recorded, with the recommendation behind it and the measurement that followed. Improvement only appears once both measurements are recorded."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Interventions recorded" value={kpis.total} tone="info" />
        <KpiCard label="With a measured outcome" value={kpis.withOutcome} />
        <KpiCard label="Improved / resolved" value={kpis.improved + kpis.resolved} tone="ok" />
        <KpiCard label="No change" value={kpis.noChange} tone="warn" />
        <KpiCard label="Worsened" value={kpis.worsened} tone="danger" />
        <KpiCard
          label="Improvement rate (of measured)"
          value={kpis.improvementRatePct === null ? "—" : `${kpis.improvementRatePct}%`}
          hint="Improved or resolved as a share of interventions with a measured outcome"
        />
        <KpiCard
          label="Avg SLA adherence gain"
          value={
            kpis.avgAdherenceGainPoints === null
              ? "—"
              : `${kpis.avgAdherenceGainPoints > 0 ? "+" : ""}${kpis.avgAdherenceGainPoints} pp`
          }
          hint="Percentage-point change across adherence measurements"
        />
        <KpiCard
          label="Avg stage time saved"
          value={kpis.avgMinutesSaved === null ? "—" : `${kpis.avgMinutesSaved} min`}
          hint="Minutes saved across stage-time measurements"
        />
      </div>

      <Panel title="Filters" description="Narrow the history by date, stage, cause, zone or outcome.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Stage
            <select
              value={filters.stage}
              onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
              className={field}
            >
              <option value="">All</option>
              {["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Root cause
            <select
              value={filters.rootCause}
              onChange={(e) => setFilters((f) => ({ ...f, rootCause: e.target.value }))}
              className={field}
            >
              <option value="">All</option>
              {[
                "MANPOWER",
                "ZONE_CONGESTION",
                "PACKING_STATION",
                "RIDER_AVAILABILITY",
                "INVENTORY",
                "INDIVIDUAL_ANOMALY",
                "OTHER",
              ].map((c) => (
                <option key={c} value={c}>
                  {c === "INDIVIDUAL_ANOMALY"
                    ? "Performance pattern (investigation)"
                    : c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Zone
            <select
              value={filters.zone}
              onChange={(e) => setFilters((f) => ({ ...f, zone: e.target.value }))}
              className={field}
            >
              <option value="">All</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Outcome
            <select
              value={filters.outcome}
              onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value }))}
              className={field}
            >
              <option value="">All</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel
        title="Before vs after"
        description="Each bar pair is one recorded intervention. Adherence is a percentage where higher is better; stage time is minutes where lower is better — the unit is shown per row in the table."
      >
        {chartData.length === 0 ? (
          <EmptyState message="No intervention has both a before and an after measurement yet." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--surface))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="before" name="Before" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="after" name="After" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {chartData.length} intervention{chartData.length === 1 ? "" : "s"} with both measurements ·
          average change{" "}
          <span className="num text-foreground">
            {chartData.length === 0
              ? "—"
              : Math.round(
                  (chartData.reduce((a, b) => a + b.change, 0) / chartData.length) * 10,
                ) / 10}
          </span>{" "}
          in each row&apos;s own unit
        </p>
      </Panel>

      <Panel
        title="Recorded interventions"
        description="Recommendation, action, measurement and outcome — with who recorded it and when."
      >
        {rows.length === 0 ? (
          <EmptyState message="No intervention recorded for this filter. History stays empty until an operator records an action on the Recommendations page." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Recommendation</Th>
                <Th>Stage</Th>
                <Th>Root cause</Th>
                <Th>Zone</Th>
                <Th>Action taken</Th>
                <Th>Measurement</Th>
                <Th>Before</Th>
                <Th>After</Th>
                <Th>Change</Th>
                <Th>Outcome</Th>
                <Th>Recorded by</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-t border-border align-top">
                  <Td className="num whitespace-nowrap">
                    {new Date(i.actionAt).toLocaleString()}
                    {i.revisionCount ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({i.revisionCount} edit{i.revisionCount === 1 ? "" : "s"} kept)
                      </span>
                    ) : null}
                  </Td>
                  <Td className="max-w-[16rem]">{i.recommendation}</Td>
                  <Td>{i.stage ? i.stage.replace(/_/g, " ") : "—"}</Td>
                  <Td>
                    {i.rootCause === "INDIVIDUAL_ANOMALY"
                      ? "Performance pattern requiring investigation"
                      : (i.rootCause ?? "—").replace(/_/g, " ")}
                  </Td>
                  <Td>{i.zoneId ?? "—"}</Td>
                  <Td className="max-w-[16rem]">{i.actionTaken}</Td>
                  <Td>{METRIC_LABEL[i.metric]}</Td>
                  <Td className="num">
                    {i.beforeSla === null ? "not measured" : `${i.beforeSla} ${METRIC_UNIT[i.metric]}`}
                  </Td>
                  <Td className="num">
                    {i.afterSla === null ? "not measured" : `${i.afterSla} ${METRIC_UNIT[i.metric]}`}
                  </Td>
                  <Td className="num">
                    {i.improvementAbs === null ? (
                      "—"
                    ) : (
                      <span title={ABSOLUTE_CHANGE_LABEL[i.metric]}>
                        {i.improvementAbs > 0 ? "+" : ""}
                        {i.improvementAbs}
                        {i.metric === "SLA_ADHERENCE_PCT" ? " pp" : " min"}
                        {i.improvementPct !== null ? ` (${i.improvementPct}% rel.)` : ""}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StatusPill status={i.outcome === "PENDING" ? "AT_RISK" : i.outcome} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {i.recordedBy ? `${i.recordedBy.slice(0, 8)}…` : "—"}
                    <button
                      type="button"
                      onClick={() =>
                        setMeasure({
                          id: i.id,
                          after: i.afterSla === null ? "" : String(i.afterSla),
                          outcome: (i.outcome as Outcome) ?? "PENDING",
                        })
                      }
                      className="mt-1 block rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent"
                    >
                      Record after measurement
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {measure ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveMeasurement.mutate();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              After measurement
              <input
                type="number"
                step="0.1"
                value={measure.after}
                onChange={(e) => setMeasure((m) => (m ? { ...m, after: e.target.value } : m))}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Outcome
              <select
                value={measure.outcome}
                onChange={(e) =>
                  setMeasure((m) => (m ? { ...m, outcome: e.target.value as Outcome } : m))
                }
                className={field}
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={saveMeasurement.isPending}
              className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-60"
            >
              {saveMeasurement.isPending ? "Saving…" : "Save measurement"}
            </button>
            <button
              type="button"
              onClick={() => setMeasure(null)}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <p className="text-xs text-muted-foreground">
              The previous values are kept in the edit history.
            </p>
          </form>
        ) : null}
      </Panel>

      <Panel
        title="Which causes responded to action"
        description="Recorded outcomes grouped by the cause the action addressed. Only recorded results count — an untouched cause simply has no rows."
      >
        {byRootCause.length === 0 ? (
          <EmptyState message="No recorded outcome to group yet." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Cause addressed</Th>
                <Th>Interventions</Th>
                <Th>Improved</Th>
                <Th>No change</Th>
                <Th>Worsened</Th>
                <Th>Awaiting measurement</Th>
              </tr>
            </thead>
            <tbody>
              {byRootCause.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <Td>
                    {row.key === "INDIVIDUAL_ANOMALY"
                      ? "Performance pattern requiring investigation"
                      : row.key.replace(/_/g, " ")}
                  </Td>
                  <Td className="num">{row.total}</Td>
                  <Td className="num text-ok">{row.improved}</Td>
                  <Td className="num">{row.noChange}</Td>
                  <Td className="num text-danger">{row.worsened}</Td>
                  <Td className="num">{row.pending}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      <Panel
        title="Recurring bottleneck impact"
        description="Top recurring bottlenecks with any intervention recorded against them. A before/after result appears only once an operator records the measurements."
      >
        <DataTable>
          <thead>
            <tr>
              <Th>Zone</Th>
              <Th>Stage</Th>
              <Th>Hour</Th>
              <Th>Occurrences</Th>
              <Th>Affected orders</Th>
              <Th>Avg overrun (min)</Th>
              <Th>Interventions recorded</Th>
              <Th>Measured change</Th>
            </tr>
          </thead>
          <tbody>
            {snapshot.bottlenecks.topRecurring.slice(0, 10).map((b) => {
              const linked = rows.filter(
                (i) => i.signature === b.signature || (i.zoneId === b.zoneId && i.stage === b.stage),
              );
              const measured = linked.filter((i) => i.improvementAbs !== null);
              return (
                <tr key={b.signature} className="border-t border-border">
                  <Td>{b.zoneId}</Td>
                  <Td>{b.stageLabel}</Td>
                  <Td className="num">{b.hour}</Td>
                  <Td className="num">{b.occurrences}</Td>
                  <Td className="num">{b.affectedOrders}</Td>
                  <Td className="num">{b.avgOverrun}</Td>
                  <Td className="num">{linked.length}</Td>
                  <Td className="num">
                    {measured.length === 0
                      ? "not measured"
                      : measured
                          .map(
                            (i) =>
                              `${i.beforeSla} → ${i.afterSla} ${METRIC_UNIT[i.metric]} (${
                                i.improvementAbs! > 0 ? "+" : ""
                              }${i.improvementAbs}${i.metric === "SLA_ADHERENCE_PCT" ? " pp" : " min"})`,
                          )
                          .join(", ")}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </AppShell>
  );
}
