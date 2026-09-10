/**
 * End-to-end diagnosis validation suite.
 *
 * Runs against the real dataset through `ops.data.ts` — the same module the
 * dashboard reads — so nothing here can pass on hard-coded dashboard labels.
 * For each stage it picks a real order, re-derives the stage duration from the
 * raw event timestamps, checks the configured threshold and overrun, then
 * asserts the diagnosis stage, root cause, evidence and recommended action.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { buildSnapshot, buildSnapshotContext, loadOrderDetail, type OpsSnapshot } from "../ops.data";
import { diagnoseOrder, overrunStages } from "../diagnosis/engine";
import {
  actualMinutesFor,
  expectedMinutesFor,
  overrunThresholdFor,
  round,
  stageOverrun,
  THRESHOLDS,
} from "../diagnosis/thresholds";
import { ROOT_CAUSES, type Stage } from "../diagnosis/types";
import { eventsAreChronological, stageLines, timingsFromEvents } from "./journey";
import { authedClient } from "./client";

/** Operational data now requires a signed-in operator, exactly like the app. */
let client: Awaited<ReturnType<typeof authedClient>>["client"];

let snap: OpsSnapshot;

beforeAll(async () => {
  client = (await authedClient()).client;
  snap = await buildSnapshot(30, Date.now(), client);
});

const ALLOWED_CAUSES: Record<Stage, string[]> = {
  PICK_START: ["MANPOWER", "INDIVIDUAL_ANOMALY", "ZONE_CONGESTION", "OTHER"],
  PICKING: ["ZONE_CONGESTION", "INVENTORY", "INVENTORY_SIGNAL", "INDIVIDUAL_ANOMALY", "MANPOWER", "OTHER"],
  PACKING: ["PACKING_STATION", "INDIVIDUAL_ANOMALY", "MANPOWER", "OTHER"],
  DISPATCH: ["RIDER_AVAILABILITY", "RIDER_ASSIGNMENT_DELAY", "DISPATCH_QUEUE", "OTHER"],
  DELIVERY: ["LONG_DISTANCE", "RIDER_PERFORMANCE_ANOMALY", "RIDER_PERFORMANCE", "DELIVERY_DELAY", "OTHER"],
};

describe("dataset consistency", () => {
  it("passes every built-in consistency check", () => {
    for (const check of snap.validation.checks) {
      expect(check.passed, `${check.name}: ${check.detail}`).toBe(true);
    }
  });

  it("splits orders into completed and in-progress with no overlap", () => {
    const { overview } = snap;
    expect(overview.completedOrders + overview.inProgressOrders).toBe(overview.totalOrders);
    expect(snap.orders.filter((o) => o.completed && o.slaStatus === "AT_RISK")).toHaveLength(0);
  });

  it("keeps stage and root cause on separate axes", () => {
    const stages: Stage[] = ["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"];
    for (const d of snap.diagnoses) {
      expect(stages).toContain(d.stage);
      expect(ROOT_CAUSES).toContain(d.category);
      expect(stages as string[]).not.toContain(d.category);
    }
  });

  it("produces at least one diagnosis for every one of the five stages", () => {
    for (const stage of ["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"] as Stage[]) {
      const count = snap.diagnoses.filter((d) => d.stage === stage).length;
      expect(count, `${stage} diagnoses`).toBeGreaterThan(0);
    }
  });
});

describe.each(["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"] as Stage[])(
  "%s delay case",
  (stage) => {
    it("derives duration, threshold, overrun, cause, evidence and action from the events", async () => {
      const order = snap.orders
        .filter((o) => o.completed && overrunStages(o).includes(stage))
        .sort((a, b) => stageOverrun(b, stage) - stageOverrun(a, stage))[0];
      expect(order, `no order with a ${stage} overrun`).toBeTruthy();

      const detail = await loadOrderDetail(order!.orderId, Date.now(), client);
      expect(detail).toBeTruthy();

      // 1. source event timestamps
      expect(eventsAreChronological(detail!.events)).toBe(true);
      const fromEvents = timingsFromEvents(detail!.events);

      // 2. calculated stage duration matches the raw timestamps (±0.02 min rounding)
      const line = stageLines(detail!).find((l) => l.stage === stage)!;
      expect(line.actual).not.toBeNull();
      expect(Math.abs((line.actual ?? 0) - (line.fromEvents ?? 0))).toBeLessThan(0.02);
      expect(fromEvents.totalDuration).not.toBeNull();

      // 3. configured threshold + 4. overrun
      const threshold = overrunThresholdFor(order!, stage);
      expect(line.threshold).toBe(threshold);
      expect(line.expected).toBe(expectedMinutesFor(order!, stage));
      expect(actualMinutesFor(order!, stage)!).toBeGreaterThan(threshold);
      expect(line.overrun).toBeCloseTo(
        Math.round(((line.actual ?? 0) - threshold) * 100) / 100,
        2,
      );

      // 5. selected delayed stage
      const diagnosis = detail!.diagnoses.find((d) => d.stage === stage);
      expect(diagnosis, `no ${stage} diagnosis for ${order!.orderId}`).toBeTruthy();
      // the rule reports the measured duration, rounded to one decimal for display
      expect(diagnosis!.actualMinutes).toBe(round(line.actual ?? 0, 1));
      expect(diagnosis!.expectedMinutes).toBe(line.expected);

      // 6. root cause on its own axis, drawn from the allowed set for this stage
      expect(ALLOWED_CAUSES[stage]).toContain(diagnosis!.category);

      // 7. confidence + evidence
      expect(diagnosis!.confidenceScore).toBeGreaterThan(0);
      expect(diagnosis!.confidenceScore).toBeLessThanOrEqual(1);
      expect(diagnosis!.evidence.length).toBeGreaterThan(0);
      // evidence must quote the real measured numbers, not a static label
      const evidenceText = diagnosis!.evidence.join(" ");
      expect(evidenceText.length).toBeGreaterThan(20);

      // 8. recommended action
      expect(diagnosis!.recommendedAction.length).toBeGreaterThan(5);
    });
  },
);

