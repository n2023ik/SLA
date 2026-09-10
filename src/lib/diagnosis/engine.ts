/**
 * Diagnosis engine: builds the operational context from a batch of orders and
 * applies the rule set. Rules live in ./rules.ts, thresholds in ./thresholds.ts.
 *
 * Everything in here is derived from stage timings, so the diagnosis page, the
 * bottleneck page and the recommendations page can never disagree: they all
 * consume the output of these functions.
 */

import { RULES } from "./rules";
import { STAGES, THRESHOLDS, actualMinutesFor, isRecurring, round, stageOverrun } from "./thresholds";
import type {
  Diagnosis,
  DiagnosisContext,
  Employee,
  EmployeeStat,
  InventorySignal,
  OrderRow,
  PackingStation,
  RecurrenceStat,
  Role,
  Shift,
  Stage,
} from "./types";

export interface SystemicFinding {
  kind: "ZONE" | "TIME" | "STATION" | "MANPOWER" | "EMPLOYEE";
  key: string;
  title: string;
  detail: string;
  evidence: string[];
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** Orders actually affected by this finding. */
  occurrences: number;
  recommendedAction: string;
}

function share(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function signatureFor(zoneId: string, stage: Stage, hour: number): string {
  return `${zoneId}|${stage}|${hour}`;
}

/** Stages of this order that ran past their overrun threshold. */
export function overrunStages(order: OrderRow): Stage[] {
  return STAGES.filter((stage) => stageOverrun(order, stage) > 0);
}

function stageTimeFor(order: OrderRow, role: Role): number | null {
  if (role === "PICKER") return order.timings.pickDuration;
  if (role === "PACKER") return order.timings.packDuration;
  return order.timings.deliveryDuration;
}

/** Units of work in an order for a role — items for pick/pack, km for riders. */
function workUnits(order: OrderRow, role: Role): number {
  return role === "RIDER" ? Math.max(0.5, order.distanceKm) : Math.max(1, order.totalItems);
}

/**
 * Comparability bucket. Employees are only ever compared with orders that look
 * like theirs:
 *  - pickers: same shift, same zone, similar basket size
 *  - packers: same shift, similar order complexity (basket size band)
 *  - riders:  comparable delivery distance band
 */
function bucketKey(order: OrderRow, role: Role): string {
  if (role === "RIDER") {
    return `RIDER|dist${Math.ceil(Math.max(0.5, order.distanceKm) / 2)}`;
  }
  const band = Math.ceil(Math.max(1, order.totalItems) / 5);
  if (role === "PICKER") return `PICKER|${order.shift}|${order.zoneId}|items${band}`;
  return `PACKER|${order.shift}|items${band}`;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface Sample {
  bucket: string;
  time: number;
  units: number;
  perUnit: number;
  delayed: boolean;
  breached: boolean;
  zoneId: string;
  shift: Shift;
}

/**
 * Workload-matched employee comparison. An employee is only flagged when they
 * are slower than peers who handled *comparable* orders — a high delay count on
 * hard orders never triggers the flag on its own.
 */
export function buildEmployeeStats(orders: OrderRow[]): Record<string, EmployeeStat> {
  const samples = new Map<string, { role: Role; rows: Sample[] }>();
  const buckets = new Map<string, { sum: number; n: number; byEmployee: Map<string, { sum: number; n: number }> }>();

  const push = (id: string | null, role: Role, order: OrderRow) => {
    if (!id) return;
    const time = stageTimeFor(order, role);
    if (time === null) return;
    const units = workUnits(order, role);
    const bucket = bucketKey(order, role);
    const entry = samples.get(id) ?? { role, rows: [] };
    entry.rows.push({
      bucket,
      time,
      units,
      perUnit: time / units,
      delayed: order.delayed,
      breached: order.slaStatus === "BREACHED",
      zoneId: order.zoneId,
      shift: order.shift,
    });
    samples.set(id, entry);

    const b = buckets.get(bucket) ?? { sum: 0, n: 0, byEmployee: new Map() };
    b.sum += time / units;
    b.n += 1;
    const own = b.byEmployee.get(id) ?? { sum: 0, n: 0 };
    own.sum += time / units;
    own.n += 1;
    b.byEmployee.set(id, own);
    buckets.set(bucket, b);
  };

  for (const order of orders) {
    push(order.pickerId, "PICKER", order);
    push(order.packerId, "PACKER", order);
    push(order.riderId, "RIDER", order);
  }

  const stats: Record<string, EmployeeStat> = {};
  for (const [employeeId, entry] of samples) {
    const { role, rows } = entry;
    const times = rows.map((r) => r.time);
    const delayCount = rows.filter((r) => r.delayed).length;
    const breachCount = rows.filter((r) => r.breached).length;

    // Peer comparison per bucket, excluding this employee's own contribution.
    let ownSum = 0;
    let peerSum = 0;
    let comparable = 0;
    const usedBuckets: string[] = [];
    for (const row of rows) {
      const bucket = buckets.get(row.bucket);
      if (!bucket) continue;
      const own = bucket.byEmployee.get(employeeId) ?? { sum: 0, n: 0 };
      const peerN = bucket.n - own.n;
      if (peerN < THRESHOLDS.minBucketOrders || bucket.byEmployee.size < 2) continue;
      const peerMean = (bucket.sum - own.sum) / peerN;
      ownSum += row.perUnit;
      peerSum += peerMean;
      comparable += 1;
      if (!usedBuckets.includes(row.bucket)) usedBuckets.push(row.bucket);
    }

    const ownPerUnit = comparable ? ownSum / comparable : avg(rows.map((r) => r.perUnit));
    const peerPerUnit = comparable ? peerSum / comparable : 0;
    const ratio = peerPerUnit > 0 ? ownPerUnit / peerPerUnit : 1;
    const anomaly =
      comparable >= THRESHOLDS.minComparableOrders && ratio >= THRESHOLDS.peerRatio;

    const unitLabel = role === "RIDER" ? "km" : "item";
    const evidence: string[] = [
      `${rows.length} orders handled, ${comparable} of them in workload buckets with enough peer activity to compare.`,
      `Compared on ${usedBuckets.length} comparability buckets (${
        role === "PICKER"
          ? "same shift, same zone, similar basket size"
          : role === "PACKER"
            ? "same shift, similar order complexity"
            : "comparable delivery distance"
      }).`,
      comparable
        ? `${round(ownPerUnit, 2)} min per ${unitLabel} vs ${round(peerPerUnit, 2)} min per ${unitLabel} for those peers (${round(ratio, 2)}x).`
        : `Not enough comparable peer volume — no peer ratio claimed.`,
      `${delayCount} of ${rows.length} handled orders were delayed at some stage; delay count alone does not create the flag.`,
    ];

    stats[employeeId] = {
      employeeId,
      role,
      zoneId: rows[0]?.zoneId ?? "—",
      shift: rows[0]?.shift ?? "MORNING",
      ordersHandled: rows.length,
      comparableOrders: comparable,
      avgStageTime: round(avg(times), 2),
      medianStageTime: round(median(times), 2),
      workloadPerOrder: round(avg(rows.map((r) => r.units)), 1),
      avgTimePerUnit: round(ownPerUnit, 3),
      peerAvgTimePerUnit: round(peerPerUnit, 3),
      peerRatio: round(ratio, 2),
      delayCount,
      breachCount,
      anomaly,
      evidence,
      productivityScore: round(Math.max(0, Math.min(100, 100 / Math.max(0.3, ratio))), 1),
    };
  }
  return stats;
}

/**
 * Active rostered staff eligible to work a given role/zone/shift. This is the
 * capacity denominator: employees who happen to have received an order are NOT
 * the same thing as available capacity. When per-employee availability
 * intervals become available, only this function needs to change.
 */
export function eligibleStaffCount(
  workforce: Employee[],
  role: Role,
  zoneId: string | null,
  shift: Shift | null,
): number {
  return workforce.filter(
    (e) =>
      e.active &&
      e.role === role &&
      (zoneId === null || e.zoneId === zoneId) &&
      (shift === null || e.shift === shift),
  ).length;
}

/** Orders per available member of staff. */
export function loadPerStaff(orders: number, availableStaff: number): number {
  return availableStaff > 0 ? orders / availableStaff : 0;
}

const dayKey = (iso: string) => iso.slice(0, 10);

export function buildContext(
  orders: OrderRow[],
  stations: PackingStation[],
  inventory: InventorySignal[],
  workforce: Employee[] = [],
): DiagnosisContext {
  const zoneTotal: Record<string, number> = {};
  const zoneDelay: Record<string, number> = {};
  const hourTotal: Record<number, number> = {};
  const hourDelay: Record<number, number> = {};
  const stationTotal: Record<string, number> = {};
  const stationDelay: Record<string, number> = {};
  const hourPickers: Record<number, Set<string>> = {};
  const hourShifts: Record<number, Shift> = {};

  // Stage-specific counters. A delay at one stage must never become evidence
  // for another stage, so every stage keeps its own numerator and denominator.
  const zoneStageTotal: Record<string, Partial<Record<Stage, number>>> = {};
  const zoneStageDelay: Record<string, Partial<Record<Stage, number>>> = {};
  const hourStageTotal: Record<number, Partial<Record<Stage, number>>> = {};
  const hourStageDelay: Record<number, Partial<Record<Stage, number>>> = {};

  const recurrenceRaw: Record<string, { orders: Set<string>; days: Set<string> }> = {};

  const bump = (
    map: Record<string | number, Partial<Record<Stage, number>>>,
    key: string | number,
    stage: Stage,
  ) => {
    const entry = map[key] ?? {};
    entry[stage] = (entry[stage] ?? 0) + 1;
    map[key] = entry;
  };

  for (const order of orders) {
    const stages = overrunStages(order);
    zoneTotal[order.zoneId] = (zoneTotal[order.zoneId] ?? 0) + 1;
    hourTotal[order.hour] = (hourTotal[order.hour] ?? 0) + 1;
    hourShifts[order.hour] = order.shift;
    if (order.pickerId) {
      hourPickers[order.hour] = hourPickers[order.hour] ?? new Set<string>();
      hourPickers[order.hour]!.add(order.pickerId);
    }
    if (order.stationId) {
      stationTotal[order.stationId] = (stationTotal[order.stationId] ?? 0) + 1;
      if (stages.includes("PACKING")) {
        stationDelay[order.stationId] = (stationDelay[order.stationId] ?? 0) + 1;
      }
    }

    for (const stage of STAGES) {
      // Only orders that actually recorded the stage count towards its rate.
      if (actualMinutesFor(order, stage) === null) continue;
      bump(zoneStageTotal, order.zoneId, stage);
      bump(hourStageTotal, order.hour, stage);
      if (stageOverrun(order, stage) > 0) {
        bump(zoneStageDelay, order.zoneId, stage);
        bump(hourStageDelay, order.hour, stage);
      }
    }

    if (stages.length) {
      zoneDelay[order.zoneId] = (zoneDelay[order.zoneId] ?? 0) + 1;
      hourDelay[order.hour] = (hourDelay[order.hour] ?? 0) + 1;
      // Every overrun stage feeds its own signature, so dispatch and delivery
      // patterns are counted instead of being hidden behind one breach stage.
      for (const stage of stages) {
        const key = signatureFor(order.zoneId, stage, order.hour);
        const entry = recurrenceRaw[key] ?? { orders: new Set<string>(), days: new Set<string>() };
        entry.orders.add(order.orderId);
        entry.days.add(dayKey(order.createdAt));
        recurrenceRaw[key] = entry;
      }
    }
  }

  const rates = (
    total: Partial<Record<Stage, number>> | undefined,
    delay: Partial<Record<Stage, number>> | undefined,
  ) => {
    const out: Partial<Record<Stage, number>> = {};
    for (const stage of STAGES) {
      const n = total?.[stage] ?? 0;
      if (n === 0) continue;
      out[stage] = share(delay?.[stage] ?? 0, n);
    }
    return out;
  };

  const zoneStageDelayRate: Record<string, Partial<Record<Stage, number>>> = {};
  const zoneBreachRate: Record<string, number> = {};
  for (const zone of Object.keys(zoneTotal)) {
    zoneBreachRate[zone] = share(zoneDelay[zone] ?? 0, zoneTotal[zone] ?? 0);
    zoneStageDelayRate[zone] = rates(zoneStageTotal[zone], zoneStageDelay[zone]);
  }

  const hourBreachRate: Record<number, number> = {};
  const hourStageDelayRate: Record<number, Partial<Record<Stage, number>>> = {};
  const hourEligiblePickers: Record<number, number> = {};
  const hourLoadPerPicker: Record<number, number> = {};
  for (const hourKey of Object.keys(hourTotal)) {
    const hour = Number(hourKey);
    hourBreachRate[hour] = share(hourDelay[hour] ?? 0, hourTotal[hour] ?? 0);
    hourStageDelayRate[hour] = rates(hourStageTotal[hour], hourStageDelay[hour]);
    const eligible = eligibleStaffCount(workforce, "PICKER", null, hourShifts[hour] ?? null);
    // Roster is the denominator; observed pickers are only a fallback when no
    // workforce roster was supplied to the context.
    const denominator = eligible > 0 ? eligible : (hourPickers[hour]?.size ?? 0);
    hourEligiblePickers[hour] = denominator;
    hourLoadPerPicker[hour] = loadPerStaff(hourTotal[hour] ?? 0, denominator);
  }

  const stationDelayRate: Record<string, number> = {};
  for (const station of Object.keys(stationTotal)) {
    stationDelayRate[station] = share(stationDelay[station] ?? 0, stationTotal[station] ?? 0);
  }

  const loads = Object.values(hourLoadPerPicker);
  const overallLoadPerPicker = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;

  const hourActiveStaff: Record<number, number> = {};
  for (const [hour, pickers] of Object.entries(hourPickers)) {
    hourActiveStaff[Number(hour)] = pickers.size;
  }

  const eligibleStaff: Record<string, number> = {};
  for (const e of workforce) {
    if (!e.active) continue;
    const key = `${e.role}|${e.zoneId}|${e.shift}`;
    eligibleStaff[key] = (eligibleStaff[key] ?? 0) + 1;
  }

  const recurrence: Record<string, RecurrenceStat> = {};
  for (const [key, entry] of Object.entries(recurrenceRaw)) {
    recurrence[key] = { affectedOrders: entry.orders.size, distinctDays: entry.days.size };
  }

  return {
    zoneBreachRate,
    zoneOrderCount: zoneTotal,
    hourBreachRate,
    hourOrderCount: hourTotal,
    zoneStageDelayRate,
    hourStageDelayRate,
    zoneStageOrderCount: zoneStageTotal,
    hourStageOrderCount: hourStageTotal,
    stationQueue: Object.fromEntries(stations.map((s) => [s.stationId, s.currentQueueLength])),
    stationDelayRate,
    stationOrderCount: stationTotal,
    inventory: Object.fromEntries(inventory.map((i) => [i.zoneId, i])),
    employeeStats: buildEmployeeStats(orders),
    hourActiveStaff,
    hourEligiblePickers,
    eligibleStaff,
    hourLoadPerPicker,
    overallLoadPerPicker,
    recurrence,
    totalOrders: orders.length,
  };
}

function employeeForStage(order: OrderRow, stage: Stage): string | null {
  switch (stage) {
    case "PICK_START":
    case "PICKING":
      return order.pickerId;
    case "PACKING":
      return order.packerId;
    case "DISPATCH":
    case "DELIVERY":
      return order.riderId;
  }
}

/** Runs every rule against a single order; highest confidence first. */
export function diagnoseOrder(order: OrderRow, ctx: DiagnosisContext): Diagnosis[] {
  const findings: Diagnosis[] = [];
  for (const rule of RULES) {
    const finding = rule.evaluate(order, ctx);
    if (!finding) continue;
    const signature = signatureFor(order.zoneId, finding.stage, order.hour);
    findings.push({
      ...finding,
      orderId: order.orderId,
      signature,
      recurring: isRecurring(ctx.recurrence[signature]),
      zoneId: order.zoneId,
      hour: order.hour,
      shift: order.shift,
      stationId: order.stationId,
      employeeId: employeeForStage(order, finding.stage),
    });
  }
  return findings.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

export function primaryDiagnosis(order: OrderRow, ctx: DiagnosisContext): Diagnosis | null {
  const findings = diagnoseOrder(order, ctx);
  if (findings.length === 0) return null;
  // The primary diagnosis is the stage that lost the most time. It is selected
  // on the unrounded overrun and in the fixed STAGES order, exactly like
  // deriveBreachStage, so the primary diagnosis and the order's breach stage can
  // never disagree because of display rounding or tie-breaking.
  let best = findings[0]!;
  let bestOverrun = -1;
  for (const stage of STAGES) {
    const finding = findings.find((f) => f.stage === stage);
    if (!finding) continue;
    const over = stageOverrun(order, stage);
    if (over > bestOverrun) {
      bestOverrun = over;
      best = finding;
    }
  }
  return best;
}

/** Cross-order classifications: zone, time, station and manpower bottlenecks. */
export function classifySystemic(orders: OrderRow[], ctx: DiagnosisContext): SystemicFinding[] {
  const findings: SystemicFinding[] = [];

  for (const [zone, rate] of Object.entries(ctx.zoneBreachRate)) {
    if (rate < THRESHOLDS.zoneBreachRate) continue;
    const count = ctx.zoneOrderCount[zone] ?? 0;
    const affected = orders.filter((o) => o.zoneId === zone && o.delayed).length;
    findings.push({
      kind: "ZONE",
      key: `ZONE|${zone}`,
      title: `Zone-level bottleneck in ${zone}`,
      detail: `${Math.round(rate * 100)}% of ${count} orders in ${zone} miss a stage threshold.`,
      evidence: [
        `${affected} of ${count} orders in ${zone} overran at least one stage.`,
        `Zone delay share ${Math.round(rate * 100)}% against a ${Math.round(THRESHOLDS.zoneBreachRate * 100)}% trigger.`,
      ],
      severity: rate > 0.6 ? "HIGH" : "MEDIUM",
      occurrences: affected,
      recommendedAction: `Reallocate pickers into ${zone} and review slotting of fast-moving SKUs`,
    });
  }

  for (const [hourKey, rate] of Object.entries(ctx.hourBreachRate)) {
    if (rate < THRESHOLDS.hourBreachRate) continue;
    const hour = Number(hourKey);
    const count = ctx.hourOrderCount[hour] ?? 0;
    if (count < 10) continue;
    const affected = orders.filter((o) => o.hour === hour && o.delayed).length;
    findings.push({
      kind: "TIME",
      key: `TIME|${hour}`,
      title: `Time-based capacity bottleneck at ${String(hour).padStart(2, "0")}:00`,
      detail: `${Math.round(rate * 100)}% of ${count} orders created in this hour are delayed; orders per available picker is ${round(ctx.hourLoadPerPicker[hour] ?? 0, 2)} vs a ${round(ctx.overallLoadPerPicker, 2)} norm.`,
      evidence: [
        `${affected} of ${count} orders created at ${hour}:00 overran a stage.`,
        `${ctx.hourEligiblePickers[hour] ?? 0} pickers rostered and available for this shift (${ctx.hourActiveStaff[hour] ?? 0} actually processed orders).`,
        `Orders per available picker ${round(ctx.hourLoadPerPicker[hour] ?? 0, 2)} vs ${round(ctx.overallLoadPerPicker, 2)} daily norm.`,
      ],
      severity: rate > 0.65 ? "HIGH" : "MEDIUM",
      occurrences: affected,
      recommendedAction: `Add picker and rider capacity for the ${String(hour).padStart(2, "0")}:00 window`,
    });
  }

  for (const [station, rate] of Object.entries(ctx.stationDelayRate)) {
    if (rate < THRESHOLDS.stationDelayRate) continue;
    const count = ctx.stationOrderCount[station] ?? 0;
    const affected = Math.round(rate * count);
    findings.push({
      kind: "STATION",
      key: `STATION|${station}`,
      title: `Packing station congestion at ${station}`,
      detail: `${Math.round(rate * 100)}% of ${count} orders packed at ${station} breach the packing threshold (queue length ${ctx.stationQueue[station] ?? 0}).`,
      evidence: [
        `${affected} of ${count} orders packed at ${station} overran packing.`,
        `Current queue length ${ctx.stationQueue[station] ?? 0} (congestion trigger ${THRESHOLDS.stationQueue}).`,
      ],
      severity: rate > 0.5 ? "HIGH" : "MEDIUM",
      occurrences: affected,
      recommendedAction: `Open an additional packing station and cap the queue at ${station}`,
    });
  }

  const overloadedHours = Object.entries(ctx.hourLoadPerPicker).filter(
    ([, load]) => ctx.overallLoadPerPicker > 0 && load / ctx.overallLoadPerPicker > 1.35,
  );
  if (overloadedHours.length >= 2) {
    const hours = overloadedHours.map(([h]) => `${String(h).padStart(2, "0")}:00`);
    const affected = orders.filter(
      (o) => o.delayed && overloadedHours.some(([h]) => Number(h) === o.hour),
    ).length;
    findings.push({
      kind: "MANPOWER",
      key: "MANPOWER|overload",
      title: "Simultaneous workforce overload",
      detail: `${overloadedHours.length} hour windows run more than 1.35x the normal orders-per-picker load — this is a capacity issue, not an individual one.`,
      evidence: [
        `Overloaded windows: ${hours.join(", ")}.`,
        `${affected} delayed orders were created in those windows.`,
      ],
      severity: "HIGH",
      occurrences: affected,
      recommendedAction: "Re-cut the shift roster to move headcount into the overloaded windows",
    });
  }

  for (const stat of Object.values(ctx.employeeStats)) {
    if (!stat.anomaly) continue;
    findings.push({
      kind: "EMPLOYEE",
      key: `EMPLOYEE|${stat.employeeId}`,
      title: `Performance anomaly: ${stat.employeeId} (${stat.role})`,
      detail: `${round(stat.peerRatio, 2)}x comparable peers on similar workloads (${stat.comparableOrders} comparable orders, avg ${stat.workloadPerOrder} units).`,
      evidence: stat.evidence,
      severity: stat.peerRatio > 1.6 ? "MEDIUM" : "LOW",
      occurrences: stat.comparableOrders,
      recommendedAction: `Coach ${stat.employeeId} on method and verify equipment/zone conditions before any staffing decision`,
    });
  }

  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return findings.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.occurrences - a.occurrences,
  );
}

export const STAGE_LABELS: Record<Stage, string> = {
  PICK_START: "Pick start",
  PICKING: "Picking",
  PACKING: "Packing",
  DISPATCH: "Dispatch",
  DELIVERY: "Delivery",
};
