# Audit & consistency roadmap

## Single source of truth (code)
- [x] thresholds.ts: configurable expectations + overrun helpers
- [x] types.ts: Stage vs RootCause separated, derived fields on OrderRow
- [x] engine.ts: context, workload-matched employee stats, systemic findings
- [x] rules.ts: one rule per stage, dispatch/delivery causes, zone-vs-inventory cause resolved by signal strength
- [x] analytics.ts: completed vs in-progress SLA, stage delay counts, recurring bottlenecks
- [x] ops.functions.ts: event-derived timings, derived SLA status, validation report, interventions

## Database
- [x] sla_thresholds config table + threshold/overrun SQL functions
- [x] order_stage_timings view = single source of truth for stage durations
- [x] order_participants derived from the correct event per role/zone/station
- [x] order_facts rebuilt on those views
- [x] sla_metrics repaired from events
- [x] bottleneck_events rebuilt with stage AND root cause, shift, affected orders
- [x] interventions table, signed-in users only
- [x] live demo orders re-anchored to the current time (drifts over days; re-anchor when demoing)

## Pages (no redesign, no new pages)
- [x] index, live-orders, diagnosis, workforce, bottlenecks, recommendations, historical, order detail read the unified snapshot

## Validation
- [x] totals, completed ON_TRACK+BREACHED, live ON_TRACK+AT_RISK+BREACHED
- [x] diagnosis count by stage; bottleneck count by stage and by root cause
- [x] dispatch/delivery delays present wherever event timestamps exceed thresholds
- [x] threshold parity check between the database config row and the engine constants
- [x] typecheck + build clean, every page rendered and read back

## Diagnosis validation suite (this round)
- [x] src/lib/ops.data.ts — data + calculation layer extracted so tests and pages share one path
- [x] src/lib/validation/journey.ts — stage timings recomputed from raw events, journey renderer
- [x] src/lib/validation/diagnosis.e2e.test.ts — 20 cases, all five stages plus systemic cases
- [x] scripts/diagnosis-report.ts — developer report: validation, stage counts, systemic findings, one full journey
- [x] primaryDiagnosis now picks the worst stage on unrounded overrun (matches breachStage exactly)
- [x] in-progress demo orders carry demo_remaining_minutes intent; refresh_demo_live_orders() re-times them relative to now
- [x] POST /api/public/refresh-demo (shared-secret) re-runs that refresh

## Intervention & improvement workflow (done)
- interventions extended (metric, improvement_abs, shift, hour, notes; outcome/metric constraints; action_at + outcome required); intervention_revisions audit table with update trigger; authenticated-only access.
- src/lib/interventions.ts — shared improvement/outcome/KPI logic (adherence = after-before pp; stage time = before-after min saved; null in → null out).
- Recommendations page records interventions only on explicit operator submit, linked to recommendation signature + evidence.
- /interventions — history table, filters (date/stage/cause/zone/outcome), KPI cards, before/after chart, cause outcome breakdown, recurring-bottleneck impact, after-measurement update.
- 33 tests pass (20 original diagnosis + intervention suite). No demo intervention rows inserted.

## Backend/data correction pass (completed)
- Auth required for snapshot/order-detail/diagnosis persistence; anon SELECT revoked on all operational tables/views; dashboard moved under the `_authenticated` gate with a new `/auth` sign-in page and sign-out.
- `order_events` raw source → `order_stage_timings` single timing source; `order_event_first`/`order_event_validation` detect missing, duplicate and out-of-order events; no negative durations.
- Stage-specific `zoneStageDelayRate`/`hourStageDelayRate`; cross-stage evidence contamination removed.
- Manpower capacity uses rostered active staff by role/zone/shift.
- Inventory reported as INVENTORY_SIGNAL; rider availability never claimed without rider state.
- Recurrence needs ≥5 affected orders AND ≥3 distinct days (centralised in thresholds).
- Interventions: baseline (`before_sla`) and `metric` immutable after creation, measurement range constraints, revision history preserved.
- `loadFacts` paginates until exhaustion with deterministic ordering (no 6,000-row truncation).
- Validation suite: 80 tests passing (security, events, context, interventions incl. auth, history pagination, original 20 diagnosis tests).

## Agent integrations (MCP)

- MCP server at `/mcp`, defined in `src/lib/mcp/index.ts` with 7 tools under `src/lib/mcp/tools/`.
- Auth: Supabase OAuth 2.1 (resource server). Consent screen at `src/routes/[.]lovable.oauth.consent.tsx`; `/auth` preserves a `next` target.
- Tools query as the signed-in operator via `src/lib/mcp/supabase.ts`; RLS applies. Anonymous calls get 401.
- `record_intervention` records an action only; it never sets an after-measurement or outcome.
- Generated routes (`src/routes/mcp.ts`, `[.well-known]`) are plugin-owned; do not hand-edit.
