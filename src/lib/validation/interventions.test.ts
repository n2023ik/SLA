/**
 * Intervention workflow validation. These tests only exercise the intervention
 * measurement layer and its access rules — the SLA engine, diagnosis rules and
 * bottleneck calculations are untouched and covered by diagnosis.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";

import { serverClient } from "../ops.data";
import {
  ABSOLUTE_CHANGE_LABEL,
  METRIC_UNIT,
  OUTCOMES,
  classifyOutcome,
  computeImprovement,
  interventionKpis,
  outcomeBreakdown,
  type InterventionLike,
} from "../interventions";

const row = (over: Partial<InterventionLike>): InterventionLike => ({
  metric: "SLA_ADHERENCE_PCT",
  outcome: "IMPROVED",
  beforeSla: 50,
  afterSla: 60,
  improvementAbs: 10,
  rootCause: "MANPOWER",
  stage: "PICKING",
  zoneId: "Z1",
  ...over,
});

describe("improvement calculation", () => {
  it("treats adherence as percentage points where higher is better", () => {
    expect(computeImprovement("SLA_ADHERENCE_PCT", 48, 61)).toEqual({
      absolute: 13,
      relativePct: 27.1,
    });
    expect(ABSOLUTE_CHANGE_LABEL["SLA_ADHERENCE_PCT"]).toMatch(/percentage points/i);
    expect(METRIC_UNIT["SLA_ADHERENCE_PCT"]).toBe("%");
  });

  it("treats stage time as minutes saved where lower is better", () => {
    expect(computeImprovement("STAGE_MINUTES", 12, 9)).toEqual({ absolute: 3, relativePct: 25 });
    expect(computeImprovement("STAGE_MINUTES", 9, 12).absolute).toBe(-3);
    expect(METRIC_UNIT["STAGE_MINUTES"]).toBe("min");
  });

  it("never fabricates an improvement when a measurement is missing", () => {
    expect(computeImprovement("SLA_ADHERENCE_PCT", null, 60)).toEqual({
      absolute: null,
      relativePct: null,
    });
    expect(computeImprovement("STAGE_MINUTES", 10, null)).toEqual({
      absolute: null,
      relativePct: null,
    });
    expect(computeImprovement("STAGE_MINUTES", 0, 0).relativePct).toBeNull();
  });
});

describe("outcome classification", () => {
  it("suggests an outcome only from recorded measurements", () => {
    expect(classifyOutcome("SLA_ADHERENCE_PCT", 40, 55)).toBe("IMPROVED");
    expect(classifyOutcome("SLA_ADHERENCE_PCT", 40, 40.2)).toBe("NO_CHANGE");
    expect(classifyOutcome("SLA_ADHERENCE_PCT", 40, 30)).toBe("WORSENED");
    expect(classifyOutcome("STAGE_MINUTES", 10, null)).toBe("PENDING");
  });

  it("supports exactly the six required outcome options", () => {
    expect([...OUTCOMES]).toEqual([
      "PENDING",
      "IMPROVED",
      "NO_CHANGE",
      "WORSENED",
      "RESOLVED",
      "NOT_APPLICABLE",
    ]);
  });
});

describe("KPI summary", () => {
  const rows = [
    row({ outcome: "IMPROVED", improvementAbs: 10 }),
    row({ outcome: "RESOLVED", improvementAbs: 20 }),
    row({ outcome: "NO_CHANGE", improvementAbs: 0 }),
    row({ outcome: "WORSENED", improvementAbs: -6 }),
    row({ outcome: "PENDING", beforeSla: 50, afterSla: null, improvementAbs: null }),
    row({ outcome: "NOT_APPLICABLE", beforeSla: null, afterSla: null, improvementAbs: null }),
    row({ metric: "STAGE_MINUTES", outcome: "IMPROVED", beforeSla: 12, afterSla: 8, improvementAbs: 4 }),
  ];

  it("counts only measured outcomes in the improvement rate", () => {
    const k = interventionKpis(rows);
    expect(k.total).toBe(7);
    expect(k.withOutcome).toBe(5); // pending + not applicable excluded
    expect(k.improved).toBe(2);
    expect(k.resolved).toBe(1);
    expect(k.noChange).toBe(1);
    expect(k.worsened).toBe(1);
    expect(k.improvementRatePct).toBe(60);
  });

  it("keeps percentage-point and minute averages separate", () => {
    const k = interventionKpis(rows);
    expect(k.avgAdherenceGainPoints).toBe(6); // (10+20+0-6)/4
    expect(k.avgMinutesSaved).toBe(4);
  });

  it("reports null averages instead of zero when nothing is measured", () => {
    const k = interventionKpis([row({ outcome: "PENDING", improvementAbs: null })]);
    expect(k.improvementRatePct).toBeNull();
    expect(k.avgAdherenceGainPoints).toBeNull();
    expect(k.avgMinutesSaved).toBeNull();
  });

  it("groups recorded outcomes by cause without inventing rows", () => {
    const groups = outcomeBreakdown(rows, (r) => r.rootCause);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("MANPOWER");
    expect(groups[0]!.improved).toBe(3);
    expect(groups[0]!.pending).toBe(1);
  });
});

describe("intervention data integrity and access rules", () => {
  const supabase = serverClient();

  it("blocks anonymous reads of intervention records", async () => {
    const { data, error } = await supabase.from("interventions").select("id").limit(1);
    expect(error ?? (data?.length ?? 0) === 0).toBeTruthy();
    if (!error) expect(data).toEqual([]);
  });

  it("blocks anonymous writes of intervention records", async () => {
    const { error } = await supabase.from("interventions").insert({
      recommendation: "test",
      action_taken: "test",
      outcome: "PENDING",
      metric: "SLA_ADHERENCE_PCT",
    } as never);
    expect(error).not.toBeNull();
  });

  it("blocks anonymous reads of the audit revision history", async () => {
    const { data, error } = await supabase.from("intervention_revisions").select("id").limit(1);
    expect(error ?? (data?.length ?? 0) === 0).toBeTruthy();
  });

  it("ships no demo or fabricated intervention rows", async () => {
    const { count } = await supabase
      .from("interventions")
      .select("id", { count: "exact", head: true });
    expect(count ?? 0).toBe(0);
  });
});
