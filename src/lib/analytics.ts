/**
 * Pure aggregation helpers shared by the server functions and the dashboard.
 * No I/O here — everything is derived from a batch of OrderRow records, so
 * every page shows the same numbers.
 */

import { STAGE_LABELS, overrunStages, signatureFor, type SystemicFinding } from "./diagnosis/engine";
import { STAGES, THRESHOLDS, isRecurring, round, stageOverrun } from "./diagnosis/thresholds";
import type {
  Diagnosis,
  DiagnosisContext,
  OrderRow,
  RootCause,
  SlaStatus,
  Stage,
} from "./diagnosis/types";
import { ROOT_CAUSES } from "./diagnosis/types";

/**
 * Single definition of SLA status and delay stage.
 *
 * Completed orders are judged on the outcome (delivered before the promise or
 * not) — a finished order can never be "at risk". In-progress orders are
 * projected against the remaining window at `nowMs`.
 */
export function deriveSlaStatus(
  order: { deliveredAt: string | null; promisedAt: string; totalDuration: number | null },
  nowMs: number,
): SlaStatus {
  if (order.deliveredAt) {
    // Outcome only: event-derived total duration against the configured SLA.
    const total = order.totalDuration ?? 0;
    return total > THRESHOLDS.slaWindowMinutes ? "BREACHED" : "ON_TRACK";
  }
  const promised = new Date(order.promisedAt).getTime();
  const remaining = (promised - nowMs) / 60000;
  if (remaining < 0) return "BREACHED";
  if (remaining < THRESHOLDS.atRiskRemainingMinutes) return "AT_RISK";
  return "ON_TRACK";
}

/** Stage that lost the most time on this order (null when nothing overran). */
export function deriveBreachStage(order: OrderRow): Stage | null {
  let worst: Stage | null = null;
  let worstOverrun = 0;
  for (const stage of STAGES) {
    const over = stageOverrun(order, stage);
    if (over > worstOverrun) {
      worstOverrun = over;
      worst = stage;
    }
  }
  return worst;
}

export interface Overview {
  totalOrders: number;
  /** completedOrders + inProgressOrders === totalOrders */
  completedOrders: number;
  inProgressOrders: number;

  /** onTrack + atRisk + breached === totalOrders */
  onTrack: number;
  atRisk: number;
  breached: number;

  completedOnTime: number;
  completedBreached: number;
  liveOnTrack: number;
  liveAtRisk: number;
  liveBreached: number;

  /** Historical adherence — completed orders only. */
  slaAdherenceCompleted: number;
  /** Share of live orders currently on track. */
  liveOnTrackShare: number;
  delayedOrders: number;

  avgTotalDuration: number;
  avgPickStart: number;
  avgPickDuration: number;
  avgPackDuration: number;
  avgDispatchWait: number;
  avgDeliveryDuration: number;
}

export interface NamedCount {
  key: string;
  label: string;
  delays: number;
  orders: number;
  rate: number;
  avgDelay: number;
}

