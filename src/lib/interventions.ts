/**
 * Intervention measurement logic — pure functions shared by the server
 * functions, the UI and the validation suite. Nothing in here touches the SLA
 * engine, the diagnosis rules or the bottleneck calculations; it only describes
 * what an operator recorded about an action they took.
 *
 * Two measurement kinds exist, and every stored row states which one it used:
 *
 *   SLA_ADHERENCE_PCT — share of orders inside SLA. Higher is better.
 *                       absolute change = after - before  (percentage points)
 *   STAGE_MINUTES     — minutes spent in the affected stage. Lower is better.
 *                       absolute change = before - after  (minutes saved)
 *
 * The relative change is always expressed against the "before" measurement, so
 * a positive number always means "better", whatever the unit.
 */

export const METRICS = ["SLA_ADHERENCE_PCT", "STAGE_MINUTES"] as const;
export type Metric = (typeof METRICS)[number];

export const OUTCOMES = [
  "PENDING",
  "IMPROVED",
  "NO_CHANGE",
  "WORSENED",
  "RESOLVED",
  "NOT_APPLICABLE",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that represent a measured result rather than an open action. */
export const MEASURED_OUTCOMES: Outcome[] = ["IMPROVED", "NO_CHANGE", "WORSENED", "RESOLVED"];

export const METRIC_LABEL: Record<Metric, string> = {
  SLA_ADHERENCE_PCT: "SLA adherence (%)",
  STAGE_MINUTES: "Stage time (min)",
};

export const METRIC_UNIT: Record<Metric, string> = {
  SLA_ADHERENCE_PCT: "%",
  STAGE_MINUTES: "min",
};

/** Label for the absolute change, so the unit is never ambiguous. */
export const ABSOLUTE_CHANGE_LABEL: Record<Metric, string> = {
  SLA_ADHERENCE_PCT: "Change (percentage points)",
  STAGE_MINUTES: "Change (minutes saved)",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  PENDING: "Pending measurement",
  IMPROVED: "Improved",
  NO_CHANGE: "No change",
  WORSENED: "Worsened",
  RESOLVED: "Resolved",
  NOT_APPLICABLE: "Not applicable",
};

export const isMetric = (value: unknown): value is Metric =>
  typeof value === "string" && (METRICS as readonly string[]).includes(value);

export const isOutcome = (value: unknown): value is Outcome =>
  typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Improvement {
  /** Change in the metric's own unit: percentage points, or minutes saved. */
  absolute: number | null;
  /** Change relative to the "before" measurement, in percent. */
  relativePct: number | null;
}

/**
 * Never invents a result: with either measurement missing both values stay null.
 */
export function computeImprovement(
  metric: Metric,
  before: number | null | undefined,
  after: number | null | undefined,
): Improvement {
  if (before === null || before === undefined || after === null || after === undefined) {
    return { absolute: null, relativePct: null };
  }
  const absolute = metric === "SLA_ADHERENCE_PCT" ? after - before : before - after;
  const relativePct = before === 0 ? null : (absolute / Math.abs(before)) * 100;
  return {
    absolute: round1(absolute),
    relativePct: relativePct === null ? null : round1(relativePct),
  };
}

/**
 * Suggests an outcome from the recorded measurements. The operator's own choice
 * is always what gets stored — this only powers a hint in the UI.
 */
export function classifyOutcome(
  metric: Metric,
  before: number | null | undefined,
  after: number | null | undefined,
  tolerance = 0.5,
): Outcome {
  const { absolute } = computeImprovement(metric, before, after);
  if (absolute === null) return "PENDING";
  if (absolute > tolerance) return "IMPROVED";
  if (absolute < -tolerance) return "WORSENED";
  return "NO_CHANGE";
}

export interface InterventionLike {
  metric: Metric | string;
  outcome: Outcome | string;
  beforeSla: number | null;
  afterSla: number | null;
  improvementAbs: number | null;
  rootCause: string | null;
  stage: string | null;
  zoneId: string | null;
}

export interface InterventionKpis {
  total: number;
  /** Rows whose outcome is a measured result rather than PENDING/NOT_APPLICABLE. */
  withOutcome: number;
  improved: number;
  noChange: number;
  worsened: number;
  resolved: number;
  pending: number;
  notApplicable: number;
  /** Improved (incl. resolved) as a share of rows with a measured outcome. */
  improvementRatePct: number | null;
  /** Mean percentage-point gain across adherence measurements. */
  avgAdherenceGainPoints: number | null;
  /** Mean minutes saved across stage-time measurements. */
  avgMinutesSaved: number | null;
}

/** KPI cards derive only from what is recorded; outcome rates ignore open rows. */
export function interventionKpis(rows: InterventionLike[]): InterventionKpis {
  const count = (o: string) => rows.filter((r) => r.outcome === o).length;
  const measured = rows.filter((r) => MEASURED_OUTCOMES.includes(r.outcome as Outcome));
  const improved = count("IMPROVED");
  const resolved = count("RESOLVED");

  const mean = (values: number[]) =>
    values.length === 0 ? null : round1(values.reduce((a, b) => a + b, 0) / values.length);

  return {
    total: rows.length,
    withOutcome: measured.length,
    improved,
    noChange: count("NO_CHANGE"),
    worsened: count("WORSENED"),
    resolved,
    pending: count("PENDING"),
    notApplicable: count("NOT_APPLICABLE"),
    improvementRatePct:
      measured.length === 0 ? null : round1(((improved + resolved) / measured.length) * 100),
    avgAdherenceGainPoints: mean(
      rows
        .filter((r) => r.metric === "SLA_ADHERENCE_PCT" && r.improvementAbs !== null)
        .map((r) => r.improvementAbs!),
    ),
    avgMinutesSaved: mean(
      rows
        .filter((r) => r.metric === "STAGE_MINUTES" && r.improvementAbs !== null)
        .map((r) => r.improvementAbs!),
    ),
  };
}

export interface OutcomeBreakdownRow {
  key: string;
  total: number;
  improved: number;
  noChange: number;
  worsened: number;
  pending: number;
}

/**
 * Groups recorded outcomes by root cause (manpower, zone congestion, packing
 * station, rider availability, individual pattern…) so an operator can see which
 * recommendations have actually worked so far.
 */
export function outcomeBreakdown(
  rows: InterventionLike[],
  key: (row: InterventionLike) => string | null,
): OutcomeBreakdownRow[] {
  const map = new Map<string, OutcomeBreakdownRow>();
  for (const row of rows) {
    const k = key(row) ?? "UNSPECIFIED";
    const entry =
      map.get(k) ?? { key: k, total: 0, improved: 0, noChange: 0, worsened: 0, pending: 0 };
    entry.total += 1;
    if (row.outcome === "IMPROVED" || row.outcome === "RESOLVED") entry.improved += 1;
    else if (row.outcome === "NO_CHANGE") entry.noChange += 1;
    else if (row.outcome === "WORSENED") entry.worsened += 1;
    else if (row.outcome === "PENDING") entry.pending += 1;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export const humanise = (value: string) =>
  value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
