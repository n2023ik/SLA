/**
 * Canonical order-event validation.
 *
 * `order_events` is the raw source of truth. Stage durations may only be derived
 * from events that appear once and in the canonical order; anything else is
 * reported as invalid and produces `null`, never a negative duration.
 *
 * The database view `order_stage_timings` applies exactly these rules in SQL, so
 * the app, the CLI report and the tests agree with the database.
 */

import type { StageTimings } from "./diagnosis/types";

export const CANONICAL_EVENT_SEQUENCE = [
  "ORDER_CREATED",
  "PICKING_STARTED",
  "PICKING_COMPLETED",
  "PACKING_STARTED",
  "PACKING_COMPLETED",
  "DISPATCHED",
  "DELIVERED",
] as const;

export type CanonicalEvent = (typeof CANONICAL_EVENT_SEQUENCE)[number];

export interface EventLike {
  eventType: string;
  timestamp: string;
}

export interface EventSequenceReport {
  /** Canonical events that never occurred for this order. */
  missing: CanonicalEvent[];
  /** Canonical events recorded more than once. */
  duplicates: CanonicalEvent[];
  /** True when a later canonical event carries an earlier timestamp. */
  outOfSequence: boolean;
  /** True when the events are complete, unique and chronological. */
  valid: boolean;
}

const isCanonical = (type: string): type is CanonicalEvent =>
  (CANONICAL_EVENT_SEQUENCE as readonly string[]).includes(type);

/** Earliest timestamp per canonical event type — deterministic event selection. */
export function firstTimestamps(events: EventLike[]): Partial<Record<CanonicalEvent, string>> {
  const out: Partial<Record<CanonicalEvent, string>> = {};
  for (const e of events) {
    if (!isCanonical(e.eventType)) continue;
    const current = out[e.eventType];
    if (!current || new Date(e.timestamp).getTime() < new Date(current).getTime()) {
      out[e.eventType] = e.timestamp;
    }
  }
  return out;
}

export function validateEventSequence(events: EventLike[]): EventSequenceReport {
  const counts = new Map<CanonicalEvent, number>();
  for (const e of events) {
    if (!isCanonical(e.eventType)) continue;
    counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
  }
  const missing = CANONICAL_EVENT_SEQUENCE.filter((t) => !counts.has(t));
  const duplicates = CANONICAL_EVENT_SEQUENCE.filter((t) => (counts.get(t) ?? 0) > 1);

  const at = firstTimestamps(events);
  let outOfSequence = false;
  let previous: number | null = null;
  for (const type of CANONICAL_EVENT_SEQUENCE) {
    const iso = at[type];
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (previous !== null && ms < previous) outOfSequence = true;
    previous = ms;
  }

  return {
    missing,
    duplicates,
    outOfSequence,
    valid: missing.length === 0 && duplicates.length === 0 && !outOfSequence,
  };
}

/**
 * Minutes between two events. Returns null when either event is missing OR the
 * pair is out of order — a stage duration is never negative.
 */
export function minutesBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return null;
  return Math.round((ms / 60000) * 100) / 100;
}

/** Stage durations computed straight from the raw events. */
export function timingsFromEvents(events: EventLike[]): StageTimings {
  const at = firstTimestamps(events);
  return {
    pickStartDelay: minutesBetween(at.ORDER_CREATED, at.PICKING_STARTED),
    pickDuration: minutesBetween(at.PICKING_STARTED, at.PICKING_COMPLETED),
    packDuration: minutesBetween(at.PACKING_STARTED, at.PACKING_COMPLETED),
    dispatchWait: minutesBetween(at.PACKING_COMPLETED, at.DISPATCHED),
    deliveryDuration: minutesBetween(at.DISPATCHED, at.DELIVERED),
    totalDuration: minutesBetween(at.ORDER_CREATED, at.DELIVERED),
  };
}
