import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/ops/AppShell";
import {
  ConfidenceBar,
  EmptyState,
  KpiCard,
  Panel,
  StatusPill,
} from "@/components/ops/primitives";
import { formatMinutes } from "@/lib/analytics";
import { STAGE_LABELS } from "@/lib/diagnosis/engine";
import {
  THRESHOLDS,
  expectedDeliveryMinutes,
  expectedPackMinutes,
  expectedPickMinutes,
} from "@/lib/diagnosis/thresholds";
import type { OrderRow, Stage } from "@/lib/diagnosis/types";
import { orderDetailQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
  head: ({ params }) => ({
    meta: [
      { title: `Order ${params.orderId} — SLA Control` },
      {
        name: "description",
        content: `Stage-by-stage timeline for order ${params.orderId} with expected versus actual time and the diagnosis for each delay.`,
      },
      { property: "og:title", content: `Order ${params.orderId} — SLA Control` },
      {
        property: "og:description",
        content: "Stage timeline with expected versus actual time and delay diagnosis.",
      },
    ],
  }),
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(orderDetailQuery(params.orderId));
    if (!detail) throw notFound();
    return detail;
  },
  component: OrderDetailPage,
});

const TIMELINE: { event: string; label: string; stage: Stage | null }[] = [
  { event: "ORDER_CREATED", label: "Created", stage: null },
  { event: "PICKING_STARTED", label: "Picking started", stage: "PICK_START" },
  { event: "PICKING_COMPLETED", label: "Picking completed", stage: "PICKING" },
  { event: "PACKING_STARTED", label: "Packing started", stage: null },
  { event: "PACKING_COMPLETED", label: "Packing completed", stage: "PACKING" },
  { event: "DISPATCHED", label: "Dispatched", stage: "DISPATCH" },
  { event: "DELIVERED", label: "Delivered", stage: "DELIVERY" },
];

function actualFor(order: OrderRow, stage: Stage | null): number | null {
  if (!stage) return null;
  switch (stage) {
    case "PICK_START":
      return order.timings.pickStartDelay;
    case "PICKING":
      return order.timings.pickDuration;
    case "PACKING":
      return order.timings.packDuration;
    case "DISPATCH":
      return order.timings.dispatchWait;
    case "DELIVERY":
      return order.timings.deliveryDuration;
  }
}

function expectedFor(order: OrderRow, stage: Stage | null): number | null {
  if (!stage) return null;
  switch (stage) {
    case "PICK_START":
      return THRESHOLDS.pickStart.max;
    case "PICKING":
      return expectedPickMinutes(order.totalItems);
    case "PACKING":
      return expectedPackMinutes(order.totalItems);
    case "DISPATCH":
      return THRESHOLDS.dispatch.max;
    case "DELIVERY":
      return expectedDeliveryMinutes(order.distanceKm);
  }
}

function OrderDetailPage() {
  const { data } = useSuspenseQuery(orderDetailQuery(Route.useParams().orderId));
  if (!data) return null;
  const { order, events, diagnoses, employees } = data;
  const eventByType = new Map(events.map((e) => [e.eventType, e]));

  return (
    <AppShell
      title={`Order ${order.orderId}`}
      subtitle={`${order.storeId} · ${order.zoneId} · ${order.totalItems} items · ${order.distanceKm} km · ${order.shift.toLowerCase()} shift`}
      actions={
        <div className="flex items-center gap-2">
          <StatusPill status={order.slaStatus} />
          <Link
            to="/live-orders"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Back to live orders
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total duration" value={formatMinutes(order.timings.totalDuration)} />
        <KpiCard
          label="Promised window"
          value={THRESHOLDS.slaWindowMinutes}
          unit="min"
          hint={new Date(order.promisedAt).toLocaleString()}
        />
        <KpiCard
          label="Breach stage"
          value={order.breachStage ? STAGE_LABELS[order.breachStage] : "None"}
          tone={order.breachStage ? "danger" : "ok"}
        />
        <KpiCard
          label="Delivered"
          value={order.deliveredAt ? new Date(order.deliveredAt).toLocaleTimeString() : "In progress"}
        />
      </div>

      <Panel title="Stage timeline" description="Expected versus actual time at each handover.">
        <ol className="relative space-y-4 border-l border-border pl-6">
          {TIMELINE.map((step) => {
            const event = eventByType.get(step.event);
            const actual = actualFor(order, step.stage);
            const expected = expectedFor(order, step.stage);
            const late = actual !== null && expected !== null && actual > expected;
            return (
              <li key={step.event} className="relative">
                <span
                  className={`absolute -left-[1.6rem] top-1.5 size-3 rounded-full border-2 ${
                    !event
                      ? "border-border bg-background"
                      : late
                        ? "border-danger bg-danger"
                        : "border-ok bg-ok"
                  }`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="num mt-0.5 text-xs text-muted-foreground">
                      {event ? new Date(event.timestamp).toLocaleString() : "Not reached yet"}
                      {event?.employeeId ? ` · ${event.employeeId} (${event.employeeRole})` : ""}
                      {event?.stationId ? ` · station ${event.stationId}` : ""}
                    </p>
                  </div>
                  {step.stage ? (
                    <div className="flex items-center gap-4 text-xs">
                      <span className="num text-muted-foreground">
                        expected {formatMinutes(expected)}
                      </span>
                      <span className={`num font-medium ${late ? "text-danger" : "text-ok"}`}>
                        actual {formatMinutes(actual)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Diagnosis" className="xl:col-span-2">
          {diagnoses.length === 0 ? (
            <EmptyState message="No stage on this order exceeded its threshold." />
          ) : (
            <ul className="space-y-4">
              {diagnoses.map((d) => (
                <li key={d.stage} className="rounded-md border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      {STAGE_LABELS[d.stage]} · {d.rootCause}
                    </p>
                    <div className="flex items-center gap-2">
                      {d.recurring ? <StatusPill status="HIGH" label="Recurring" /> : null}
                      <ConfidenceBar value={d.confidenceScore} />
                    </div>
                  </div>
                  <p className="num mt-2 text-xs text-muted-foreground">
                    actual {d.actualMinutes} min · expected {d.expectedMinutes} min ·{" "}
                    {d.category.replace(/_/g, " ")}
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {d.evidence.map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="text-primary">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                    → {d.recommendedAction}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Handling staff">
          {employees.length === 0 ? (
            <EmptyState message="No staff assigned yet." />
          ) : (
            <ul className="space-y-3">
              {employees.map((emp) => (
                <li key={emp.employeeId} className="rounded-md border border-border bg-surface p-3">
                  <p className="num text-sm font-medium">{emp.employeeId}</p>
                  <p className="text-xs text-muted-foreground">
                    {emp.name} · {emp.role} · {emp.zoneId} · {emp.shift.toLowerCase()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
