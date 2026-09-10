/**
 * Records an intervention. Nothing is written until an operator submits this
 * form: the system never creates an intervention on its own, and the before /
 * after measurements are only what the operator typed in.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { recordIntervention } from "@/lib/ops.functions";
import {
  ABSOLUTE_CHANGE_LABEL,
  METRICS,
  METRIC_LABEL,
  METRIC_UNIT,
  OUTCOMES,
  OUTCOME_LABEL,
  classifyOutcome,
  computeImprovement,
  type Metric,
  type Outcome,
} from "@/lib/interventions";

export interface RecommendationOption {
  label: string;
  signature?: string | null;
  stage?: string | null;
  zoneId?: string | null;
  shift?: string | null;
  hour?: number | null;
  rootCause?: string | null;
  evidence?: string[];
}

const field =
  "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground";
const label = "flex flex-col gap-1 text-xs text-muted-foreground";

export function InterventionForm({ options }: { options: RecommendationOption[] }) {
  const save = useServerFn(recordIntervention);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({
    actionTaken: "",
    orderId: "",
    zoneId: "",
    stage: "",
    shift: "",
    hour: "",
    rootCause: "",
    metric: "SLA_ADHERENCE_PCT" as Metric,
    beforeSla: "",
    afterSla: "",
    outcome: "PENDING" as Outcome,
    notes: "",
  });

  const option = options.find((o) => o.label === selected);
  const before = form.beforeSla === "" ? null : Number(form.beforeSla);
  const after = form.afterSla === "" ? null : Number(form.afterSla);
  const improvement = useMemo(
    () => computeImprovement(form.metric, before, after),
    [form.metric, before, after],
  );
  const suggested = classifyOutcome(form.metric, before, after);

  const pick = (labelValue: string) => {
    setSelected(labelValue);
    const next = options.find((o) => o.label === labelValue);
    if (!next) return;
    setForm((f) => ({
      ...f,
      zoneId: next.zoneId ?? "",
      stage: next.stage ?? "",
      shift: next.shift ?? "",
      hour: next.hour === null || next.hour === undefined ? "" : String(next.hour),
      rootCause: next.rootCause ?? "",
    }));
  };

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          recommendation: selected,
          signature: option?.signature ?? null,
          actionTaken: form.actionTaken,
          orderId: form.orderId || null,
          zoneId: form.zoneId || null,
          stage: form.stage || null,
          shift: form.shift || null,
          hour: form.hour === "" ? null : Number(form.hour),
          rootCause: form.rootCause || null,
          metric: form.metric,
          beforeSla: before,
          afterSla: after,
          outcome: form.outcome,
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      toast.success("Intervention recorded");
      setForm((f) => ({ ...f, actionTaken: "", beforeSla: "", afterSla: "", notes: "" }));
      void queryClient.invalidateQueries({ queryKey: ["interventions"] });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Sign in is required to record an intervention",
      ),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected) {
          toast.error("Pick the recommendation this action came from");
          return;
        }
        if (!form.actionTaken.trim()) {
          toast.error("Describe the action that was taken");
          return;
        }
        mutation.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className={`${label} md:col-span-2`}>
          Recommendation (required)
          <select value={selected} onChange={(e) => pick(e.target.value)} className={field}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} md:col-span-2`}>
          Action taken (required)
          <input
            value={form.actionTaken}
            onChange={(e) => setForm((f) => ({ ...f, actionTaken: e.target.value }))}
            placeholder="e.g. Moved two pickers into Z3 for the 19:00 peak"
            className={field}
          />
        </label>

        <label className={label}>
          Stage
          <select
            value={form.stage}
            onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}
            className={field}
          >
            <option value="">—</option>
            {["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Root cause
          <select
            value={form.rootCause}
            onChange={(e) => setForm((f) => ({ ...f, rootCause: e.target.value }))}
            className={field}
          >
            <option value="">—</option>
            {[
              "MANPOWER",
              "INDIVIDUAL_ANOMALY",
              "ZONE_CONGESTION",
              "INVENTORY",
              "PACKING_STATION",
              "RIDER_AVAILABILITY",
              "OTHER",
            ].map((c) => (
              <option key={c} value={c}>
                {c === "INDIVIDUAL_ANOMALY" ? "Performance pattern (investigation)" : c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Zone
          <input
            value={form.zoneId}
            onChange={(e) => setForm((f) => ({ ...f, zoneId: e.target.value }))}
            className={field}
          />
        </label>
        <label className={label}>
          Order (optional)
          <input
            value={form.orderId}
            onChange={(e) => setForm((f) => ({ ...f, orderId: e.target.value }))}
            placeholder="QC-00123"
            className={field}
          />
        </label>
        <label className={label}>
          Shift
          <select
            value={form.shift}
            onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))}
            className={field}
          >
            <option value="">—</option>
            {["MORNING", "AFTERNOON", "EVENING"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Hour of day
          <input
            type="number"
            min={0}
            max={23}
            value={form.hour}
            onChange={(e) => setForm((f) => ({ ...f, hour: e.target.value }))}
            className={field}
          />
        </label>
        <label className={label}>
          Measurement used
          <select
            value={form.metric}
            onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value as Metric }))}
            className={field}
          >
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Outcome (required)
          <select
            value={form.outcome}
            onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value as Outcome }))}
            className={field}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Before — {METRIC_LABEL[form.metric]}
          <input
            type="number"
            step="0.1"
            value={form.beforeSla}
            onChange={(e) => setForm((f) => ({ ...f, beforeSla: e.target.value }))}
            className={field}
          />
        </label>
        <label className={label}>
          After — {METRIC_LABEL[form.metric]}
          <input
            type="number"
            step="0.1"
            value={form.afterSla}
            onChange={(e) => setForm((f) => ({ ...f, afterSla: e.target.value }))}
            className={field}
          />
        </label>
        <label className={`${label} md:col-span-2`}>
          Notes (optional)
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className={field}
          />
        </label>
      </div>

      {option?.evidence?.length ? (
        <div className="rounded-md border border-border bg-surface p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Supporting evidence for this recommendation</p>
          <ul className="mt-1 space-y-0.5">
            {option.evidence.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-xs">
        <p className="text-muted-foreground">
          {improvement.absolute === null ? (
            <>
              No improvement is shown until both the before and after measurements are recorded.
            </>
          ) : (
            <>
              <span className="text-foreground">{ABSOLUTE_CHANGE_LABEL[form.metric]}:</span>{" "}
              <span className="num text-foreground">
                {improvement.absolute > 0 ? "+" : ""}
                {improvement.absolute}
                {form.metric === "SLA_ADHERENCE_PCT" ? " pp" : ` ${METRIC_UNIT[form.metric]}`}
              </span>
              {improvement.relativePct !== null ? (
                <>
                  {" · relative change "}
                  <span className="num text-foreground">
                    {improvement.relativePct > 0 ? "+" : ""}
                    {improvement.relativePct}%
                  </span>
                </>
              ) : null}
              {" · suggested outcome "}
              <span className="text-foreground">{OUTCOME_LABEL[suggested]}</span> (your choice is
              what gets stored)
            </>
          )}
        </p>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/25 disabled:opacity-60"
        >
          {mutation.isPending ? "Recording…" : "Record intervention"}
        </button>
      </div>
    </form>
  );
}
