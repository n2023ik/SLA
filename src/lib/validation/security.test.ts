/**
 * Access-control validation: operational data is readable only by a signed-in
 * operator. Anonymous callers must be rejected by the database itself, not by
 * the UI.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { buildSnapshot } from "../ops.data";
import { anonClient, authedClient } from "./client";

const OPERATIONAL = [
  "orders",
  "order_events",
  "zones",
  "workforce",
  "workforce_metrics",
  "packing_stations",
  "inventory",
  "sla_metrics",
  "sla_thresholds",
  "diagnoses",
  "bottleneck_events",
  "order_facts",
  "order_participants",
  "order_stage_timings",
  "order_stage_overruns",
  "order_event_validation",
  "interventions",
  "intervention_revisions",
] as const;

describe("anonymous access is denied", () => {
  const anon = anonClient();

  for (const table of OPERATIONAL) {
    it(`rejects anonymous reads of ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      const blocked = error !== null || (data?.length ?? 0) === 0;
      expect(blocked, `${table} returned rows to an anonymous caller`).toBe(true);
    });
  }

  it("rejects anonymous writes to interventions", async () => {
    const { error } = await anon.from("interventions").insert({
      recommendation: "anon",
      action_taken: "anon",
    } as never);
    expect(error).not.toBeNull();
  });
});

describe("authenticated access succeeds", () => {
  let client: Awaited<ReturnType<typeof authedClient>>["client"];

  beforeAll(async () => {
    client = (await authedClient()).client;
  });

  it("reads operational tables and views as a signed-in operator", async () => {
    for (const table of ["orders", "order_facts", "order_stage_timings", "workforce"]) {
      const { data, error } = await client.from(table).select("*").limit(1);
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    }
  });

  it("builds the dashboard snapshot through an authenticated session", async () => {
    const snap = await buildSnapshot(30, Date.now(), client);
    expect(snap.orders.length).toBeGreaterThan(0);
    expect(snap.overview.totalOrders).toBe(snap.orders.length);
    expect(snap.validation.passed, JSON.stringify(snap.validation.checks, null, 2)).toBe(true);
  });
});
