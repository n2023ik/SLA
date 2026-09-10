/**
 * Backend API layer: every dashboard read goes through one of these server
 * functions. All calculation and data loading lives in `ops.data.ts`, which the
 * validation suite imports directly — so the tests and the dashboard cannot
 * drift apart.
 */

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSnapshot,
  loadFacts,
  loadOrderDetail,
  loadReference,
  num,
  type OpsSnapshot,
  type OrderDetail,
} from "./ops.data";
import { buildContext, primaryDiagnosis } from "./diagnosis/engine";
import type { Diagnosis } from "./diagnosis/types";
import { computeImprovement, isMetric, isOutcome, type Metric } from "./interventions";

export type {
  OpsSnapshot,
  OrderDetail,
  OrderTimelineEvent,
  ValidationCheck,
  ValidationReport,
} from "./ops.data";

/**
 * Operational data is only readable by a signed-in operator: the request's own
 * Supabase client is used, so row-level security applies as that user and
 * anonymous callers are rejected before any query runs.
 */
export const getOpsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { days?: number } | undefined) => ({
    days: Math.max(1, Math.min(90, input?.days ?? 30)),
  }))
  .handler(
    async ({ data, context }): Promise<OpsSnapshot> =>
      buildSnapshot(data.days, Date.now(), context.supabase),
  );

export const getOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { orderId: string }) => ({ orderId: String(input.orderId) }))
  .handler(
    async ({ data, context }): Promise<OrderDetail | null> =>
      loadOrderDetail(data.orderId, Date.now(), context.supabase),
  );

/**
 * Persists the current engine output into the diagnoses table so findings are
 * auditable outside the dashboard session.
 */
