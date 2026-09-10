/**
 * Deterministic tests for the diagnosis context: capacity denominators,
 * stage-specific evidence isolation, recurrence across independent days and the
 * inventory *signal* (never an unsupported causal claim).
 *
 * These run entirely on synthetic in-memory orders, so they cannot drift with
 * the demo dataset.
 */
import { describe, expect, it } from "vitest";

import {
  buildContext,
  eligibleStaffCount,
  loadPerStaff,
  primaryDiagnosis,
} from "../diagnosis/engine";
import { THRESHOLDS, isRecurring, shiftForHour } from "../diagnosis/thresholds";
import type { Employee, OrderRow, StageTimings } from "../diagnosis/types";

const timings = (over: Partial<StageTimings> = {}): StageTimings => ({
  pickStartDelay: 1,
  pickDuration: 4,
  packDuration: 3,
  dispatchWait: 1,
  deliveryDuration: 8,
  totalDuration: 17,
  ...over,
});

let seq = 0;
const order = (over: Partial<OrderRow> = {}): OrderRow => {
  seq += 1;
  const hour = over.hour ?? 15;
  const createdAt = over.createdAt ?? `2026-01-05T${String(hour).padStart(2, "0")}:10:00.000Z`;
  return {
    orderId: `T${seq}`,
    storeId: "S1",
    createdAt,
    promisedAt: createdAt,
    deliveredAt: createdAt,
    status: "DELIVERED",
    totalItems: 10,
    distanceKm: 2,
    zoneId: "Z1",
    stationId: "ST1",
    pickerId: "P1",
    packerId: "K1",
    riderId: "R1",
    hour,
    shift: shiftForHour(hour),
    slaStatus: "ON_TRACK",
    completed: true,
    breachStage: null,
    delayed: false,
    timings: timings(),
    ...over,
  };
};

const picker = (id: string, over: Partial<Employee> = {}): Employee => ({
  employeeId: id,
  name: id,
  role: "PICKER",
  zoneId: "Z1",
  shift: "EVENING",
  active: true,
  joiningDate: "2025-01-01",
  ...over,
});

describe("manpower capacity denominator", () => {
  it("uses available rostered staff, not only employees who received orders", () => {
    const roster = Array.from({ length: 10 }, (_, i) => picker(`P${i + 1}`));
    // 20 orders in the same hour, processed by only 4 of the 10 pickers.
    const orders = Array.from({ length: 20 }, (_, i) =>
      order({ hour: 15, pickerId: `P${(i % 4) + 1}` }),
    );

    const ctx = buildContext(orders, [], [], roster);
    expect(ctx.hourEligiblePickers[15]).toBe(10);
    expect(ctx.hourActiveStaff[15]).toBe(4);
    expect(ctx.hourLoadPerPicker[15]).toBe(2);
  });

  it("counts eligible staff by role, zone and shift", () => {
    const roster = [
      picker("P1"),
      picker("P2"),
      picker("P3", { shift: "MORNING" }),
      picker("P4", { zoneId: "Z2" }),
      picker("P5", { active: false }),
      picker("P6", { role: "PACKER" }),
    ];
    expect(eligibleStaffCount(roster, "PICKER", "Z1", "EVENING")).toBe(2);
    expect(eligibleStaffCount(roster, "PACKER", "Z1", "EVENING")).toBe(1);
    expect(loadPerStaff(20, 10)).toBe(2);
    expect(loadPerStaff(20, 0)).toBe(0);
  });
});

