import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/ops/AppShell";
import { DataTable, EmptyState, KpiCard, Panel, StatusPill, Td, Th } from "@/components/ops/primitives";
import { snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/bottlenecks")({
  head: () => ({
    meta: [
      { title: "Bottleneck Analysis — SLA Control" },
      {
        name: "description",
        content:
          "Zone, hour, shift and stage bottlenecks in quick-commerce fulfilment, including picker, packer and dispatch delay concentration.",
      },
      { property: "og:title", content: "Bottleneck Analysis — SLA Control" },
      {
        property: "og:description",
        content: "Where and when delays concentrate: zone, hour, shift, stage and station.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: BottlenecksPage,
});

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
};

function BottlenecksPage() {
  const { data } = useSuspenseQuery(snapshotQuery(30));
  const { bottlenecks, systemic, diagnoses } = data;

  // Stage counts answer "where does the work slip"; cause counts answer "why".
  const stageCount = (stages: string[]) => diagnoses.filter((d) => stages.includes(d.stage)).length;
  const causeCount = (causes: string[]) => diagnoses.filter((d) => causes.includes(d.category)).length;

  return (
    <AppShell
      title="Bottleneck Analysis"
      subtitle="Delay concentration across zones, hours, shifts, stages and packing stations, with the recurring signatures behind them."
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Picker-stage delays" value={stageCount(["PICK_START", "PICKING"])} tone="warn" />
        <KpiCard label="Packer-stage delays" value={stageCount(["PACKING"])} tone="warn" />
        <KpiCard label="Dispatch delays" value={stageCount(["DISPATCH"])} tone="danger" />
        <KpiCard label="Delivery delays" value={stageCount(["DELIVERY"])} tone="danger" />
        <KpiCard
          label="Packing station cause"
          value={causeCount(["PACKING_STATION"])}
          tone="danger"
        />
        <KpiCard
          label="Rider availability cause"
          value={causeCount(["RIDER_AVAILABILITY", "RIDER_ASSIGNMENT_DELAY", "DISPATCH_QUEUE"])}
          tone="danger"
        />
        <KpiCard label="Zone congestion cause" value={causeCount(["ZONE_CONGESTION"])} />
        <KpiCard label="Manpower cause" value={causeCount(["MANPOWER"])} />
        <KpiCard label="Inventory cause" value={causeCount(["INVENTORY"])} />
        <KpiCard
          label="Individual anomaly cause"
          value={causeCount(["INDIVIDUAL_ANOMALY", "RIDER_PERFORMANCE_ANOMALY"])}
        />
        <KpiCard label="Long-distance cause" value={causeCount(["LONG_DISTANCE"])} />
        <KpiCard label="Systemic findings" value={systemic.length} tone="info" />
      </div>


      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Delay frequency by zone">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bottlenecks.byZone}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="key" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="delays" name="Delayed orders" radius={[4, 4, 0, 0]}>
                  {bottlenecks.byZone.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.rate > 0.5 ? "var(--chart-3)" : "var(--chart-1)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Delay frequency by hour">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bottlenecks.byHour}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="orders" name="Orders" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="delays" name="Delayed" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Average stage time vs expectation">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bottlenecks.stageAverages} layout="vertical">
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} unit="m" />
                <YAxis dataKey="stage" type="category" stroke="var(--muted-foreground)" fontSize={12} width={80} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="expected" name="Expected" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="average" name="Actual" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="SLA breaches by stage">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bottlenecks.byStage}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="delays" name="Breaching orders" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Shift-wise bottlenecks">
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Shift</Th>
                <Th>Orders</Th>
                <Th>Delayed</Th>
                <Th>Delay rate</Th>
                <Th>Avg overrun</Th>
              </tr>
            </thead>
            <tbody>
              {bottlenecks.byShift.map((row) => (
                <tr key={row.key} className="border-b border-border/60">
                  <Td>{row.label}</Td>
                  <Td className="num">{row.orders}</Td>
                  <Td className="num">{row.delays}</Td>
                  <Td className="num">{Math.round(row.rate * 100)}%</Td>
                  <Td className="num">{row.avgDelay} min</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>

        <Panel title="Packing station congestion">
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Station</Th>
                <Th>Queue</Th>
                <Th>Orders</Th>
                <Th>Packing delays</Th>
                <Th>Delay rate</Th>
              </tr>
            </thead>
            <tbody>
              {bottlenecks.byStation.slice(0, 12).map((row) => {
                const station = data.stations.find((s) => s.stationId === row.key);
                return (
                  <tr key={row.key} className={`border-b border-border/60 ${row.rate > 0.4 ? "bg-danger/8" : ""}`}>
                    <Td className="num">{row.key}</Td>
                    <Td className="num">{station?.currentQueueLength ?? "—"}</Td>
                    <Td className="num">{row.orders}</Td>
                    <Td className="num">{row.delays}</Td>
                    <Td className="num">{Math.round(row.rate * 100)}%</Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      </div>

      <Panel
        title="Top recurring bottlenecks"
        description="Zone + stage + hour signatures that repeat across orders."
      >
        {bottlenecks.topRecurring.length === 0 ? (
          <EmptyState message="No recurring signature in this window." />
        ) : (
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Zone</Th>
                <Th>Stage</Th>
                <Th>Hour</Th>
                <Th>Occurrences</Th>
                <Th>Affected orders</Th>
                <Th>Avg overrun</Th>
                <Th>Severity</Th>
              </tr>
            </thead>
            <tbody>
              {bottlenecks.topRecurring.map((row) => (
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
    </AppShell>
  );
}
