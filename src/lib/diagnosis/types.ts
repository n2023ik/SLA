/**
 * Shared domain types for the SLA diagnosis engine.
 * Pure types only — safe to import on both server and client.
 */

/** Stage of the fulfilment pipeline where the delay occurred. */
export type Stage = "PICK_START" | "PICKING" | "PACKING" | "DISPATCH" | "DELIVERY";

export type SlaStatus = "ON_TRACK" | "AT_RISK" | "BREACHED";

export type Role = "PICKER" | "PACKER" | "RIDER";

export type Shift = "MORNING" | "EVENING" | "NIGHT";

/**
 * Why the delay happened. Deliberately disjoint from Stage — a diagnosis
 * always carries one stage AND one root-cause category, never one instead of
 * the other.
 */
export type RootCause =
  | "MANPOWER"
  | "INDIVIDUAL_ANOMALY"
  | "ZONE_CONGESTION"
  | "INVENTORY"
  | "INVENTORY_SIGNAL"
  | "PACKING_STATION"
  | "RIDER_AVAILABILITY"
  | "RIDER_ASSIGNMENT_DELAY"
  | "DISPATCH_QUEUE"
  | "LONG_DISTANCE"
  | "RIDER_PERFORMANCE_ANOMALY"
  | "DELIVERY_DELAY"
  | "OTHER";

export const ROOT_CAUSES: RootCause[] = [
  "MANPOWER",
  "INDIVIDUAL_ANOMALY",
  "ZONE_CONGESTION",
  "INVENTORY",
  "INVENTORY_SIGNAL",
  "PACKING_STATION",
  "RIDER_AVAILABILITY",
  "RIDER_ASSIGNMENT_DELAY",
  "DISPATCH_QUEUE",
  "LONG_DISTANCE",
  "RIDER_PERFORMANCE_ANOMALY",
  "DELIVERY_DELAY",
  "OTHER",
];

export const ROOT_CAUSE_LABELS: Record<RootCause, string> = {
  MANPOWER: "Manpower",
  INDIVIDUAL_ANOMALY: "Individual anomaly",
  ZONE_CONGESTION: "Zone congestion",
  INVENTORY: "Inventory",
  INVENTORY_SIGNAL: "Inventory risk signal",
  PACKING_STATION: "Packing station",
  RIDER_AVAILABILITY: "Rider availability",
  RIDER_ASSIGNMENT_DELAY: "Rider assignment delay",
  DISPATCH_QUEUE: "Dispatch queue",
  LONG_DISTANCE: "Long distance",
  RIDER_PERFORMANCE_ANOMALY: "Rider performance anomaly",
  DELIVERY_DELAY: "Delivery delay",
  OTHER: "Other",
};

export interface StageTimings {
  pickStartDelay: number | null;
  pickDuration: number | null;
  packDuration: number | null;
  dispatchWait: number | null;
  deliveryDuration: number | null;
  totalDuration: number | null;
}

export interface OrderRow {
  orderId: string;
  storeId: string;
  createdAt: string;
  promisedAt: string;
  deliveredAt: string | null;
  status: string;
  totalItems: number;
  distanceKm: number;
  zoneId: string;
  stationId: string | null;
  pickerId: string | null;
  packerId: string | null;
  riderId: string | null;
  hour: number;
  shift: Shift;
  /** Derived, never read straight from the seed column. */
  slaStatus: SlaStatus;
  /** True once the order is finished (delivered_at present). */
  completed: boolean;
  /** Stage with the largest overrun; null when every stage was within threshold. */
  breachStage: Stage | null;
  /** True when at least one stage exceeded its overrun threshold. */
  delayed: boolean;
  timings: StageTimings;
}

export interface Employee {
  employeeId: string;
  name: string;
  role: Role;
  zoneId: string;
  shift: Shift;
  active: boolean;
  joiningDate: string;
}

export interface Zone {
  zoneId: string;
  zoneName: string;
  storeId: string;
}

