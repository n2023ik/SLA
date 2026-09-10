/**
 * Diagnostic rules. Each rule inspects one stage of an order against the
 * operational context and returns a root cause with evidence, a confidence
 * score and a recommended action. Rules are independent and can be added,
 * removed or re-ordered without touching the engine.
 *
 * Stage and root-cause category are always separate fields: the stage says
 * WHERE the time was lost, the category says WHY.
 */

import {
  THRESHOLDS,
  expectedMinutesFor,
  round,
  stageOverrun,
} from "./thresholds";
import type { Diagnosis, DiagnosisContext, OrderRow, Stage } from "./types";

export type RuleFinding = Omit<
  Diagnosis,
  "orderId" | "recurring" | "signature" | "zoneId" | "hour" | "shift" | "stationId" | "employeeId"
>;

export interface Rule {
  id: string;
  stage: Stage;
  label: string;
  description: string;
  evaluate: (order: OrderRow, ctx: DiagnosisContext) => RuleFinding | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function clampConfidence(value: number): number {
  return round(Math.max(0.35, Math.min(0.97, value)), 2);
}

/** Shared guard: returns actual/expected/overrun when the stage overran. */
function overrun(order: OrderRow, stage: Stage) {
  const over = stageOverrun(order, stage);
  if (over <= 0) return null;
  const actual = order.timings;
  const actualMinutes =
    stage === "PICK_START"
      ? actual.pickStartDelay
      : stage === "PICKING"
        ? actual.pickDuration
        : stage === "PACKING"
          ? actual.packDuration
          : stage === "DISPATCH"
            ? actual.dispatchWait
            : actual.deliveryDuration;
  if (actualMinutes === null) return null;
  return {
    actualMinutes: round(actualMinutes),
    expectedMinutes: expectedMinutesFor(order, stage),
    overrunMinutes: round(over),
  };
}

/**
 * Rule 1 — PICK_START: checks picker capacity, active picker count, orders per
 * picker, shift and hour.
 */
const pickStartRule: Rule = {
  id: "R1_PICK_START_DELAY",
  stage: "PICK_START",
  label: "Pick start delay",
  description: "Order sat unassigned before picking began.",
  evaluate: (order, ctx) => {
    const base = overrun(order, "PICK_START");
    if (!base) return null;

    // Stage-specific rates only: a delay at another stage must never become
    // evidence for PICK_START.
    const hourRate = ctx.hourStageDelayRate[order.hour]?.["PICK_START"] ?? 0;
    const activePickers = ctx.hourActiveStaff[order.hour] ?? 0;
    const loadPerPicker = ctx.hourLoadPerPicker[order.hour] ?? 0;
    const loadRatio = ctx.overallLoadPerPicker ? loadPerPicker / ctx.overallLoadPerPicker : 1;

    const evidence: string[] = [
      `Pick start took ${base.actualMinutes} min against a ${base.expectedMinutes} min threshold (${base.overrunMinutes} min lost).`,
      `${ctx.hourEligiblePickers[order.hour] ?? activePickers} pickers available at ${order.hour}:00 on the ${order.shift.toLowerCase()} shift, ${round(loadPerPicker, 2)} orders per picker (norm ${round(ctx.overallLoadPerPicker, 2)}).`,
    ];

    let rootCause = "Picker assignment delay — no picker picked up the order promptly";
    let category: Diagnosis["category"] = "OTHER";
    let recommendedAction = "Re-check picker assignment queue and auto-assign idle pickers first";
    let confidence = 0.6;

    if (loadRatio > 1.2 || hourRate >= THRESHOLDS.hourStageDelayRate) {
      rootCause = `Manpower shortage during the ${order.hour}:00 hour (${order.shift.toLowerCase()} shift)`;
      category = "MANPOWER";
      recommendedAction = `Add picker capacity between ${order.hour}:00 and ${order.hour + 1}:00 in ${order.zoneId}`;
      confidence = 0.72 + hourRate * 0.2 + Math.min(0.1, (loadRatio - 1) * 0.2);
      evidence.push(`${pct(hourRate)} of orders created in this hour overrun PICK_START specifically.`);
      evidence.push(
        `Orders per available picker is ${round(loadRatio, 2)}x the daily norm (${ctx.hourEligiblePickers[order.hour] ?? 0} pickers rostered for the shift).`,
      );
    }

    const zoneRate = ctx.zoneStageDelayRate[order.zoneId]?.["PICK_START"] ?? 0;
    if (zoneRate >= THRESHOLDS.zoneStageDelayRate) {
      evidence.push(`Zone ${order.zoneId} overruns PICK_START on ${pct(zoneRate)} of its orders.`);
      if (category === "OTHER") {
        category = "ZONE_CONGESTION";
        rootCause = `Zone ${order.zoneId} congestion delaying pick assignment`;
        recommendedAction = `Reallocate a picker into ${order.zoneId} for this window`;
      }
      confidence += 0.05;
    }

    return {
      stage: "PICK_START",
      ...base,
      rootCause,
      category,
      evidence,
      confidenceScore: clampConfidence(confidence),
      recommendedAction,
    };
  },
};

/**
 * Rule 2 — PICKING: checks picker workload, item count, zone congestion and
 * inventory/location health.
 */
const pickingRule: Rule = {
  id: "R2_PICK_DURATION",
  stage: "PICKING",
  label: "Picking overrun",
  description: "Picking took longer than the item-count adjusted expectation.",
  evaluate: (order, ctx) => {
    const base = overrun(order, "PICKING");
    if (!base) return null;

    const zoneRate = ctx.zoneStageDelayRate[order.zoneId]?.["PICKING"] ?? 0;
    const stat = order.pickerId ? ctx.employeeStats[order.pickerId] : undefined;
    const inv = ctx.inventory[order.zoneId];
    const lowStockShare = inv && inv.totalSkus ? inv.lowStockSkus / inv.totalSkus : 0;

    const evidence: string[] = [
      `Picking took ${base.actualMinutes} min for ${order.totalItems} items; expected ~${base.expectedMinutes} min (${base.overrunMinutes} min lost).`,
      `Picker workload in this hour: ${round(ctx.hourLoadPerPicker[order.hour] ?? 0, 2)} orders per available picker.`,
    ];

    let rootCause = "Picking overrun relative to item count";
    let category: Diagnosis["category"] = "OTHER";
    let recommendedAction = "Review pick path and item locations for this basket profile";
    let confidence = 0.55;

    // Zone congestion and inventory health can both be present. Rather than
    // letting the later check silently win, both are recorded as evidence and
    // the cause is the one with the stronger signal relative to its threshold.
    const zoneSignal = zoneRate / THRESHOLDS.zoneStageDelayRate;
    // Inventory strength is measured against the network, so a zone only takes
    // the inventory cause when its stock health is unusually poor.
    const shares = Object.values(ctx.inventory).map((i) =>
      i.totalSkus ? i.lowStockSkus / i.totalSkus : 0,
    );
    const networkShare = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;
    const inventorySignal =
      lowStockShare >= THRESHOLDS.lowStockShare && networkShare > 0
        ? lowStockShare / networkShare
        : 0;

    if (zoneRate >= THRESHOLDS.zoneStageDelayRate) {
      evidence.push(
        `${pct(zoneRate)} of ${order.zoneId} orders overrun PICKING (${ctx.zoneStageOrderCount[order.zoneId]?.["PICKING"] ?? 0} picked orders sampled).`,
      );
    }
    if (lowStockShare >= THRESHOLDS.lowStockShare) {
      evidence.push(
        `${inv?.lowStockSkus} of ${inv?.totalSkus} SKUs in ${order.zoneId} are below reorder threshold.`,
      );
    }

    if (zoneSignal >= 1 && zoneSignal >= inventorySignal) {
      rootCause = `Zone congestion in ${order.zoneId} slowing picking`;
      category = "ZONE_CONGESTION";
      recommendedAction = `Reallocate a picker into ${order.zoneId} and split its pick aisles`;
      confidence = 0.7 + zoneRate * 0.2;
    } else if (inventorySignal >= 1) {
      // Stock data is zone-level only: there is no order-to-SKU link in the
      // dataset, so this is reported as a signal to investigate, never as the
      // established cause, and confidence stays correspondingly low.
      rootCause = `Inventory risk signal in ${order.zoneId} (zone stock health, not a confirmed cause)`;
      category = "INVENTORY_SIGNAL";
      recommendedAction = `Investigate inventory accuracy and bin locations in ${order.zoneId}; capture order-to-SKU lines to confirm`;
      confidence = Math.max(confidence, 0.5);
      evidence.push(
        "Evidence is zone-level stock health only — no order-to-SKU relationship exists in the dataset, so inventory is a signal, not a proven cause.",
      );
    }

    if (stat?.anomaly) {
      rootCause = `Recurring delay pattern for ${stat.employeeId} on comparable baskets`;
      category = "INDIVIDUAL_ANOMALY";
      recommendedAction = `Review pick method with ${stat.employeeId}; pair with a high-performing picker on the same shift`;
      confidence = Math.max(confidence, 0.66 + Math.min(0.2, (stat.peerRatio - 1) * 0.3));
      evidence.push(
        `${stat.employeeId} averages ${round(stat.avgTimePerUnit, 2)} min/item vs ${round(stat.peerAvgTimePerUnit, 2)} min/item across ${stat.comparableOrders} comparable orders (same shift, same zone, similar basket) — ${round(stat.peerRatio, 2)}x peers.`,
      );
    }

    if (order.totalItems > 18) {
      evidence.push(`Large basket (${order.totalItems} items) in the top load band.`);
    }

    return {
      stage: "PICKING",
      ...base,
      rootCause,
      category,
      evidence,
      confidenceScore: clampConfidence(confidence),
      recommendedAction,
    };
  },
};

/**
 * Rule 3 — PACKING: checks packer workload, order complexity and packing
 * station queue.
 */
const packingRule: Rule = {
  id: "R3_PACK_DURATION",
  stage: "PACKING",
  label: "Packing overrun",
  description: "Packing exceeded the expected time for the basket size.",
  evaluate: (order, ctx) => {
    const base = overrun(order, "PACKING");
    if (!base) return null;

    const queue = order.stationId ? (ctx.stationQueue[order.stationId] ?? 0) : 0;
    const stationRate = order.stationId ? (ctx.stationDelayRate[order.stationId] ?? 0) : 0;
    const stat = order.packerId ? ctx.employeeStats[order.packerId] : undefined;
    const evidence: string[] = [
      `Packing took ${base.actualMinutes} min for ${order.totalItems} items; expected ~${base.expectedMinutes} min (${base.overrunMinutes} min lost).`,
    ];

    let rootCause = "Packing overrun relative to basket size";
    let category: Diagnosis["category"] = "OTHER";
    let recommendedAction = "Prioritise this order for packing and rebalance the packing queue";
    let confidence = 0.55;

    if (queue >= THRESHOLDS.stationQueue || stationRate >= 0.5) {
      rootCause = `Packing station ${order.stationId} queue congestion`;
      category = "PACKING_STATION";
      recommendedAction = `Open an additional packing station and divert traffic away from ${order.stationId}`;
      confidence = 0.75 + Math.min(0.15, stationRate * 0.2);
      evidence.push(`Station ${order.stationId} queue length is ${queue}.`);
      evidence.push(
        `${pct(stationRate)} of ${ctx.stationOrderCount[order.stationId ?? ""] ?? 0} orders packed at ${order.stationId} show a packing delay.`,
      );
    }

    if (stat?.anomaly) {
      evidence.push(
        `Performance anomaly: ${stat.employeeId} averages ${round(stat.avgTimePerUnit, 2)} min/item vs ${round(stat.peerAvgTimePerUnit, 2)} for packers on comparable order complexity (${round(stat.peerRatio, 2)}x over ${stat.comparableOrders} comparable orders).`,
      );
      if (category !== "PACKING_STATION") {
        rootCause = `Recurring delay pattern for packer ${stat.employeeId}`;
        category = "INDIVIDUAL_ANOMALY";
        recommendedAction = `Review packing method with ${stat.employeeId}; check station ergonomics and material supply`;
        confidence = Math.max(confidence, 0.66);
      }
    }

    return {
      stage: "PACKING",
      ...base,
      rootCause,
      category,
      evidence,
      confidenceScore: clampConfidence(confidence),
      recommendedAction,
    };
  },
};

/**
 * Rule 4 — DISPATCH: checks rider availability, assignment wait and the
 * dispatch queue for the hour.
 */
const dispatchRule: Rule = {
  id: "R4_DISPATCH_WAIT",
  stage: "DISPATCH",
  label: "Dispatch wait",
  description: "Packed order waited for a rider.",
  evaluate: (order, ctx) => {
    const base = overrun(order, "DISPATCH");
    if (!base) return null;

    const hourDispatchRate = ctx.hourStageDelayRate[order.hour]?.["DISPATCH"] ?? 0;
    const evidence: string[] = [
      `Order waited ${base.actualMinutes} min for dispatch against a ${base.expectedMinutes} min threshold (${base.overrunMinutes} min lost).`,
      `${pct(hourDispatchRate)} of dispatched orders in the ${order.hour}:00 hour overrun DISPATCH specifically.`,
      order.riderId
        ? `Rider ${order.riderId} assigned for a ${order.distanceKm} km drop.`
        : "No rider recorded on the dispatch/delivery events for this order.",
    ];

    // Root causes here are limited to what the dataset can actually support:
    // the dispatch wait itself, rider assignment, per-hour dispatch pressure.
    const dispatchQueue = Math.round(
      hourDispatchRate * (ctx.hourStageOrderCount[order.hour]?.["DISPATCH"] ?? 0),
    );
    let rootCause: string;
    let category: Diagnosis["category"];
    let recommendedAction: string;
    let confidence: number;

    if (!order.riderId) {
      // Rider availability/roster state is not captured in the dataset, so an
      // absent rider on the events is reported as an unexplained hand-off
      // rather than a rider-availability claim.
      rootCause = "Dispatch wait with no rider recorded — rider availability state is not captured";
      category = "OTHER";
      recommendedAction =
        "Capture rider availability/assignment state, then reassign the nearest idle rider";
      confidence = 0.5;
      evidence.push(
        "No rider availability or assignment data exists for this order, so no rider-availability cause is claimed.",
      );
    } else if (hourDispatchRate >= THRESHOLDS.hourDispatchRate) {
      rootCause = `Dispatch queue backlog during the ${order.hour}:00 hour`;
      category = "DISPATCH_QUEUE";
      recommendedAction = `Roster additional riders for ${order.hour}:00–${order.hour + 1}:00 on the ${order.shift.toLowerCase()} shift`;
      confidence = 0.74 + Math.min(0.15, hourDispatchRate * 0.2);
      evidence.push(`${dispatchQueue} orders in this hour were held at dispatch.`);
    } else if (base.overrunMinutes >= THRESHOLDS.dispatch.max) {
      rootCause = `Rider assignment delay — ${order.riderId} was assigned late`;
      category = "RIDER_ASSIGNMENT_DELAY";
      recommendedAction = `Reassign dispatch to the nearest idle rider instead of ${order.riderId}`;
      confidence = 0.66;
    } else {
      rootCause = "Dispatch wait above threshold with no single dominant driver";
      category = "OTHER";
      recommendedAction = "Review the dispatch hand-off between packing and riders";
      confidence = 0.5;
    }

    if (order.distanceKm > 5) {
      evidence.push(`Drop distance ${order.distanceKm} km reduces rider turnaround.`);
    }


    return {
      stage: "DISPATCH",
      ...base,
      rootCause,
      category,
      evidence,
      confidenceScore: clampConfidence(confidence),
      recommendedAction,
    };
  },
};

/** Rule 5 — DELIVERY: checks distance and rider performance on comparable trips. */
const deliveryRule: Rule = {
  id: "R5_DELIVERY_DURATION",
  stage: "DELIVERY",
  label: "Delivery overrun",
  description: "Delivery leg longer than distance-adjusted expectation.",
  evaluate: (order, ctx) => {
    const base = overrun(order, "DELIVERY");
    if (!base) return null;

    const stat = order.riderId ? ctx.employeeStats[order.riderId] : undefined;
    const evidence: string[] = [
      `Delivery took ${base.actualMinutes} min for ${order.distanceKm} km; expected ~${base.expectedMinutes} min (${base.overrunMinutes} min lost).`,
      `Zone ${order.zoneId}, ${order.hour}:00, ${order.shift.toLowerCase()} shift.`,
    ];
    let rootCause: string;
    let category: Diagnosis["category"];
    let recommendedAction: string;
    let confidence: number;

    if (stat?.anomaly) {
      rootCause = `Recurring delay pattern for rider ${stat.employeeId} on comparable trips`;
      category = "RIDER_PERFORMANCE_ANOMALY";
      recommendedAction = `Review route choice with ${stat.employeeId}; rebalance long-distance drops`;
      confidence = 0.68;
      evidence.push(
        `${stat.employeeId} averages ${round(stat.avgTimePerUnit, 2)} min/km vs ${round(stat.peerAvgTimePerUnit, 2)} min/km for riders on comparable distances (${round(stat.peerRatio, 2)}x over ${stat.comparableOrders} comparable trips).`,
      );
    } else if (order.distanceKm >= 5) {
      rootCause = `Long-distance drop (${order.distanceKm} km) beyond the delivery envelope`;
      category = "LONG_DISTANCE";
      recommendedAction = "Batch or re-zone long-distance drops and dispatch them earlier";
      confidence = 0.66;
      evidence.push(`Distance is in the top delivery band for this store.`);
    } else {
      rootCause = "Delivery leg slower than expected for the distance";
      category = "DELIVERY_DELAY";
      recommendedAction = "Review route and traffic pattern for this drop area";
      confidence = 0.55;
    }


    return {
      stage: "DELIVERY",
      ...base,
      rootCause,
      category,
      evidence,
      confidenceScore: clampConfidence(confidence),
      recommendedAction,
    };
  },
};

export const RULES: Rule[] = [
  pickStartRule,
  pickingRule,
  packingRule,
  dispatchRule,
  deliveryRule,
];