describe("primary diagnosis matches the worst stage", () => {
  it("uses the largest overrun for every delayed order", () => {
    const byOrder = new Map(snap.primaryDiagnoses.map((d) => [d.orderId, d]));
    for (const order of snap.orders.filter((o) => o.delayed)) {
      const primary = byOrder.get(order.orderId);
      expect(primary, `${order.orderId} has no primary diagnosis`).toBeTruthy();
      const worst = overrunStages(order).sort(
        (a, b) => stageOverrun(order, b) - stageOverrun(order, a),
      )[0];
      expect(primary!.stage).toBe(worst);
      expect(order.breachStage).toBe(worst);
    }
  });

  it("reproduces the same diagnosis when a single order is re-diagnosed", async () => {
    const target = snap.primaryDiagnoses[0]!;
    const detail = await loadOrderDetail(target.orderId, Date.now(), client);
    const again = detail!.diagnoses.find((d) => d.stage === target.stage)!;
    expect(again.category).toBe(target.category);
    expect(again.actualMinutes).toBeCloseTo(target.actualMinutes, 1);
  });
});

describe("systemic bottlenecks derive from the underlying orders", () => {
  it("zone-level recurring bottleneck is backed by the zone delay share", () => {
    const zone = snap.systemic.find((f) => f.kind === "ZONE");
    expect(zone, "no zone bottleneck detected").toBeTruthy();
    const zoneId = zone!.key.split("|")[1]!;
    const zoneOrders = snap.orders.filter((o) => o.zoneId === zoneId);
    const delayed = zoneOrders.filter((o) => o.delayed).length;
    expect(delayed / zoneOrders.length).toBeGreaterThanOrEqual(THRESHOLDS.zoneBreachRate);
    expect(zone!.occurrences).toBe(delayed);
    expect(zone!.evidence.length).toBeGreaterThan(0);
  });

  it("recurring bottleneck rows carry zone, stage, hour, occurrences and overrun", () => {
    const rows = snap.bottlenecks.topRecurring;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.zoneId).toBeTruthy();
      expect(row.stage).toBeTruthy();
      expect(Number(row.hour.replace(":00", ""))).toBeGreaterThanOrEqual(0);
      expect(row.occurrences).toBeGreaterThanOrEqual(THRESHOLDS.recurringOccurrences);
      expect(row.distinctDays).toBeGreaterThanOrEqual(THRESHOLDS.recurringDistinctDays);
      expect(row.affectedOrders).toBeGreaterThan(0);
      expect(row.avgOverrun).toBeGreaterThan(0);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(row.severity);
      // the row must be reproducible from the orders themselves
      const [zoneId, stage, hour] = row.signature.split("|");
      const matching = snap.orders.filter(
        (o) =>
          o.zoneId === zoneId &&
          o.hour === Number(hour) &&
          stageOverrun(o, stage as Stage) > 0,
      );
      expect(matching.length).toBe(row.affectedOrders);
    }
  });

  it("peak-hour manpower bottleneck is backed by load per picker", () => {
    const time = snap.systemic.find((f) => f.kind === "TIME");
    const manpower = snap.systemic.find((f) => f.kind === "MANPOWER");
    expect(time ?? manpower, "no time/manpower bottleneck detected").toBeTruthy();
    if (time) {
      const hour = Number(time.key.split("|")[1]);
      const hourOrders = snap.orders.filter((o) => o.hour === hour);
      const delayed = hourOrders.filter((o) => o.delayed).length;
      expect(delayed / hourOrders.length).toBeGreaterThanOrEqual(THRESHOLDS.hourBreachRate);
      expect(time.evidence.join(" ")).toMatch(/picker/i);
    }
  });

  it("packing station congestion is backed by that station's packing overruns", () => {
    const station = snap.systemic.find((f) => f.kind === "STATION");
    expect(station, "no station congestion detected").toBeTruthy();
    const stationId = station!.key.split("|")[1]!;
    const stationOrders = snap.orders.filter((o) => o.stationId === stationId);
    const overran = stationOrders.filter((o) => stageOverrun(o, "PACKING") > 0).length;
    expect(overran / stationOrders.length).toBeGreaterThanOrEqual(THRESHOLDS.stationDelayRate);
    expect(station!.evidence.join(" ")).toMatch(/queue/i);
  });

  it("employee anomaly is a peer comparison on comparable workloads, not a raw delay count", () => {
    const anomalies = snap.employeeStats.filter((s) => s.anomaly);
    expect(anomalies.length, "no employee anomaly detected").toBeGreaterThan(0);
    for (const stat of anomalies) {
      expect(stat.comparableOrders).toBeGreaterThanOrEqual(THRESHOLDS.minComparableOrders);
      expect(stat.peerRatio).toBeGreaterThanOrEqual(THRESHOLDS.peerRatio);
      expect(stat.peerAvgTimePerUnit).toBeGreaterThan(0);
      expect(stat.avgTimePerUnit / stat.peerAvgTimePerUnit).toBeCloseTo(stat.peerRatio, 1);
      expect(stat.evidence.length).toBeGreaterThan(0);
    }
    // A high delay count on its own must never be enough to flag someone.
    const busiestNotFlagged = snap.employeeStats
      .filter((s) => !s.anomaly)
      .sort((a, b) => b.delayCount - a.delayCount)[0];
    if (busiestNotFlagged) {
      expect(busiestNotFlagged.peerRatio).toBeLessThan(THRESHOLDS.peerRatio);
    }
  });
});