export interface PackingStation {
  stationId: string;
  storeId: string;
  status: string;
  currentQueueLength: number;
}

export interface InventorySignal {
  zoneId: string;
  lowStockSkus: number;
  totalSkus: number;
}

export interface Diagnosis {
  orderId: string;
  /** Where it went wrong. */
  stage: Stage;
  actualMinutes: number;
  expectedMinutes: number;
  overrunMinutes: number;
  rootCause: string;
  /** Why it went wrong — a separate axis from stage. */
  category: RootCause;
  evidence: string[];
  confidenceScore: number;
  recommendedAction: string;
  /** Zone/stage/hour signature this order belongs to. */
  signature: string;
  recurring: boolean;
  zoneId: string;
  hour: number;
  shift: Shift;
  stationId: string | null;
  employeeId: string | null;
}

export interface EmployeeStat {
  employeeId: string;
  role: Role;
  zoneId: string;
  shift: Shift;
  ordersHandled: number;
  /** Orders that sat in a workload bucket with enough peer activity to compare. */
  comparableOrders: number;
  avgStageTime: number;
  medianStageTime: number;
  /** Average items handled per order (riders: km per trip). */
  workloadPerOrder: number;
  /** Time per unit of work — normalises for workload differences. */
  avgTimePerUnit: number;
  /** Same metric for comparable peers, excluding this employee. */
  peerAvgTimePerUnit: number;
  /** 1.0 = exactly on par with comparable peers. */
  peerRatio: number;
  delayCount: number;
  breachCount: number;
  anomaly: boolean;
  /** Human-readable justification for the anomaly flag (or lack of one). */
  evidence: string[];
  productivityScore: number;
}

/** Delay share of a zone/hour for one specific stage. */
export type StageRate = Partial<Record<Stage, number>>;

/**
 * A pattern only counts as recurring when it affects enough orders AND repeats
 * across independent calendar days.
 */
export interface RecurrenceStat {
  /** Delayed orders carrying this signature. */
  affectedOrders: number;
  /** Distinct calendar days (UTC) the signature appeared on. */
  distinctDays: number;
}

export interface DiagnosisContext {
  /**
   * Share of orders with ANY stage overrun per zone. Zone-level summary only —
   * never valid as evidence for one specific stage (use zoneStageDelayRate).
   */
  zoneBreachRate: Record<string, number>;
  zoneOrderCount: Record<string, number>;
  /** Share of orders with ANY stage overrun per created hour. Summary only. */
  hourBreachRate: Record<number, number>;
  hourOrderCount: Record<number, number>;
  /** Stage-specific delay share per zone — the only zone evidence a rule may use. */
  zoneStageDelayRate: Record<string, StageRate>;
  /** Stage-specific delay share per created hour. */
  hourStageDelayRate: Record<number, StageRate>;
  /** Orders per zone that recorded a duration for a given stage. */
  zoneStageOrderCount: Record<string, StageRate>;
  hourStageOrderCount: Record<number, StageRate>;
  stationQueue: Record<string, number>;
  stationDelayRate: Record<string, number>;
  stationOrderCount: Record<string, number>;
  inventory: Record<string, InventorySignal>;
  employeeStats: Record<string, EmployeeStat>;
  /** Distinct pickers that actually processed orders in the hour (observed). */
  hourActiveStaff: Record<number, number>;
  /** Active rostered pickers eligible for the hour's shift (capacity denominator). */
  hourEligiblePickers: Record<number, number>;
  /** Active rostered staff per `ROLE|zone|shift`. */
  eligibleStaff: Record<string, number>;
  /** Orders per eligible picker for the hour. */
  hourLoadPerPicker: Record<number, number>;
  overallLoadPerPicker: number;
  /** Recurrence evidence per zone+stage+hour signature. */
  recurrence: Record<string, RecurrenceStat>;
  totalOrders: number;
}
