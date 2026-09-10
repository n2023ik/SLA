/**
 * Data layer for the operations dashboard.
 *
 * Everything that reads the database and turns rows into the derived shapes the
 * app renders lives here — with no server-function wrapper — so the validation
 * suite exercises exactly the same code path as the dashboard. `ops.functions.ts`
 * is a thin RPC shell over this module.
 *
 * Stage durations come from `order_stage_timings` (derived from order_events in
 * the database). SLA status, delayed stage and diagnoses are derived once here.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { THRESHOLDS, actualMinutesFor, shiftForHour } from "./diagnosis/thresholds";
import { STAGES } from "./diagnosis/thresholds";
import {
  computeBottlenecks,
  computeOverview,
  deriveBreachStage,
  deriveSlaStatus,
  type BottleneckBundle,
  type Overview,
} from "./analytics";
import {
  buildContext,
  classifySystemic,
  diagnoseOrder,
  overrunStages,
  primaryDiagnosis,
  type SystemicFinding,
} from "./diagnosis/engine";
import type {
  Diagnosis,
  DiagnosisContext,
  Employee,
  EmployeeStat,
  InventorySignal,
  OrderRow,
  PackingStation,
  Shift,
  Zone,
} from "./diagnosis/types";

export function serverClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input as RequestInfo, { ...init, headers });
      },
    },
  });
}

// Shift bucketing is centralised in ./diagnosis/thresholds so SQL, engine and
// tests agree; re-exported here for existing callers.
export { shiftForHour };

export const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface FactRow {
  order_id: string;
  store_id: string;
  created_at: string;
  promised_delivery_time: string;
  delivered_at: string | null;
  status: string;
  total_items: number;
  customer_distance_km: number | string;
  zone_id: string | null;
  station_id: string | null;
  picker_id: string | null;
  packer_id: string | null;
  rider_id: string | null;
  pick_start_delay: number | string | null;
  pick_duration: number | string | null;
  pack_duration: number | string | null;
  dispatch_wait: number | string | null;
  delivery_duration: number | string | null;
  total_duration: number | string | null;
}

/** Maps a database row into the one derived shape the whole app reads. */
export function toOrderRow(row: FactRow, nowMs: number): OrderRow {
  const hour = new Date(row.created_at).getUTCHours();
  const base: OrderRow = {
    orderId: row.order_id,
    storeId: row.store_id,
    createdAt: row.created_at,
    promisedAt: row.promised_delivery_time,
    deliveredAt: row.delivered_at,
    status: row.status,
    totalItems: row.total_items,
    distanceKm: Number(row.customer_distance_km),
    zoneId: row.zone_id ?? "—",
    stationId: row.station_id,
    pickerId: row.picker_id,
    packerId: row.packer_id,
    riderId: row.rider_id,
    hour,
    shift: shiftForHour(hour),
    completed: row.delivered_at !== null,
    slaStatus: deriveSlaStatus(
      {
        deliveredAt: row.delivered_at,
        promisedAt: row.promised_delivery_time,
        totalDuration: num(row.total_duration),
      },
      nowMs,
    ),
    breachStage: null,
    delayed: false,
    timings: {
      pickStartDelay: num(row.pick_start_delay),
      pickDuration: num(row.pick_duration),
      packDuration: num(row.pack_duration),
      dispatchWait: num(row.dispatch_wait),
      deliveryDuration: num(row.delivery_duration),
      totalDuration: num(row.total_duration),
    },
  };
  base.breachStage = deriveBreachStage(base);
  base.delayed = overrunStages(base).length > 0;
  return base;
}

export interface OpsSnapshot {
  generatedAt: string;
  rangeDays: number;
  orders: OrderRow[];
  liveOrders: OrderRow[];
  diagnoses: Diagnosis[];
  /** One primary diagnosis per delayed order. */
  primaryDiagnoses: Diagnosis[];
  systemic: SystemicFinding[];
  employeeStats: EmployeeStat[];
  overview: Overview;
  bottlenecks: BottleneckBundle;
  zones: Zone[];
  workforce: Employee[];
  stations: PackingStation[];
  inventory: InventorySignal[];
  validation: ValidationReport;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  checks: ValidationCheck[];
  passed: boolean;
}