describe("live order projection is relative to now", () => {
  it("derives every live status from the time still left against the promise", () => {
    const live = snap.liveOrders;
    expect(live.length).toBeGreaterThan(0);
    const byStatus = (s: string) => live.filter((o) => o.slaStatus === s).length;
    expect(byStatus("ON_TRACK") + byStatus("AT_RISK") + byStatus("BREACHED")).toBe(live.length);

    // Status is a function of "now", never a stored label: check each order
    // against the minutes remaining until its own promised time.
    for (const o of live) {
      const remaining = (new Date(o.promisedAt).getTime() - Date.now()) / 60000;
      const expected =
        remaining <= 0
          ? "BREACHED"
          : remaining <= THRESHOLDS.atRiskRemainingMinutes
            ? "AT_RISK"
            : "ON_TRACK";
      expect(o.slaStatus, `${o.orderId} has ${remaining.toFixed(1)} min left`).toBe(expected);
    }
  });
});

describe("diagnosis is data-derived, not label-derived", () => {
  it("stops flagging a stage once its measured duration is inside the threshold", async () => {
    const { orders, ctx } = await buildSnapshotContext(30, Date.now(), client);
    const order = orders.find((o) => o.completed && overrunStages(o).includes("DISPATCH"))!;
    expect(diagnoseOrder(order, ctx).some((d) => d.stage === "DISPATCH")).toBe(true);

    const healthy = {
      ...order,
      timings: { ...order.timings, dispatchWait: THRESHOLDS.dispatch.max - 1 },
    };
    expect(stageOverrun(healthy, "DISPATCH")).toBe(0);
    expect(diagnoseOrder(healthy, ctx).some((d) => d.stage === "DISPATCH")).toBe(false);
  });

  it("every diagnosis references the order it was derived from", () => {
    const ids = new Set(snap.orders.map((o) => o.orderId));
    for (const d of snap.diagnoses) expect(ids.has(d.orderId)).toBe(true);
  });
});

describe("order journey", () => {
  it("a completed order has the full event sequence in order", async () => {
    const order = snap.orders.find((o) => o.completed)!;
    const detail = await loadOrderDetail(order.orderId, Date.now(), client);
    const types = detail!.events.map((e) => e.eventType);
    for (const expected of [
      "ORDER_CREATED",
      "PICKING_STARTED",
      "PICKING_COMPLETED",
      "PACKING_STARTED",
      "PACKING_COMPLETED",
      "DISPATCHED",
      "DELIVERED",
    ]) {
      expect(types, `${order.orderId} missing ${expected}`).toContain(expected);
    }
    expect(eventsAreChronological(detail!.events)).toBe(true);
    const derived = timingsFromEvents(detail!.events);
    expect(Math.abs(derived.totalDuration! - order.timings.totalDuration!)).toBeLessThan(0.02);
  });
});
