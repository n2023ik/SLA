/**
 * Event integrity validation: missing, duplicated and out-of-order events must
 * be detected, and no path may ever produce a negative stage duration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CANONICAL_EVENT_SEQUENCE,
  timingsFromEvents,
  validateEventSequence,
  type EventLike,
} from "../events";
import { loadEventIntegrity } from "../ops.data";
import { adminClient, authedClient } from "./client";

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 5, 10, minutes)).toISOString();

const fullJourney = (): EventLike[] => [
  { eventType: "ORDER_CREATED", timestamp: at(0) },
  { eventType: "PICKING_STARTED", timestamp: at(3) },
  { eventType: "PICKING_COMPLETED", timestamp: at(9) },
  { eventType: "PACKING_STARTED", timestamp: at(10) },
  { eventType: "PACKING_COMPLETED", timestamp: at(14) },
  { eventType: "DISPATCHED", timestamp: at(17) },
  { eventType: "DELIVERED", timestamp: at(31) },
];

describe("canonical event sequence", () => {
  it("accepts a complete, unique, chronological journey", () => {
    const report = validateEventSequence(fullJourney());
    expect(report).toEqual({ missing: [], duplicates: [], outOfSequence: false, valid: true });
    expect(CANONICAL_EVENT_SEQUENCE[0]).toBe("ORDER_CREATED");
  });

  it("reports missing events", () => {
    const events = fullJourney().filter((e) => e.eventType !== "PACKING_STARTED");
    const report = validateEventSequence(events);
    expect(report.missing).toEqual(["PACKING_STARTED"]);
    expect(report.valid).toBe(false);
    // The stage that lost its start event yields no duration at all.
    expect(timingsFromEvents(events).packDuration).toBeNull();
  });

  it("reports duplicate events and uses the earliest occurrence", () => {
    const events = [...fullJourney(), { eventType: "PICKING_STARTED", timestamp: at(7) }];
    const report = validateEventSequence(events);
    expect(report.duplicates).toEqual(["PICKING_STARTED"]);
    expect(report.valid).toBe(false);
    // Deterministic selection: earliest PICKING_STARTED (minute 3), not minute 7.
    expect(timingsFromEvents(events).pickDuration).toBe(6);
  });

  it("reports out-of-order timestamps", () => {
    const events = fullJourney().map((e) =>
      e.eventType === "DISPATCHED" ? { ...e, timestamp: at(12) } : e,
    );
    const report = validateEventSequence(events);
    expect(report.outOfSequence).toBe(true);
    expect(report.valid).toBe(false);
  });

  it("never produces a negative stage duration", () => {
    const events = fullJourney().map((e) =>
      e.eventType === "DISPATCHED" ? { ...e, timestamp: at(12) } : e,
    );
    const timings = timingsFromEvents(events);
    expect(timings.dispatchWait).toBeNull();
    for (const value of Object.values(timings)) {
      expect(value === null || value >= 0).toBe(true);
    }
  });
});

describe("database event integrity", () => {
  const admin = adminClient();
  const orderId = "VALIDATION-EVT-1";

  beforeAll(async () => {
    await admin.from("order_events").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("order_id", orderId);
    await admin.from("orders").insert({
      order_id: orderId,
      store_id: "S1",
      created_at: at(0),
      promised_delivery_time: at(30),
      delivered_at: at(31),
      status: "DELIVERED",
      total_items: 8,
      customer_distance_km: 3,
    } as never);
    // DISPATCHED deliberately recorded BEFORE packing completed.
    await admin.from("order_events").insert(
      [
        ["ORDER_CREATED", at(0)],
        ["PICKING_STARTED", at(3)],
        ["PICKING_COMPLETED", at(9)],
        ["PACKING_STARTED", at(10)],
        ["PACKING_COMPLETED", at(14)],
        ["DISPATCHED", at(12)],
        ["DELIVERED", at(31)],
      ].map(([event_type, timestamp]) => ({ order_id: orderId, event_type, timestamp })) as never,
    );
  });

  afterAll(async () => {
    await admin.from("order_events").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("order_id", orderId);
  });

  it("marks the order out of sequence and refuses to emit the bad duration", async () => {
    const { data: validation } = await admin
      .from("order_event_validation")
      .select("*")
      .eq("order_id", orderId)
      .single();
    expect((validation as { out_of_sequence: boolean }).out_of_sequence).toBe(true);

    const { data: timings } = await admin
      .from("order_stage_timings")
      .select("*")
      .eq("order_id", orderId)
      .single();
    const row = timings as Record<string, number | null>;
    // The invalid pair yields no duration at all instead of a negative one…
    expect(row["dispatch_wait"]).toBeNull();
    // …while pairs that are themselves in order still resolve normally.
    expect(row["pick_duration"]).toBe(6);
    expect(Number(row["delivery_duration"])).toBeGreaterThanOrEqual(0);
  });

  it("emits no negative duration anywhere in the timings view", async () => {
    const { client } = await authedClient();
    const { data, error } = await client
      .from("order_stage_timings")
      .select(
        "pick_start_delay, pick_duration, pack_duration, dispatch_wait, delivery_duration, total_duration",
      );
    expect(error).toBeNull();
    const negatives = (data ?? []).filter((row) =>
      Object.values(row as Record<string, number | null>).some((v) => v !== null && Number(v) < 0),
    );
    expect(negatives).toHaveLength(0);
  });

  it("reports demo dataset event integrity", async () => {
    const { client } = await authedClient();
    const integrity = await loadEventIntegrity(client);
    expect(integrity.ordersChecked).toBeGreaterThan(0);
    // The synthetic broken order above is the only expected offender.
    expect(integrity.outOfSequence).toBeLessThanOrEqual(1);
  });
});
