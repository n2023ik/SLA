import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/ops/AppShell";
import { DataTable, EmptyState, Panel, StatusPill, Td, Th } from "@/components/ops/primitives";
import { projectLive } from "@/lib/analytics";
import { snapshotQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/live-orders")({
  head: () => ({
    meta: [
      { title: "Live Orders — SLA Control" },
      {
        name: "description",
        content:
          "Every in-flight quick-commerce order with elapsed time, remaining SLA, handling staff, risk status and its live diagnosis.",
      },
      { property: "og:title", content: "Live Orders — SLA Control" },
      {
        property: "og:description",
        content: "In-flight orders with remaining SLA, risk status and recommended action.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotQuery(30)),
  component: LiveOrdersPage,
});

function LiveOrdersPage() {
  const { data } = useSuspenseQuery(snapshotQuery(30));
  const [now, setNow] = useState(() => Date.now());
  const [onlyRisk, setOnlyRisk] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const diagnosisByOrder = new Map(data.primaryDiagnoses.map((d) => [d.orderId, d]));
  const rows = data.liveOrders
    .map((order) => ({ order, projection: projectLive(order, now) }))
    .filter((row) => (onlyRisk ? row.projection.status !== "ON_TRACK" : true))
    .sort((a, b) => a.projection.remainingMinutes - b.projection.remainingMinutes);

  const counts = {
    ON_TRACK: rows.filter((r) => r.projection.status === "ON_TRACK").length,
    AT_RISK: rows.filter((r) => r.projection.status === "AT_RISK").length,
    BREACHED: rows.filter((r) => r.projection.status === "BREACHED").length,
  };

  return (
    <AppShell
      title="Live Orders"
      subtitle="Stage-by-stage tracking of every order still in the pipeline, refreshed every 5 seconds."
      actions={
        <button
          type="button"
          onClick={() => setOnlyRisk((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {onlyRisk ? "Show all orders" : "Show only risk & breach"}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <StatusPill status="ON_TRACK" label={`On track ${counts.ON_TRACK}`} />
        <StatusPill status="AT_RISK" label={`At risk ${counts.AT_RISK}`} />
        <StatusPill status="BREACHED" label={`Breached ${counts.BREACHED}`} />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState message="No live orders in the pipeline right now." />
        ) : (
          <DataTable>
            <thead>
              <tr className="border-b border-border">
                <Th>Order</Th>
                <Th>Store</Th>
                <Th>Current stage</Th>
                <Th>Elapsed</Th>
                <Th>SLA left</Th>
                <Th>Picker / Packer / Rider</Th>
                <Th>Zone</Th>
                <Th>Risk</Th>
                <Th>Diagnosis</Th>
                <Th>Recommended action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order, projection }) => {
                const diagnosis = diagnosisByOrder.get(order.orderId);
                const rowTone =
                  projection.status === "BREACHED"
                    ? "bg-danger/10"
                    : projection.status === "AT_RISK"
                      ? "bg-warn/8"
                      : "";
                return (
                  <tr key={order.orderId} className={`border-b border-border/60 ${rowTone}`}>
                    <Td>
                      <Link
                        to="/orders/$orderId"
                        params={{ orderId: order.orderId }}
                        className="num font-medium text-primary hover:underline"
                      >
                        {order.orderId}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{order.storeId}</Td>
                    <Td>{order.status.replace(/_/g, " ")}</Td>
                    <Td className="num">{projection.elapsedMinutes} min</Td>
                    <Td className="num">
                      {projection.remainingMinutes < 0
                        ? `-${Math.abs(projection.remainingMinutes)} min`
                        : `${projection.remainingMinutes} min`}
                    </Td>
                    <Td className="num text-xs text-muted-foreground">
                      {[order.pickerId ?? "—", order.packerId ?? "—", order.riderId ?? "—"].join(" / ")}
                    </Td>
                    <Td>{order.zoneId}</Td>
                    <Td>
                      <StatusPill status={projection.status} />
                    </Td>
                    <Td className="max-w-72 text-xs">
                      {diagnosis ? diagnosis.rootCause : <span className="text-muted-foreground">No delay signal</span>}
                    </Td>
                    <Td className="max-w-72 text-xs text-primary">
                      {diagnosis ? diagnosis.recommendedAction : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </AppShell>
  );
}
