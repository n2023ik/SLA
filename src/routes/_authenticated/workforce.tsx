import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { DataTable, EmptyState, KpiCard, Panel, StatusPill, Td, Th } from "@/components/ops/primitives";
import { buildEmployeeStats } from "@/lib/diagnosis/engine";
import type { Role } from "@/lib/diagnosis/types";
import { snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/workforce")({
  head: () => ({
    meta: [
      { title: "Workforce Analytics — SLA Control" },
      {
        name: "description",
        content:
          "Picker, packer and rider performance compared against peers on similar workloads, zones and shifts — recurring delay patterns, not blame.",
      },
      { property: "og:title", content: "Workforce Analytics — SLA Control" },
      {
        property: "og:description",
        content: "Peer-normalised picker, packer and rider performance with recurring delay patterns.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: WorkforcePage,
});

const ROLES: Role[] = ["PICKER", "PACKER", "RIDER"];
const ROLE_LABEL: Record<Role, string> = { PICKER: "Pickers", PACKER: "Packers", RIDER: "Riders" };

function WorkforcePage() {
  const { data } = useSuspenseQuery(snapshotQuery(30));
  const [role, setRole] = useState<Role>("PICKER");
  const [employee, setEmployee] = useState("ALL");
  const [zone, setZone] = useState("ALL");
  const [shift, setShift] = useState("ALL");
  const [date, setDate] = useState("ALL");

  const employeeById = useMemo(
    () => new Map(data.workforce.map((w) => [w.employeeId, w])),
    [data.workforce],
  );

  const dates = useMemo(() => {
    const set = new Set(data.orders.map((o) => o.createdAt.slice(0, 10)));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [data.orders]);

  const filteredOrders = useMemo(
    () =>
      data.orders.filter((o) => {
        if (zone !== "ALL" && o.zoneId !== zone) return false;
        if (shift !== "ALL" && o.shift !== shift) return false;
        if (date !== "ALL" && o.createdAt.slice(0, 10) !== date) return false;
        return true;
      }),
    [data.orders, zone, shift, date],
  );

  const stats = useMemo(() => buildEmployeeStats(filteredOrders), [filteredOrders]);

  const rows = Object.values(stats)
    .filter((s) => s.role === role)
    .filter((s) => (employee === "ALL" ? true : s.employeeId === employee))
    .sort((a, b) => b.peerRatio - a.peerRatio);

  const anomalies = rows.filter((r) => r.anomaly);
  const totalHandled = rows.reduce((sum, r) => sum + r.ordersHandled, 0);
  const avgRatio = rows.length
    ? Math.round((rows.reduce((s, r) => s + r.peerRatio, 0) / rows.length) * 100) / 100
    : 0;

  const roleEmployees = data.workforce.filter((w) => w.role === role);

  return (
    <AppShell
      title="Workforce Analytics"
      subtitle="Employees are compared with peers on the same role and shift, normalised per item or per kilometre. A high ratio is a performance anomaly to investigate, not a verdict."
    >
      <div className="flex flex-wrap gap-2">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setRole(r);
              setEmployee("ALL");
            }}
            className={`rounded-md border px-4 py-2 text-sm transition-colors ${
              role === r
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      <Panel title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <select
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            aria-label="Filter by employee"
          >
            <option value="ALL">All {ROLE_LABEL[role].toLowerCase()}</option>
            {roleEmployees.map((w) => (
              <option key={w.employeeId} value={w.employeeId}>
                {w.employeeId} · {w.name}
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
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            aria-label="Filter by shift"
          >
            <option value="ALL">All shifts</option>
            <option value="MORNING">Morning</option>
            <option value="EVENING">Evening</option>
            <option value="NIGHT">Night</option>
          </select>
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
            aria-label="Filter by date"
          >
            <option value="ALL">All dates</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`${ROLE_LABEL[role]} in view`} value={rows.length} />
        <KpiCard label="Orders handled" value={totalHandled} />
        <KpiCard label="Avg peer ratio" value={avgRatio} unit="x" tone={avgRatio > 1.1 ? "warn" : "ok"} />
        <KpiCard
          label="Performance anomalies"
          value={anomalies.length}
          tone={anomalies.length ? "warn" : "ok"}
          hint="≥1.3x comparable peers"
        />
      </div>

      <Panel
        title={`${ROLE_LABEL[role]} performance`}
        description="Peer ratio compares like-for-like workload: pickers against the same shift and zone on similar basket sizes, packers against similar order complexity, riders against comparable distances. Only orders in buckets with enough peer activity are counted as comparable."
      >
        {rows.length === 0 ? (
          <EmptyState message="No activity for these filters." />
        ) : (
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Employee</Th>
                <Th>Zone / shift</Th>
                <Th>Orders handled</Th>
                <Th>Avg processing time</Th>
                <Th>Median processing time</Th>
                <Th>Avg workload</Th>
                <Th>Comparable orders</Th>
                <Th>Delay count</Th>
                <Th>SLA breaches</Th>
                <Th>Peer average</Th>
                <Th>Productivity score</Th>
                <Th>Peer ratio</Th>
                <Th>Pattern</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const emp = employeeById.get(s.employeeId);
                return (
                  <tr
                    key={s.employeeId}
                    className={`border-b border-border/60 ${s.anomaly ? "bg-warn/8" : ""}`}
                  >
                    <Td>
                      <span className="num font-medium">{s.employeeId}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{emp?.name}</span>
                    </Td>
                    <Td className="text-muted-foreground">
                      {emp ? `${emp.zoneId} · ${emp.shift.toLowerCase()}` : "—"}
                    </Td>
                    <Td className="num">{s.ordersHandled}</Td>
                    <Td className="num">{s.avgStageTime} min</Td>
                    <Td className="num">{s.medianStageTime} min</Td>
                    <Td className="num">
                      {s.workloadPerOrder} {role === "RIDER" ? "km" : "items"}
                    </Td>
                    <Td className="num">{s.comparableOrders}</Td>
                    <Td className="num">{s.delayCount}</Td>
                    <Td className="num">{s.breachCount}</Td>
                    <Td className="num">
                      {s.peerAvgTimePerUnit} min/{role === "RIDER" ? "km" : "item"}
                    </Td>
                    <Td className="num">{s.productivityScore}</Td>
                    <Td className="num">{s.peerRatio}x</Td>
                    <Td>
                      {s.anomaly ? (
                        <StatusPill status="MEDIUM" label="Recurring delay pattern" />
                      ) : (
                        <StatusPill status="ON_TRACK" label="Within peer range" />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>

      {anomalies.length > 0 ? (
        <Panel
          title="Anomalies to investigate"
          description="Before any staffing action, check zone conditions, basket profile, equipment and station queue for these employees."
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {anomalies.map((s) => (
              <li key={s.employeeId} className="rounded-md border border-warn/30 bg-warn/8 p-4">
                <p className="text-sm font-semibold">
                  {s.employeeId} · {employeeById.get(s.employeeId)?.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {s.peerRatio}x comparable peers over {s.comparableOrders} comparable orders (avg{" "}
                  {s.workloadPerOrder} {s.role === "RIDER" ? "km" : "items"}, {s.avgStageTime} min
                  average / {s.medianStageTime} min median per order).
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {s.evidence.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-primary">
                  → Indicator for investigation, not proof of fault: review method and working
                  conditions, and pair with a peer on the same shift before reallocating.
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </AppShell>
  );
}
