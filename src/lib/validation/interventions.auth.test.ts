/**
 * Intervention workflow validation against the real database, as a signed-in
 * operator: required fields, measurement ranges, immutable baseline, preserved
 * revision history and no fabricated outcomes.
 *
 * Every row created here carries the VALIDATION_SUITE signature and is removed
 * afterwards, so the intervention history stays empty for the demo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, authedClient, cleanupTestInterventions, TEST_SIGNATURE } from "./client";
import { computeImprovement } from "../interventions";

let client: Awaited<ReturnType<typeof authedClient>>["client"];
let userId: string;
const admin = adminClient();

const base = (over: Record<string, unknown> = {}) => ({
  signature: TEST_SIGNATURE,
  recommendation: "Add picker capacity for the 19:00 window",
  action_taken: "Moved two pickers from the morning shift",
  action_at: new Date().toISOString(),
  metric: "SLA_ADHERENCE_PCT",
  outcome: "PENDING",
  zone_id: "Z1",
  stage: "PICK_START",
  root_cause: "MANPOWER",
  recorded_by: userId,
  ...over,
});

beforeAll(async () => {
  const session = await authedClient();
  client = session.client;
  userId = session.userId;
  await cleanupTestInterventions();
});

afterAll(async () => {
  await cleanupTestInterventions();
});

describe("intervention creation", () => {
  it("records an intervention with a baseline measurement", async () => {
    const { data, error } = await client
      .from("interventions")
      .insert(base({ before_sla: 48 }) as never)
      .select("*")
      .single();
    expect(error?.message).toBeUndefined();
    const row = data as Record<string, unknown>;
    expect(Number(row["before_sla"])).toBe(48);
    expect(row["after_sla"]).toBeNull();
    expect(row["outcome"]).toBe("PENDING");
    expect(row["recorded_by"]).toBe(userId);
    expect(row["created_at"]).toBeTruthy();
    expect(row["updated_at"]).toBeTruthy();
  });

  it("requires a recommendation and an action taken", async () => {
    const missingAction = await client
      .from("interventions")
      .insert(base({ action_taken: null }) as never);
    expect(missingAction.error).not.toBeNull();
    const missingRecommendation = await client
      .from("interventions")
      .insert(base({ recommendation: null }) as never);
    expect(missingRecommendation.error).not.toBeNull();
  });

  it("rejects an adherence measurement outside 0..100", async () => {
    const tooHigh = await client
      .from("interventions")
      .insert(base({ before_sla: 150 }) as never);
    expect(tooHigh.error).not.toBeNull();
    const negative = await client.from("interventions").insert(base({ after_sla: -5 }) as never);
    expect(negative.error).not.toBeNull();
  });

  it("rejects a negative stage-minute measurement", async () => {
    const { error } = await client
      .from("interventions")
      .insert(base({ metric: "STAGE_MINUTES", before_sla: -1 }) as never);
    expect(error).not.toBeNull();
  });
});

describe("before measurement is immutable, after measurement is editable", () => {
  let id: string;

  beforeAll(async () => {
    const { data } = await client
      .from("interventions")
      .insert(base({ before_sla: 50 }) as never)
      .select("id")
      .single();
    id = (data as { id: string }).id;
  });

  it("refuses to change the baseline measurement", async () => {
    const { error } = await client.from("interventions").update({ before_sla: 10 }).eq("id", id);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/immutable/i);
  });

  it("refuses to change the metric after recording", async () => {
    const { error } = await client
      .from("interventions")
      .update({ metric: "STAGE_MINUTES" })
      .eq("id", id);
    expect(error).not.toBeNull();
  });

  it("accepts the after measurement and keeps the previous values in history", async () => {
    const improvement = computeImprovement("SLA_ADHERENCE_PCT", 50, 62);
    const { error } = await client
      .from("interventions")
      .update({
        after_sla: 62,
        outcome: "IMPROVED",
        improvement_abs: improvement.absolute,
        improvement_pct: improvement.relativePct,
      })
      .eq("id", id);
    expect(error).toBeNull();

    const { data } = await client.from("interventions").select("*").eq("id", id).single();
    const row = data as Record<string, unknown>;
    expect(Number(row["before_sla"])).toBe(50);
    expect(Number(row["after_sla"])).toBe(62);
    expect(Number(row["improvement_abs"])).toBe(12);

    const { data: revisions } = await client
      .from("intervention_revisions")
      .select("previous")
      .eq("intervention_id", id);
    expect((revisions ?? []).length).toBeGreaterThan(0);
    const previous = (revisions ?? []).map(
      (r) => (r as { previous: Record<string, unknown> }).previous,
    );
    expect(previous.some((p) => p["after_sla"] === null)).toBe(true);
  });
});

describe("no fabricated outcomes", () => {
  it("leaves improvement empty until both measurements exist", async () => {
    const { data } = await client
      .from("interventions")
      .insert(base({ before_sla: 40 }) as never)
      .select("*")
      .single();
    const row = data as Record<string, unknown>;
    expect(row["improvement_abs"]).toBeNull();
    expect(row["improvement_pct"]).toBeNull();
    expect(row["outcome"]).toBe("PENDING");
    expect(computeImprovement("SLA_ADHERENCE_PCT", 40, null)).toEqual({
      absolute: null,
      relativePct: null,
    });
  });

  it("holds no intervention rows other than the suite's own fixtures", async () => {
    const { count } = await admin
      .from("interventions")
      .select("id", { count: "exact", head: true })
      .neq("signature", TEST_SIGNATURE);
    expect(count ?? 0).toBe(0);
  });
});