export async function loadReference(supabase: SupabaseClient) {
  const [zonesRes, workforceRes, stationsRes, inventoryRes] = await Promise.all([
    supabase.from("zones").select("zone_id, zone_name, store_id"),
    supabase
      .from("workforce")
      .select("employee_id, name, role, zone_id, shift, active, joining_date")
      .limit(200),
    supabase.from("packing_stations").select("station_id, store_id, status, current_queue_length"),
    supabase.from("zone_inventory_health").select("zone_id, total_skus, low_stock_skus"),
  ]);

  const zones: Zone[] = (zonesRes.data ?? []).map((z) => ({
    zoneId: z.zone_id as string,
    zoneName: z.zone_name as string,
    storeId: z.store_id as string,
  }));
  const workforce: Employee[] = (workforceRes.data ?? []).map((w) => ({
    employeeId: w.employee_id as string,
    name: w.name as string,
    role: w.role as Employee["role"],
    zoneId: w.zone_id as string,
    shift: w.shift as Shift,
    active: Boolean(w.active),
    joiningDate: w.joining_date as string,
  }));
  const stations: PackingStation[] = (stationsRes.data ?? []).map((s) => ({
    stationId: s.station_id as string,
    storeId: s.store_id as string,
    status: s.status as string,
    currentQueueLength: Number(s.current_queue_length),
  }));
  const inventory: InventorySignal[] = (inventoryRes.data ?? []).map((i) => ({
    zoneId: i.zone_id as string,
    totalSkus: Number(i.total_skus),
    lowStockSkus: Number(i.low_stock_skus),
  }));

  return { zones, workforce, stations, inventory };
}

