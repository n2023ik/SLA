/**
 * Order journey report.
 *
 * Recomputes every stage duration straight from the raw ORDER_CREATED →
 * DELIVERED event timestamps, compares it with the database-derived timings the
 * dashboard reads, and prints the diagnosis with the evidence behind it.
 *
 * Used by the validation suite and by `bun run scripts/diagnosis-report.ts`.
 */

import {
  STAGES,
  actualMinutesFor,
  expectedMinutesFor,
  overrunThresholdFor,
  round,
  stageOverrun,
} from "../diagnosis/thresholds";
import { STAGE_LABELS } from "../diagnosis/engine";
import { loadOrderDetail, type OrderDetail, type OrderTimelineEvent } from "../ops.data";
import {
  CANONICAL_EVENT_SEQUENCE,
  timingsFromEvents,
  validateEventSequence,
} from "../events";
import type { Stage, StageTimings } from "../diagnosis/types";

export const EVENT_SEQUENCE = CANONICAL_EVENT_SEQUENCE;

export { timingsFromEvents };

/** True when the order's canonical events are complete, unique and in order. */
export function eventsAreChronological(events: OrderTimelineEvent[]): boolean {
  return !validateEventSequence(events).outOfSequence;
}

export interface StageReportLine {
  stage: Stage;
  actual: number | null;
  fromEvents: number | null;
  expected: number;
  threshold: number;
  overrun: number;
}

export function stageLines(detail: OrderDetail): StageReportLine[] {
  const derived = timingsFromEvents(detail.events);
  const map: Record<Stage, number | null> = {
    PICK_START: derived.pickStartDelay,
    PICKING: derived.pickDuration,
    PACKING: derived.packDuration,
    DISPATCH: derived.dispatchWait,
    DELIVERY: derived.deliveryDuration,
  };
  return STAGES.map((stage) => ({
    stage,
    actual: actualMinutesFor(detail.order, stage),
    fromEvents: map[stage],
    expected: expectedMinutesFor(detail.order, stage),
    threshold: overrunThresholdFor(detail.order, stage),
    overrun: stageOverrun(detail.order, stage),
  }));
}

/** Human-readable developer output for one complete order journey. */
export function renderJourney(detail: OrderDetail): string {
  const o = detail.order;
  const out: string[] = [];
  out.push(`ORDER ${o.orderId} — store ${o.storeId} · zone ${o.zoneId} · ${o.shift} shift`);
  out.push(
    `items ${o.totalItems} · distance ${o.distanceKm} km · picker ${o.pickerId ?? "—"} · packer ${o.packerId ?? "—"} · rider ${o.riderId ?? "—"} · station ${o.stationId ?? "—"}`,
  );
  out.push(`SLA status ${o.slaStatus} · delayed stage ${o.breachStage ?? "none"}`);
  out.push("");
  out.push("EVENT TIMELINE");
  let prev: number | null = null;
  for (const e of detail.events) {
    const t = new Date(e.timestamp).getTime();
    const gap = prev === null ? "" : ` (+${round((t - prev) / 60000, 2)} min)`;
    out.push(
      `  ${e.eventType.padEnd(18)} ${e.timestamp}${gap}` +
        (e.employeeId ? `  by ${e.employeeId} (${e.employeeRole})` : "") +
        (e.stationId ? `  at ${e.stationId}` : ""),
    );
    prev = t;
  }
  out.push("");
  out.push("STAGE TIMINGS  (actual = database view, events = recomputed from timestamps)");
  for (const line of stageLines(detail)) {
    out.push(
      `  ${STAGE_LABELS[line.stage].padEnd(11)} actual ${String(line.actual ?? "—").padStart(7)}  events ${String(line.fromEvents ?? "—").padStart(7)}  expected ${String(line.expected).padStart(6)}  threshold ${String(line.threshold).padStart(6)}  overrun ${String(line.overrun).padStart(6)}`,
    );
  }
  out.push("");
  out.push(`DIAGNOSES (${detail.diagnoses.length})`);
  for (const d of detail.diagnoses) {
    out.push(
      `  ${d.stage} · ${d.category} · ${d.rootCause} · confidence ${d.confidenceScore} · overrun ${d.overrunMinutes} min${d.recurring ? " · recurring" : ""}`,
    );
    for (const line of d.evidence) out.push(`      - ${line}`);
    out.push(`      → ${d.recommendedAction}`);
  }
  out.push("");
  out.push(`TOTAL ${o.timings.totalDuration ?? "—"} min (promise ${o.promisedAt})`);
  return out.join("\n");
}

export async function journeyReport(
  orderId: string,
  client?: Parameters<typeof loadOrderDetail>[1],
): Promise<string> {
  const detail = await loadOrderDetail(orderId, client);
  if (!detail) return `Order ${orderId} not found.`;
  return renderJourney(detail);
}
