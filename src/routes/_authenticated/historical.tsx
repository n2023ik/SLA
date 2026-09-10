import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/ops/AppShell";
import { DataTable, EmptyState, KpiCard, Panel, StatusPill, Td, Th } from "@/components/ops/primitives";
import { snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/historical")({
  head: () => ({
    meta: [
      { title: "Historical Analysis — SLA Control" },
      {
        name: "description",
        content:
          "Recurring delay patterns over today, 7 days and 30 days: same zone, same hour, same shift, same stage, repeated employee anomalies and station congestion.",
      },
      { property: "og:title", content: "Historical Analysis — SLA Control" },
      {
        property: "og:description",
        content: "Recurring delay patterns by zone, hour, shift, stage, employee and station.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: HistoricalPage,
});

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
] as const;

function HistoricalPage() {
  const [days, setDays] = useState<number>(7);
  const { data } = useSuspenseQuery(snapshotQuery(days));

  const trend = useMemo(() => {
    const byDay = new Map<string, { orders: number; delays: number }>();
    for (const order of data.orders) {
      const key = order.createdAt.slice(0, 10);
      const entry = byDay.get(key) ?? { orders: 0, delays: 0 };
      entry.orders += 1;
      if (order.breachStage || order.slaStatus === "BREACHED") entry.delays += 1;
      byDay.set(key, entry);
    }
    return [...byDay.entries()]
      .map(([date, v]) => ({
        date: date.slice(5),
        delayRate: Math.round((v.delays / v.orders) * 1000) / 10,
        orders: v.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.orders]);

  const repeatedEmployees = data.employeeStats.filter((s) => s.anomaly);
  const stationFindings = data.systemic.filter((f) => f.kind === "STATION");
  const zoneFindings = data.systemic.filter((f) => f.kind === "ZONE");
  const timeFindings = data.systemic.filter((f) => f.kind === "TIME");

  const byShift = data.bottlenecks.byShift;

  return (
    <AppShell
      title="Historical Analysis"
      subtitle="Patterns that repeat across days — the ones worth fixing structurally."
      actions={
        <div className="flex gap-2">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => setDays(range.days)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                days === range.days
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Orders in range" value={data.overview.totalOrders} />
        <KpiCard
          label="SLA adherence (completed)"
          value={data.overview.slaAdherenceCompleted}
          unit="%"
          tone={
            data.overview.slaAdherenceCompleted > 80
              ? "ok"
              : data.overview.slaAdherenceCompleted > 60
                ? "warn"
                : "danger"
          }
          hint={`${data.overview.completedOrders} completed · ${data.overview.inProgressOrders} still in progress`}
        />
        <KpiCard label="Recurring signatures" value={data.bottlenecks.topRecurring.length} tone="warn" />
        <KpiCard label="Repeated employee anomalies" value={repeatedEmployees.length} />
      </div>

      <Panel title="Delay rate by day" description="Share of orders missing a stage threshold.">
        {trend.length === 0 ? (
          <EmptyState message="No orders in this range." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--foreground)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="delayRate"
                  name="Delay rate %"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Same zone, same stage, same hour" description="Repeating signatures in this range.">
          {data.bottlenecks.topRecurring.length === 0 ? (
            <EmptyState message="No repeating signature detected." />
          ) : (
            <DataTable>
              <thead>
                <tr className="border-b border-border">
                  <Th>Zone</Th>
                  <Th>Stage</Th>
                  <Th>Hour</Th>
                  <Th>Times seen</Th>
                  <Th>Affected orders</Th>
                  <Th>Avg overrun</Th>
                  <Th>Severity</Th>
                </tr>
              </thead>
              <tbody>
                {data.bottlenecks.topRecurring.map((row) => (
                  <tr key={row.signature} className="border-b border-border/60">
                    <Td>{row.zoneId}</Td>
                    <Td>{row.stageLabel}</Td>
                    <Td className="num">{row.hour}</Td>
                    <Td className="num">{row.occurrences}</Td>
                    <Td className="num">{row.affectedOrders}</Td>
                    <Td className="num">{row.avgOverrun} min</Td>
                    <Td>
                      <StatusPill status={row.severity} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Panel title="Same shift" description="Delay concentration per shift across the range.">
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Shift</Th>
                <Th>Orders</Th>
                <Th>Delayed</Th>
                <Th>Delay rate</Th>
              </tr>
            </thead>
            <tbody>
              {byShift.map((row) => (
                <tr key={row.key} className="border-b border-border/60">
                  <Td>{row.label}</Td>
                  <Td className="num">{row.orders}</Td>
                  <Td className="num">{row.delays}</Td>
                  <Td className="num">{Math.round(row.rate * 100)}%</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Repeated zone bottlenecks">
          {zoneFindings.length === 0 ? (
            <EmptyState message="No zone repeats." />
          ) : (
            <ul className="space-y-3">
              {zoneFindings.map((f) => (
                <li key={f.title} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Repeated hour / capacity bottlenecks">
          {timeFindings.length === 0 ? (
            <EmptyState message="No hour repeats." />
          ) : (
            <ul className="space-y-3">
              {timeFindings.map((f) => (
                <li key={f.title} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Repeated packing station congestion">
          {stationFindings.length === 0 ? (
            <EmptyState message="No station repeats." />
          ) : (
            <ul className="space-y-3">
              {stationFindings.map((f) => (
                <li key={f.title} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Repeated employee anomalies"
        description="Employees whose delay pattern repeats against comparable peers. Investigate conditions before staffing decisions."
      >
        {repeatedEmployees.length === 0 ? (
          <EmptyState message="No repeated employee anomaly in this range." />
        ) : (
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Employee</Th>
                <Th>Role</Th>
                <Th>Orders</Th>
                <Th>Avg per order</Th>
                <Th>Peer ratio</Th>
                <Th>Delays</Th>
              </tr>
            </thead>
            <tbody>
              {repeatedEmployees.map((s) => (
                <tr key={s.employeeId} className="border-b border-border/60 bg-warn/8">
                  <Td className="num">{s.employeeId}</Td>
                  <Td>{s.role}</Td>
                  <Td className="num">{s.ordersHandled}</Td>
                  <Td className="num">{s.avgStageTime} min</Td>
                  <Td className="num">{s.peerRatio}x</Td>
                  <Td className="num">{s.delayCount}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </AppShell>
  );
}
