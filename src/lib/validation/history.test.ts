/**
 * Historical analytics must never be silently truncated. `loadFacts` pages until
 * the range is exhausted; this test drives it with a stub client that holds far
 * more rows than the old six-page (6,000 row) ceiling.
 */
import { describe, expect, it } from "vitest";

import { loadFacts, type FactRow } from "../ops.data";
import type { SupabaseClient } from "@supabase/supabase-js";

const TOTAL = 6500;

function stubClient(total: number): { client: SupabaseClient; calls: () => number } {
  const rows: FactRow[] = Array.from({ length: total }, (_, i) => ({
    order_id: `O${i}`,
    store_id: "S1",
    created_at: new Date(Date.UTC(2026, 0, 1, 12) - i * 60000).toISOString(),
    promised_delivery_time: new Date(Date.UTC(2026, 0, 1, 12)).toISOString(),
    delivered_at: new Date(Date.UTC(2026, 0, 1, 12)).toISOString(),
    status: "DELIVERED",
    total_items: 5,
    customer_distance_km: 2,
    zone_id: "Z1",
    station_id: "ST1",
    picker_id: "P1",
    packer_id: "K1",
    rider_id: "R1",
    pick_start_delay: 1,
    pick_duration: 3,
    pack_duration: 2,
    dispatch_wait: 1,
    delivery_duration: 6,
    total_duration: 13,
  }));

  let calls = 0;
  const query = {
    select: () => query,
    order: () => query,
    gte: () => query,
    range: (from: number, to: number) => {
      calls += 1;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return {
    client: { from: () => query } as unknown as SupabaseClient,
    calls: () => calls,
  };
}

describe("historical pagination", () => {
  it("returns every matching row beyond the old 6,000 row ceiling", async () => {
    const { client, calls } = stubClient(TOTAL);
    const orders = await loadFacts(client, null, Date.now());
    expect(orders).toHaveLength(TOTAL);
    expect(calls()).toBe(7);
    // Deterministic ordering: newest first, unique order ids.
    expect(new Set(orders.map((o) => o.orderId)).size).toBe(TOTAL);
    expect(orders[0]!.orderId).toBe("O0");
  });

  it("stops cleanly when the final page is short", async () => {
    const { client } = stubClient(1200);
    const orders = await loadFacts(client, null, Date.now());
    expect(orders).toHaveLength(1200);
  });
});