export const persistDiagnoses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { days?: number } | undefined) => ({
    days: Math.max(1, Math.min(90, input?.days ?? 7)),
  }))
  .handler(async ({ data, context }): Promise<{ persisted: number }> => {
    const supabase = context.supabase;
    const nowMs = Date.now();
    const since = new Date(nowMs - data.days * 86400000).toISOString();
    const [orders, reference] = await Promise.all([
      loadFacts(supabase, since, nowMs),
      loadReference(supabase),
    ]);
    const ctx = buildContext(
      orders,
      reference.stations,
      reference.inventory,
      reference.workforce,
    );

    const rows = orders
      .map((order) => primaryDiagnosis(order, ctx))
      .filter((d): d is Diagnosis => d !== null)
      .map((d) => ({
        order_id: d.orderId,
        stage: d.stage,
        root_cause: `${d.category}: ${d.rootCause}`,
        confidence_score: d.confidenceScore,
        recommended_action: d.recommendedAction,
        resolved: false,
      }));

    if (rows.length === 0) return { persisted: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("diagnoses")
      .upsert(rows, { onConflict: "order_id,stage" });
    if (error) throw new Error(error.message);
    return { persisted: rows.length };
  });

/* ------------------------------------------------------------------ *
 * Interventions — recorded by a person, never inferred by the system. *
 * Reading, creating and updating all require a signed-in operator.    *
 * ------------------------------------------------------------------ */

export interface Intervention {
  id: string;
  signature: string | null;
  orderId: string | null;
  zoneId: string | null;
  stage: string | null;
  shift: string | null;
  hour: number | null;
  rootCause: string | null;
  recommendation: string;
  actionTaken: string;
  actionAt: string;
  metric: Metric;
  beforeSla: number | null;
  afterSla: number | null;
  outcome: string;
  /** Change in the metric's own unit (percentage points, or minutes saved). */
  improvementAbs: number | null;
  /** Change relative to the before measurement, in percent. */
  improvementPct: number | null;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
  revisionCount?: number;
}

interface InterventionRow {
  id: string;
  signature: string | null;
  order_id: string | null;
  zone_id: string | null;
  stage: string | null;
  shift: string | null;
  hour: number | null;
  root_cause: string | null;
  recommendation: string;
  action_taken: string;
  action_at: string;
  metric: string;
  before_sla: number | string | null;
  after_sla: number | string | null;
  outcome: string;
  improvement_abs: number | string | null;
  improvement_pct: number | string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

const toIntervention = (r: InterventionRow): Intervention => ({
  id: r.id,
  signature: r.signature,
  orderId: r.order_id,
  zoneId: r.zone_id,
  stage: r.stage,
  shift: r.shift,
  hour: r.hour ?? null,
  rootCause: r.root_cause,
  recommendation: r.recommendation,
  actionTaken: r.action_taken,
  actionAt: r.action_at,
  metric: isMetric(r.metric) ? r.metric : "SLA_ADHERENCE_PCT",
  beforeSla: num(r.before_sla),
  afterSla: num(r.after_sla),
  outcome: r.outcome,
  improvementAbs: num(r.improvement_abs),
  improvementPct: num(r.improvement_pct),
  notes: r.notes,
  recordedBy: r.recorded_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const listInterventions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Intervention[]> => {
    const { data, error } = await context.supabase
      .from("interventions")
      .select("*")
      .order("action_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as InterventionRow[]).map(toIntervention);

    // Edit history is kept per intervention; surface how many times each was revised.
    const { data: revisions } = await context.supabase
      .from("intervention_revisions")
      .select("intervention_id");
    const counts = new Map<string, number>();
    for (const r of (revisions ?? []) as { intervention_id: string }[]) {
      counts.set(r.intervention_id, (counts.get(r.intervention_id) ?? 0) + 1);
    }
    return rows.map((r) => ({ ...r, revisionCount: counts.get(r.id) ?? 0 }));
  });

interface InterventionInput {
  recommendation: string;
  actionTaken: string;
  actionAt?: string | null;
  signature?: string | null;
  orderId?: string | null;
  zoneId?: string | null;
  stage?: string | null;
  shift?: string | null;
  hour?: number | null;
  rootCause?: string | null;
  metric?: string;
  beforeSla?: number | null;
  afterSla?: number | null;
  outcome?: string;
  notes?: string | null;
}

const text = (value: unknown, max = 500) => {
  const s = String(value ?? "").trim();
  return s === "" ? null : s.slice(0, max);
};

const numberOrNull = (value: unknown) =>
  value === null || value === undefined || value === "" || Number.isNaN(Number(value))
    ? null
    : Number(value);

const validateInput = (input: InterventionInput) => {
  const recommendation = text(input.recommendation);
  const actionTaken = text(input.actionTaken);
  if (!recommendation) throw new Error("A recommendation is required");
  if (!actionTaken) throw new Error("Describe the action that was taken");
  const outcome = input.outcome ?? "PENDING";
  if (!isOutcome(outcome)) throw new Error(`Unknown outcome: ${outcome}`);
  const metric = input.metric ?? "SLA_ADHERENCE_PCT";
  if (!isMetric(metric)) throw new Error(`Unknown metric: ${metric}`);
  return {
    recommendation,
    actionTaken,
    actionAt: input.actionAt ? new Date(input.actionAt).toISOString() : new Date().toISOString(),
    signature: text(input.signature, 200),
    orderId: text(input.orderId, 40),
    zoneId: text(input.zoneId, 40),
    stage: text(input.stage, 40),
    shift: text(input.shift, 40),
    hour:
      input.hour === null || input.hour === undefined ? null : Math.max(0, Math.min(23, Number(input.hour))),
    rootCause: text(input.rootCause, 200),
    metric,
    beforeSla: numberOrNull(input.beforeSla),
    afterSla: numberOrNull(input.afterSla),
    outcome,
    notes: text(input.notes, 1000),
  };
};

/** An intervention only exists because an operator explicitly recorded it. */
export const recordIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }): Promise<Intervention> => {
    const improvement = computeImprovement(data.metric, data.beforeSla, data.afterSla);
    const { data: row, error } = await context.supabase
      .from("interventions")
      .insert({
        recommendation: data.recommendation,
        action_taken: data.actionTaken,
        action_at: data.actionAt,
        signature: data.signature,
        order_id: data.orderId,
        zone_id: data.zoneId,
        stage: data.stage,
        shift: data.shift,
        hour: data.hour,
        root_cause: data.rootCause,
        metric: data.metric,
        before_sla: data.beforeSla,
        after_sla: data.afterSla,
        outcome: data.outcome,
        improvement_abs: improvement.absolute,
        improvement_pct: improvement.relativePct,
        notes: data.notes,
        recorded_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toIntervention(row as unknown as InterventionRow);
  });

/**
 * Records the "after" measurement / outcome on an existing intervention. The
 * previous values are copied into intervention_revisions by a database trigger,
 * so nothing is silently overwritten.
 */
export const updateIntervention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      id: string;
      afterSla?: number | null;
      outcome?: string;
      actionTaken?: string;
      notes?: string | null;
    }) => {
      const id = String(input.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("A valid intervention id is required");
      if (input.outcome !== undefined && !isOutcome(input.outcome)) {
        throw new Error(`Unknown outcome: ${input.outcome}`);
      }
      return {
        id,
        // beforeSla is deliberately absent: the baseline measurement is
        // immutable once the intervention has been recorded (also enforced by a
        // database trigger).
        afterSla: input.afterSla === undefined ? undefined : numberOrNull(input.afterSla),
        outcome: input.outcome,
        actionTaken: input.actionTaken === undefined ? undefined : text(input.actionTaken),
        notes: input.notes === undefined ? undefined : text(input.notes, 1000),
      };
    },
  )
  .handler(async ({ data, context }): Promise<Intervention> => {
    const { data: existingRow, error: readError } = await context.supabase
      .from("interventions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (readError) throw new Error(readError.message);
    const existing = toIntervention(existingRow as unknown as InterventionRow);

    const beforeSla = existing.beforeSla;
    const afterSla = data.afterSla === undefined ? existing.afterSla : data.afterSla;
    const improvement = computeImprovement(existing.metric, beforeSla, afterSla);
    if (data.actionTaken === null) throw new Error("Describe the action that was taken");

    const patch = {
      after_sla: afterSla,
      improvement_abs: improvement.absolute,
      improvement_pct: improvement.relativePct,
      updated_at: new Date().toISOString(),
      ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
      ...(data.actionTaken !== undefined ? { action_taken: data.actionTaken } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    };

    const { data: row, error } = await context.supabase
      .from("interventions")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toIntervention(row as unknown as InterventionRow);
  });