export interface RecurringBottleneck {
  signature: string;
  zoneId: string;
  stage: Stage;
  stageLabel: string;
  hour: string;
  occurrences: number;
  /** Independent calendar days the signature repeated on. */
  distinctDays: number;
  affectedOrders: number;
  avgOverrun: number;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface BottleneckBundle {
  byZone: NamedCount[];
  byHour: NamedCount[];
  byShift: NamedCount[];
  byStage: NamedCount[];
  byStation: NamedCount[];
  byRootCause: NamedCount[];
  stageAverages: { stage: string; average: number; expected: number }[];
  topRecurring: RecurringBottleneck[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function nonNull(orders: OrderRow[], pick: (o: OrderRow) => number | null): number[] {
  return orders.map(pick).filter((v): v is number => v !== null);
}

/** Minutes lost at a stage beyond its overrun threshold. */
export const stageExcess = stageOverrun;

/** Total minutes an order lost across all its overrun stages. */
export function orderOverrun(order: OrderRow): number {
  return round(
    overrunStages(order).reduce((sum, stage) => sum + stageOverrun(order, stage), 0),
    1,
  );
}

export function computeOverview(orders: OrderRow[]): Overview {
  const completed = orders.filter((o) => o.completed);
  const live = orders.filter((o) => !o.completed);

  const count = (rows: OrderRow[], status: SlaStatus) =>
    rows.filter((o) => o.slaStatus === status).length;

  const completedBreached = count(completed, "BREACHED");
  const liveOnTrack = count(live, "ON_TRACK");
  const liveAtRisk = count(live, "AT_RISK");
  const liveBreached = count(live, "BREACHED");

  return {
    totalOrders: orders.length,
    completedOrders: completed.length,
    inProgressOrders: live.length,

    onTrack: count(orders, "ON_TRACK"),
    atRisk: count(orders, "AT_RISK"),
    breached: count(orders, "BREACHED"),

    completedOnTime: completed.length - completedBreached,
    completedBreached,
    liveOnTrack,
    liveAtRisk,
    liveBreached,

    slaAdherenceCompleted: completed.length
      ? round((100 * (completed.length - completedBreached)) / completed.length, 1)
      : 0,
    liveOnTrackShare: live.length ? round((100 * liveOnTrack) / live.length, 1) : 0,
    delayedOrders: orders.filter((o) => o.delayed).length,

    avgTotalDuration: round(mean(nonNull(completed, (o) => o.timings.totalDuration)), 1),
    avgPickStart: round(mean(nonNull(orders, (o) => o.timings.pickStartDelay)), 1),
    avgPickDuration: round(mean(nonNull(orders, (o) => o.timings.pickDuration)), 1),
    avgPackDuration: round(mean(nonNull(orders, (o) => o.timings.packDuration)), 1),
    avgDispatchWait: round(mean(nonNull(orders, (o) => o.timings.dispatchWait)), 1),
    avgDeliveryDuration: round(mean(nonNull(completed, (o) => o.timings.deliveryDuration)), 1),
  };
}

function groupCounts(
  orders: OrderRow[],
  keyOf: (o: OrderRow) => string | null,
  labelOf: (key: string) => string,
): NamedCount[] {
  const total = new Map<string, number>();
  const delays = new Map<string, number>();
  const excess = new Map<string, number[]>();

  for (const order of orders) {
    const key = keyOf(order);
    if (key === null) continue;
    total.set(key, (total.get(key) ?? 0) + 1);
    if (order.delayed) {
      delays.set(key, (delays.get(key) ?? 0) + 1);
      excess.set(key, [...(excess.get(key) ?? []), orderOverrun(order)]);
    }
  }

  return [...total.entries()]
    .map(([key, orderCount]) => ({
      key,
      label: labelOf(key),
      orders: orderCount,
      delays: delays.get(key) ?? 0,
      rate: orderCount ? round((delays.get(key) ?? 0) / orderCount, 3) : 0,
      avgDelay: round(mean(excess.get(key) ?? []), 1),
    }))
    .sort((a, b) => b.delays - a.delays);
}

/** Delay counts per stage — every stage an order overran, not just the worst. */
export function stageDelayCounts(orders: OrderRow[]): NamedCount[] {
  return STAGES.map((stage) => {
    const affected = orders.filter((o) => stageOverrun(o, stage) > 0);
    const measured = orders.filter((o) => {
      const stages = overrunStages(o);
      return stages.length >= 0;
    });
    return {
      key: stage,
      label: STAGE_LABELS[stage],
      orders: measured.length,
      delays: affected.length,
      rate: measured.length ? round(affected.length / measured.length, 3) : 0,
      avgDelay: round(mean(affected.map((o) => stageOverrun(o, stage))), 1),
    };
  }).sort((a, b) => b.delays - a.delays);
}

/** Root-cause distribution, derived from the same diagnosis list every page uses. */
export function rootCauseCounts(diagnoses: Diagnosis[]): NamedCount[] {
  return ROOT_CAUSES.map((cause) => {
    const rows = diagnoses.filter((d) => d.category === cause);
    return {
      key: cause,
      label: cause.replace(/_/g, " ").toLowerCase(),
      orders: new Set(rows.map((d) => d.orderId)).size,
      delays: rows.length,
      rate: diagnoses.length ? round(rows.length / diagnoses.length, 3) : 0,
      avgDelay: round(mean(rows.map((d) => d.overrunMinutes)), 1),
    };
  }).sort((a, b) => b.delays - a.delays);
}

export function countByCategory(diagnoses: Diagnosis[], category: RootCause): number {
  return diagnoses.filter((d) => d.category === category).length;
}

export function computeBottlenecks(
  orders: OrderRow[],
  ctx: DiagnosisContext,
  diagnoses: Diagnosis[],
  zoneNames: Record<string, string>,
): BottleneckBundle {
  const byZone = groupCounts(
    orders,
    (o) => o.zoneId,
    (k) => zoneNames[k] ?? k,
  );
  const byHour = groupCounts(
    orders,
    (o) => String(o.hour).padStart(2, "0"),
    (k) => `${k}:00`,
  ).sort((a, b) => a.key.localeCompare(b.key));
  const byShift = groupCounts(
    orders,
    (o) => o.shift,
    (k) => k.charAt(0) + k.slice(1).toLowerCase(),
  );
  const byStation = groupCounts(
    orders,
    (o) => o.stationId,
    (k) => k,
  );

  const stageAverages = [
    {
      stage: "Pick start",
      average: round(mean(nonNull(orders, (o) => o.timings.pickStartDelay)), 1),
      expected: THRESHOLDS.pickStart.max,
    },
    {
      stage: "Picking",
      average: round(mean(nonNull(orders, (o) => o.timings.pickDuration)), 1),
      expected: round(
        THRESHOLDS.picking.base + mean(orders.map((o) => o.totalItems)) * THRESHOLDS.picking.perItem,
        1,
      ),
    },
    {
      stage: "Packing",
      average: round(mean(nonNull(orders, (o) => o.timings.packDuration)), 1),
      expected: round(
        THRESHOLDS.packing.base + mean(orders.map((o) => o.totalItems)) * THRESHOLDS.packing.perItem,
        1,
      ),
    },
    {
      stage: "Dispatch",
      average: round(mean(nonNull(orders, (o) => o.timings.dispatchWait)), 1),
      expected: THRESHOLDS.dispatch.max,
    },
    {
      stage: "Delivery",
      average: round(mean(nonNull(orders, (o) => o.timings.deliveryDuration)), 1),
      expected: round(
        THRESHOLDS.delivery.base + mean(orders.map((o) => o.distanceKm)) * THRESHOLDS.delivery.perKm,
        1,
      ),
    },
  ];

  // Recurring signatures are built from the same zone|stage|hour keys the
  // engine uses for the `recurring` flag on each diagnosis.
  const overrunBySignature = new Map<string, number[]>();
  const ordersBySignature = new Map<string, Set<string>>();
  for (const order of orders) {
    for (const stage of overrunStages(order)) {
      const key = signatureFor(order.zoneId, stage, order.hour);
      overrunBySignature.set(key, [
        ...(overrunBySignature.get(key) ?? []),
        stageOverrun(order, stage),
      ]);
      const set = ordersBySignature.get(key) ?? new Set<string>();
      set.add(order.orderId);
      ordersBySignature.set(key, set);
    }
  }

  // A pattern is only recurring when it affects enough orders AND repeats on
  // several independent days — a single bad day is an incident, not a pattern.
  const topRecurring: RecurringBottleneck[] = Object.entries(ctx.recurrence)
    .filter(([, stat]) => isRecurring(stat))
    .map(([signature, stat]) => {
      const [zoneId = "", stage = "PICK_START", hour = "0"] = signature.split("|");
      const occurrences = stat.affectedOrders;
      return {
        signature,
        zoneId,
        stage: stage as Stage,
        stageLabel: STAGE_LABELS[stage as Stage] ?? stage,
        hour: `${hour.padStart(2, "0")}:00`,
        occurrences,
        distinctDays: stat.distinctDays,
        affectedOrders: ordersBySignature.get(signature)?.size ?? occurrences,
        avgOverrun: round(mean(overrunBySignature.get(signature) ?? []), 1),
        severity: (occurrences > 20 ? "HIGH" : occurrences > 8 ? "MEDIUM" : "LOW") as
          | "HIGH"
          | "MEDIUM"
          | "LOW",
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 20);

  return {
    byZone,
    byHour,
    byShift,
    byStage: stageDelayCounts(orders),
    byStation,
    byRootCause: rootCauseCounts(diagnoses),
    stageAverages,
    topRecurring,
  };
}

export interface LiveProjection {
  elapsedMinutes: number;
  remainingMinutes: number;
  status: SlaStatus;
}

export function projectLive(order: OrderRow, now: number): LiveProjection {
  const created = new Date(order.createdAt).getTime();
  const promised = new Date(order.promisedAt).getTime();
  return {
    elapsedMinutes: round((now - created) / 60000, 1),
    remainingMinutes: round((promised - now) / 60000, 1),
    status: deriveSlaStatus(
      {
        deliveredAt: order.deliveredAt,
        promisedAt: order.promisedAt,
        totalDuration: order.timings.totalDuration,
      },
      now,
    ),
  };
}

export function rankSystemic(findings: SystemicFinding[], kinds: SystemicFinding["kind"][]) {
  return findings.filter((f) => kinds.includes(f.kind));
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${round(value, 1)} min`;
}
