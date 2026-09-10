/**
 * Operational thresholds for the diagnosis engine.
 * All values in minutes unless stated otherwise. Change these to re-tune the
 * engine without touching any rule logic.
 *
 * This file is the single source of truth for "what is expected" and "what
 * counts as an overrun". Rules, analytics and the SLA status derivation all
 * read the same helpers so no page can disagree with another.
 */

import type { OrderRow, RecurrenceStat, Shift, Stage } from "./types";

export const THRESHOLDS = {
  /** Promised fulfilment window used for SLA projection of live orders. */
  slaWindowMinutes: 30,
  /** A live order is flagged AT RISK once remaining SLA falls under this. */
  atRiskRemainingMinutes: 6,

  pickStart: { max: 5 },
  picking: { base: 2.5, perItem: 0.25, tolerance: 1.25, hardMax: 10 },
  packing: { base: 2.5, perItem: 0.12, tolerance: 1.3, hardMax: 7 },
  dispatch: { max: 5 },
  delivery: { base: 4, perKm: 1.8, tolerance: 1.3 },

  /** Zone is treated as a zone-level bottleneck above this delay share. */
  zoneBreachRate: 0.45,
  /** Hour is treated as a capacity bottleneck above this delay share. */
  hourBreachRate: 0.5,
  /** Packing station considered congested at/above this queue length. */
  stationQueue: 6,
  /** Packing station delay share that counts as congestion. */
  stationDelayRate: 0.35,
  /** Employee flagged as a performance anomaly above this peer ratio. */
  peerRatio: 1.3,
  /** Minimum comparable orders before an employee can be flagged. */
  minComparableOrders: 8,
  /** Minimum orders in a comparability bucket for it to be usable. */
  minBucketOrders: 5,
  /** Minimum delayed orders sharing a signature before it counts as recurring. */
  recurringOccurrences: 5,
  /**
   * A signature must also repeat across this many independent calendar days —
   * a single bad day is an incident, not a recurring bottleneck.
   */
  recurringDistinctDays: 3,
  /** Stage-specific zone delay share that counts as a zone-level pattern. */
  zoneStageDelayRate: 0.4,
  /** Stage-specific hourly delay share that counts as a capacity pattern. */
  hourStageDelayRate: 0.4,
  /** Share of low-stock SKUs in a zone that suggests an inventory issue. */
  lowStockShare: 0.15,
  /** Dispatch delay share of an hour that indicates a rider capacity gap. */
  hourDispatchRate: 0.35,
} as const;

export function expectedPickMinutes(totalItems: number): number {
  return round(THRESHOLDS.picking.base + totalItems * THRESHOLDS.picking.perItem);
}

export function expectedPackMinutes(totalItems: number): number {
  return round(THRESHOLDS.packing.base + totalItems * THRESHOLDS.packing.perItem);
}

export function expectedDeliveryMinutes(distanceKm: number): number {
  return round(THRESHOLDS.delivery.base + distanceKm * THRESHOLDS.delivery.perKm);
}

/** The un-toleranced expectation shown in the UI for a stage. */
export function expectedMinutesFor(order: OrderRow, stage: Stage): number {
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

/** The value a stage must exceed before it is treated as a delay. */
export function overrunThresholdFor(order: OrderRow, stage: Stage): number {
  switch (stage) {
    case "PICK_START":
      return THRESHOLDS.pickStart.max;
    case "PICKING":
      return round(expectedPickMinutes(order.totalItems) * THRESHOLDS.picking.tolerance, 2);
    case "PACKING":
      return round(expectedPackMinutes(order.totalItems) * THRESHOLDS.packing.tolerance, 2);
    case "DISPATCH":
      return THRESHOLDS.dispatch.max;
    case "DELIVERY":
      return round(expectedDeliveryMinutes(order.distanceKm) * THRESHOLDS.delivery.tolerance, 2);
  }
}

export function actualMinutesFor(order: OrderRow, stage: Stage): number | null {
  const t = order.timings;
  switch (stage) {
    case "PICK_START":
      return t.pickStartDelay;
    case "PICKING":
      return t.pickDuration;
    case "PACKING":
      return t.packDuration;
    case "DISPATCH":
      return t.dispatchWait;
    case "DELIVERY":
      return t.deliveryDuration;
  }
}

export const STAGES: Stage[] = ["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"];

/** Minutes a stage ran beyond its overrun threshold. 0 when within threshold. */
export function stageOverrun(order: OrderRow, stage: Stage): number {
  const actual = actualMinutesFor(order, stage);
  if (actual === null) return 0;
  return Math.max(0, round(actual - overrunThresholdFor(order, stage), 2));
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Shift a created hour belongs to. Single source of truth for shift bucketing. */
export function shiftForHour(hour: number): Shift {
  if (hour >= 6 && hour <= 13) return "MORNING";
  if (hour >= 14 && hour <= 21) return "EVENING";
  return "NIGHT";
}

/**
 * Recurrence needs both volume and repetition across days. Centralised here so
 * every page and every test uses the same definition.
 */
export function isRecurring(stat: RecurrenceStat | undefined): boolean {
  if (!stat) return false;
  return (
    stat.affectedOrders >= THRESHOLDS.recurringOccurrences &&
    stat.distinctDays >= THRESHOLDS.recurringDistinctDays
  );
}