export async function loadFacts(
  supabase: SupabaseClient,
  sinceIso: string | null,
  nowMs: number,
): Promise<OrderRow[]> {
  // Pages until the range is exhausted — historical analytics is never
  // silently truncated. Ordering is deterministic (created_at, then order_id)
  // so page boundaries cannot drop or duplicate a row.
  const rows: FactRow[] = [];
  const pageSize = 1000;
  const maxPages = 1000;
  for (let page = 0; page < maxPages; page += 1) {
    let query = supabase
      .from("order_facts")
      .select("*")
      .order("created_at", { ascending: false })
      .order("order_id", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (sinceIso) query = query.gte("created_at", sinceIso);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as FactRow[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows.map((row) => toOrderRow(row, nowMs));
  }
  throw new Error(
    `loadFacts exceeded ${maxPages * pageSize} rows — refusing to truncate historical analytics silently`,
  );
}

/**
 * Threshold parity: the DB row drives the SQL views, THRESHOLDS drives the
 * engine. They must stay identical, so drift is reported, never hidden.
 */
export async function loadThresholdDrift(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("sla_thresholds").select("*").maybeSingle();
  const cfg = (data ?? null) as Record<string, unknown> | null;
  if (!cfg) return ["sla_thresholds row missing"];
  const expect: [string, number][] = [
    ["pick_start_max", THRESHOLDS.pickStart.max],
    ["picking_base", THRESHOLDS.picking.base],
    ["picking_per_item", THRESHOLDS.picking.perItem],
    ["picking_tolerance", THRESHOLDS.picking.tolerance],
    ["packing_base", THRESHOLDS.packing.base],
    ["packing_per_item", THRESHOLDS.packing.perItem],
    ["packing_tolerance", THRESHOLDS.packing.tolerance],
    ["dispatch_max", THRESHOLDS.dispatch.max],
    ["delivery_base", THRESHOLDS.delivery.base],
    ["delivery_per_km", THRESHOLDS.delivery.perKm],
    ["delivery_tolerance", THRESHOLDS.delivery.tolerance],
    ["total_sla_minutes", THRESHOLDS.slaWindowMinutes],
    ["at_risk_remaining_minutes", THRESHOLDS.atRiskRemainingMinutes],
    ["zone_breach_rate", THRESHOLDS.zoneBreachRate],
    ["hour_breach_rate", THRESHOLDS.hourBreachRate],
    ["station_queue", THRESHOLDS.stationQueue],
  ];
  const drift: string[] = [];
  for (const [column, value] of expect) {
    if (Number(cfg[column]) !== value) drift.push(`${column}=${String(cfg[column])} vs ${value}`);
  }
  return drift;
}

export interface EventIntegrity {
  ordersChecked: number;
  outOfSequence: number;
  duplicateEventTypes: number;
  incompleteOrders: number;
}

/**
 * Event-level integrity, read from the order_event_validation view. Orders whose
 * canonical events are out of sequence are reported here; the timings view
 * refuses to emit a duration for them, so a negative duration can never reach
 * the analytics layer.
 */
export async function loadEventIntegrity(supabase: SupabaseClient): Promise<EventIntegrity> {
  const { data, error } = await supabase
    .from("order_event_validation")
    .select("order_id, missing_events, duplicate_event_types, out_of_sequence")
    .order("order_id", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    missing_events: string[] | null;
    duplicate_event_types: number;
    out_of_sequence: boolean;
  }[];
  return {
    ordersChecked: rows.length,
    outOfSequence: rows.filter((r) => r.out_of_sequence).length,
    duplicateEventTypes: rows.filter((r) => Number(r.duplicate_event_types) > 0).length,
    incompleteOrders: rows.filter((r) => (r.missing_events ?? []).length > 0).length,
  };
}

/** Internal consistency checks over the exact data the pages render. */
export function validate(
  orders: OrderRow[],
  overview: Overview,
  primaryDiagnoses: Diagnosis[],
  allDiagnoses: Diagnosis[],
  thresholdDrift: string[],
  eventIntegrity?: EventIntegrity,
): ValidationReport {
  const completed = orders.filter((o) => o.completed);
  const live = orders.filter((o) => !o.completed);
  const countStatus = (rows: OrderRow[], status: OrderRow["slaStatus"]) =>
    rows.filter((o) => o.slaStatus === status).length;

  const delayedOrders = orders.filter((o) => o.delayed);
  const dispatchDelays = orders.filter((o) => overrunStages(o).includes("DISPATCH")).length;
  const deliveryDelays = orders.filter((o) => overrunStages(o).includes("DELIVERY")).length;
  const dispatchDiagnoses = allDiagnoses.filter((d) => d.stage === "DISPATCH").length;
  const deliveryDiagnoses = allDiagnoses.filter((d) => d.stage === "DELIVERY").length;

  const checks: ValidationCheck[] = [
    {
      name: "Total orders = completed + in progress",
      passed: overview.completedOrders + overview.inProgressOrders === overview.totalOrders,
      detail: `${overview.completedOrders} + ${overview.inProgressOrders} = ${overview.totalOrders}`,
    },
    {
      name: "Status split covers every order",
      passed: overview.onTrack + overview.atRisk + overview.breached === overview.totalOrders,
      detail: `${overview.onTrack} on track + ${overview.atRisk} at risk + ${overview.breached} breached = ${overview.totalOrders}`,
    },
    {
      name: "Completed orders are only on track or breached",
      passed:
        countStatus(completed, "AT_RISK") === 0 &&
        countStatus(completed, "ON_TRACK") + countStatus(completed, "BREACHED") === completed.length,
      detail: `${countStatus(completed, "ON_TRACK")} on track + ${countStatus(completed, "BREACHED")} breached = ${completed.length} completed, 0 at risk`,
    },
    {
      name: "In-progress orders split across all three states",
      passed:
        countStatus(live, "ON_TRACK") +
          countStatus(live, "AT_RISK") +
          countStatus(live, "BREACHED") ===
        live.length,
      detail: `${countStatus(live, "ON_TRACK")} + ${countStatus(live, "AT_RISK")} + ${countStatus(live, "BREACHED")} = ${live.length} in progress`,
    },
    {
      name: "Every delayed order has a diagnosis",
      passed: primaryDiagnoses.length === delayedOrders.length,
      detail: `${primaryDiagnoses.length} diagnoses for ${delayedOrders.length} delayed orders`,
    },
    {
      name: "Dispatch delays produce dispatch diagnoses",
      passed: dispatchDiagnoses === dispatchDelays,
      detail: `${dispatchDelays} orders exceed the dispatch threshold, ${dispatchDiagnoses} dispatch diagnoses`,
    },
    {
      name: "Delivery delays produce delivery diagnoses",
      passed: deliveryDiagnoses === deliveryDelays,
      detail: `${deliveryDelays} orders exceed the delivery threshold, ${deliveryDiagnoses} delivery diagnoses`,
    },
    {
      name: "Stage timings present for completed orders",
      passed: completed.every((o) => o.timings.totalDuration !== null),
      detail: `${completed.filter((o) => o.timings.totalDuration === null).length} completed orders without event-derived timings`,
    },
    {
      name: "Threshold config matches the engine constants",
      passed: thresholdDrift.length === 0,
      detail:
        thresholdDrift.length === 0
          ? "database sla_thresholds row equals THRESHOLDS"
          : `drift: ${thresholdDrift.join(", ")}`,
    },
  ];

  const negativeDurations = orders.filter((o) =>
    STAGES.some((stage) => (actualMinutesFor(o, stage) ?? 0) < 0),
  ).length;
  checks.push({
    name: "No negative stage durations",
    passed: negativeDurations === 0,
    detail: `${negativeDurations} orders carry a negative stage duration`,
  });

  if (eventIntegrity) {
    checks.push({
      name: "Canonical event ordering",
      passed: eventIntegrity.outOfSequence === 0,
      detail: `${eventIntegrity.outOfSequence} of ${eventIntegrity.ordersChecked} orders have out-of-sequence events; ${eventIntegrity.duplicateEventTypes} have duplicate event types`,
    });
  }

  return { checks, passed: checks.every((c) => c.passed) };
}

/** Builds the one snapshot every page (and the validation suite) reads. */
export async function buildSnapshot(
  days: number,
  nowMs = Date.now(),
  client?: SupabaseClient,
): Promise<OpsSnapshot> {
  const supabase = client ?? serverClient();
  const since = new Date(nowMs - days * 86400000).toISOString();

  const [orders, reference, thresholdDrift, eventIntegrity] = await Promise.all([
    loadFacts(supabase, since, nowMs),
    loadReference(supabase),
    loadThresholdDrift(supabase),
    loadEventIntegrity(supabase),
  ]);

  const ctx = buildContext(orders, reference.stations, reference.inventory, reference.workforce);
  const zoneNames = Object.fromEntries(reference.zones.map((z) => [z.zoneId, z.zoneName]));

  const allDiagnoses: Diagnosis[] = [];
  const primaryDiagnoses: Diagnosis[] = [];
  for (const order of orders) {
    allDiagnoses.push(...diagnoseOrder(order, ctx));
    const primary = primaryDiagnosis(order, ctx);
    if (primary) primaryDiagnoses.push(primary);
  }

  const overview = computeOverview(orders);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    rangeDays: days,
    orders,
    liveOrders: orders.filter((o) => !o.completed),
    diagnoses: allDiagnoses.sort((a, b) => b.confidenceScore - a.confidenceScore),
    primaryDiagnoses: primaryDiagnoses.sort((a, b) => b.overrunMinutes - a.overrunMinutes),
    systemic: classifySystemic(orders, ctx),
    employeeStats: Object.values(ctx.employeeStats).sort((a, b) => b.peerRatio - a.peerRatio),
    overview,
    bottlenecks: computeBottlenecks(orders, ctx, primaryDiagnoses, zoneNames),
    ...reference,
    validation: validate(
      orders,
      overview,
      primaryDiagnoses,
      allDiagnoses,
      thresholdDrift,
      eventIntegrity,
    ),
  };
}

/** The snapshot context, exposed so tests can re-run individual rules. */
export async function buildSnapshotContext(
  days: number,
  nowMs = Date.now(),
  client?: SupabaseClient,
): Promise<{ orders: OrderRow[]; ctx: DiagnosisContext }> {
  const supabase = client ?? serverClient();
  const since = new Date(nowMs - days * 86400000).toISOString();
  const [orders, reference] = await Promise.all([
    loadFacts(supabase, since, nowMs),
    loadReference(supabase),
  ]);
  return {
    orders,
    ctx: buildContext(orders, reference.stations, reference.inventory, reference.workforce),
  };
}

export interface OrderTimelineEvent {
  eventType: string;
  timestamp: string;
  employeeId: string | null;
  employeeRole: string | null;
  zoneId: string | null;
  stationId: string | null;
}

export interface OrderDetail {
  order: OrderRow;
  events: OrderTimelineEvent[];
  diagnoses: Diagnosis[];
  employees: Employee[];
}

/** One complete order journey plus the diagnoses derived from it. */
export async function loadOrderDetail(
  orderId: string,
  nowMs = Date.now(),
  client?: SupabaseClient,
): Promise<OrderDetail | null> {
  const supabase = client ?? serverClient();
  const [factRes, eventsRes, reference] = await Promise.all([
    supabase.from("order_facts").select("*").eq("order_id", orderId).maybeSingle(),
    supabase
      .from("order_events")
      .select("event_type, timestamp, employee_id, employee_role, zone_id, station_id")
      .eq("order_id", orderId)
      .order("timestamp", { ascending: true }),
    loadReference(supabase),
  ]);

  if (!factRes.data) return null;
  const order = toOrderRow(factRes.data as unknown as FactRow, nowMs);

  // Context from the surrounding week so peer comparisons stay meaningful.
  const since = new Date(nowMs - 7 * 86400000).toISOString();
  const peers = await loadFacts(supabase, since, nowMs);
  const ctx = buildContext(
    peers.some((p) => p.orderId === order.orderId) ? peers : [...peers, order],
    reference.stations,
    reference.inventory,
    reference.workforce,
  );

  const employeeIds = [order.pickerId, order.packerId, order.riderId].filter((v): v is string =>
    Boolean(v),
  );

  return {
    order,
    events: (eventsRes.data ?? []).map((e) => ({
      eventType: e.event_type as string,
      timestamp: e.timestamp as string,
      employeeId: (e.employee_id as string | null) ?? null,
      employeeRole: (e.employee_role as string | null) ?? null,
      zoneId: (e.zone_id as string | null) ?? null,
      stationId: (e.station_id as string | null) ?? null,
    })),
    diagnoses: diagnoseOrder(order, ctx),
    employees: reference.workforce.filter((w) => employeeIds.includes(w.employeeId)),
  };
}
