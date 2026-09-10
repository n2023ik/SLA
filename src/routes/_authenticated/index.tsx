import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
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
import { EmptyState, KpiCard, Panel, StatusPill } from "@/components/ops/primitives";
import { snapshotQuery } from "@/lib/queries";
import { projectLive } from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Operations Overview — SLA Control" },
      {
        name: "description",
        content:
          "SLA adherence, stage timings and live risk for quick-commerce fulfilment, with the delay causes behind each number.",
      },
      { property: "og:title", content: "Operations Overview — SLA Control" },
      {
        property: "og:description",
        content: "SLA adherence, stage timings and live risk for quick-commerce fulfilment.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: OverviewPage,
});

function OverviewPage() {
  const { data } = useSuspenseQuery(snapshotQuery(30));
  const { overview, bottlenecks, systemic, liveOrders, primaryDiagnoses, validation } = data;
  // One primary diagnosis per delayed order — the same list the Diagnosis page counts.
  const diagnosisByOrder = new Map(primaryDiagnoses.map((d) => [d.orderId, d]));
  const now = Date.now();

  const risky = liveOrders
    .map((order) => ({ order, projection: projectLive(order, now) }))
    .filter((x) => x.projection.status !== "ON_TRACK")
    .sort((a, b) => a.projection.remainingMinutes - b.projection.remainingMinutes)
    .slice(0, 6);

  return (
    <AppShell
      title="Operations Overview"
      subtitle={`Store ${data.zones[0]?.storeId ?? "—"} · last ${data.rangeDays} days · ${overview.totalOrders} orders analysed`}
      actions={
        <span className="num rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </span>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="SLA adherence (completed)"
          value={overview.slaAdherenceCompleted}
          unit="%"
          tone={
            overview.slaAdherenceCompleted > 80
              ? "ok"
              : overview.slaAdherenceCompleted > 60
                ? "warn"
                : "danger"
          }
          hint={`${overview.completedBreached} breached of ${overview.completedOrders} completed`}
        />
        <KpiCard
          label="Total orders"
          value={overview.totalOrders}
          hint={`${overview.completedOrders} completed · ${overview.inProgressOrders} in progress`}
        />
        <KpiCard
          label="Completed on time"
          value={overview.completedOnTime}
          tone="ok"
          hint={`of ${overview.completedOrders} completed`}
        />
        <KpiCard
          label="Completed breached"
          value={overview.completedBreached}
          tone="danger"
          hint="delivered after the promise"
        />
        <KpiCard
          label="In progress on track"
          value={overview.liveOnTrack}
          tone="ok"
          hint={`of ${overview.inProgressOrders} live`}
        />
        <KpiCard
          label="In progress at risk"
          value={overview.liveAtRisk}
          tone="warn"
          hint="approaching the promise"
        />
        <KpiCard
          label="In progress breached"
          value={overview.liveBreached}
          tone="danger"
          hint="already past the promise"
        />
        <KpiCard label="Avg total delivery" value={overview.avgTotalDuration} unit="min" hint="completed orders" />
        <KpiCard label="Avg pick time" value={overview.avgPickDuration} unit="min" hint={`pick start wait ${overview.avgPickStart} min`} />
        <KpiCard label="Avg pack time" value={overview.avgPackDuration} unit="min" />
        <KpiCard label="Avg dispatch wait" value={overview.avgDispatchWait} unit="min" />
        <KpiCard label="Avg delivery leg" value={overview.avgDeliveryDuration} unit="min" />
        <KpiCard
          label="Active diagnoses"
          value={primaryDiagnoses.length}
          tone="warn"
          hint={`${primaryDiagnoses.filter((d) => d.recurring).length} recurring · ${overview.delayedOrders} delayed orders`}
        />
        <KpiCard
          label="Systemic findings"
          value={systemic.length}
          tone="info"
          hint={validation.passed ? "consistency checks pass" : "consistency checks failing"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Stage time vs expectation"
          description="Where the promised window is actually being consumed."
          className="xl:col-span-2"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bottlenecks.stageAverages}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="stage" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} unit="m" />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--foreground)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="expected" name="Expected (min)" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="average" name="Actual avg (min)" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Live orders needing attention" description="Sorted by remaining SLA.">
          {risky.length === 0 ? (
            <EmptyState message="No live order is currently at risk." />
          ) : (
            <ul className="space-y-3">
              {risky.map(({ order, projection }) => {
                const diagnosis = diagnosisByOrder.get(order.orderId);
                return (
                  <li key={order.orderId} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to="/orders/$orderId"
                        params={{ orderId: order.orderId }}
                        className="num text-sm font-medium text-primary hover:underline"
                      >
                        {order.orderId}
                      </Link>
                      <StatusPill status={projection.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order.status} · {order.zoneId} · {projection.remainingMinutes} min left
                    </p>
                    {diagnosis ? (
                      <p className="mt-2 text-xs text-foreground/85">{diagnosis.rootCause}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Top systemic findings" description="Cross-order patterns detected by the diagnosis engine.">
        {systemic.length === 0 ? (
          <EmptyState message="No systemic bottleneck detected in this window." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {systemic.slice(0, 6).map((finding) => (
              <li key={finding.title} className="rounded-md border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">{finding.title}</h3>
                  <StatusPill status={finding.severity} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{finding.detail}</p>
                <p className="mt-2 text-xs text-primary">→ {finding.recommendedAction}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AppShell>
  );
}