describe("stage-specific evidence isolation", () => {
  it("keeps a heavy DELIVERY delay rate out of the PICK_START diagnosis", () => {
    const roster = Array.from({ length: 40 }, (_, i) => picker(`P${i + 1}`));
    // 30 orders in the same hour/zone: all of them overrun DELIVERY badly,
    // none of them overrun PICK_START…
    const orders = Array.from({ length: 30 }, (_, i) =>
      order({
        hour: 15,
        pickerId: `P${(i % 30) + 1}`,
        timings: timings({ deliveryDuration: 120 }),
        delayed: true,
      }),
    );
    // …except this single order, which is the one under diagnosis.
    const target = order({
      hour: 15,
      pickerId: "P1",
      timings: timings({ pickStartDelay: 25 }),
      delayed: true,
    });
    const ctx = buildContext([...orders, target], [], [], roster);

    expect(ctx.hourStageDelayRate[15]?.["DELIVERY"]).toBeGreaterThan(0.9);
    expect(ctx.hourStageDelayRate[15]?.["PICK_START"]).toBeLessThan(
      THRESHOLDS.hourStageDelayRate,
    );

    const diagnosis = primaryDiagnosis(target, ctx)!;
    expect(diagnosis.stage).toBe("PICK_START");
    // The delivery pattern must not be borrowed as manpower evidence.
    expect(diagnosis.category).not.toBe("MANPOWER");
    expect(diagnosis.evidence.join(" ")).not.toMatch(/DELIVERY/);
  });
});

describe("recurrence needs volume and repetition across days", () => {
  const delayed = (day: number) =>
    order({
      hour: 15,
      createdAt: `2026-01-${String(day).padStart(2, "0")}T15:10:00.000Z`,
      timings: timings({ pickDuration: 60 }),
      delayed: true,
    });

  it("does not call a single bad day a recurring pattern", () => {
    const ctx = buildContext(
      Array.from({ length: 8 }, () => delayed(5)),
      [],
      [],
      [],
    );
    const stat = ctx.recurrence["Z1|PICKING|15"]!;
    expect(stat.affectedOrders).toBe(8);
    expect(stat.distinctDays).toBe(1);
    expect(isRecurring(stat)).toBe(false);
  });

  it("calls it recurring once it repeats across enough independent days", () => {
    const ctx = buildContext(
      [5, 5, 6, 6, 7, 7].map((day) => delayed(day)),
      [],
      [],
      [],
    );
    const stat = ctx.recurrence["Z1|PICKING|15"]!;
    expect(stat.affectedOrders).toBeGreaterThanOrEqual(THRESHOLDS.recurringOccurrences);
    expect(stat.distinctDays).toBe(3);
    expect(isRecurring(stat)).toBe(true);
  });
});

describe("inventory is reported as a signal, not a proven cause", () => {
  it("labels zone stock health as a risk signal with lower confidence", () => {
    const orders = Array.from({ length: 12 }, () =>
      order({ zoneId: "Z1", timings: timings({ pickDuration: 30 }), delayed: true }),
    );
    const ctx = buildContext(
      orders,
      [],
      [
        { zoneId: "Z1", lowStockSkus: 40, totalSkus: 100 },
        { zoneId: "Z2", lowStockSkus: 1, totalSkus: 100 },
      ],
      [],
    );
    // Force the inventory branch by removing the zone-stage signal advantage.
    ctx.zoneStageDelayRate["Z1"] = { PICKING: 0 };
    const diagnosis = primaryDiagnosis(orders[0]!, ctx)!;

    expect(diagnosis.stage).toBe("PICKING");
    expect(diagnosis.category).toBe("INVENTORY_SIGNAL");
    expect(diagnosis.category).not.toBe("INVENTORY");
    expect(diagnosis.rootCause).toMatch(/signal|not a confirmed cause/i);
    expect(diagnosis.evidence.join(" ")).toMatch(/no order-to-SKU relationship/i);
    expect(diagnosis.confidenceScore).toBeLessThan(0.7);
  });

  it("never claims rider availability without rider availability data", () => {
    const target = order({ riderId: null, timings: timings({ dispatchWait: 40 }), delayed: true });
    const ctx = buildContext([target], [], [], []);
    const diagnosis = primaryDiagnosis(target, ctx)!;
    expect(diagnosis.stage).toBe("DISPATCH");
    expect(diagnosis.category).not.toBe("RIDER_AVAILABILITY");
    expect(diagnosis.evidence.join(" ")).toMatch(/no rider availability/i);
  });
});
