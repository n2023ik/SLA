-- ---------------------------------------------------------------
-- 1. Canonical event pivot: one row per order, first timestamp and
--    occurrence count per canonical event type.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.order_event_first
WITH (security_invoker = true) AS
SELECT
  order_id,
  min(timestamp) FILTER (WHERE event_type = 'ORDER_CREATED')      AS t_created,
  min(timestamp) FILTER (WHERE event_type = 'PICKING_STARTED')    AS t_pick_start,
  min(timestamp) FILTER (WHERE event_type = 'PICKING_COMPLETED')  AS t_pick_end,
  min(timestamp) FILTER (WHERE event_type = 'PACKING_STARTED')    AS t_pack_start,
  min(timestamp) FILTER (WHERE event_type = 'PACKING_COMPLETED')  AS t_pack_end,
  min(timestamp) FILTER (WHERE event_type = 'DISPATCHED')         AS t_dispatch,
  min(timestamp) FILTER (WHERE event_type = 'DELIVERED')          AS t_delivered,
  count(*) FILTER (WHERE event_type = 'ORDER_CREATED')::int       AS n_created,
  count(*) FILTER (WHERE event_type = 'PICKING_STARTED')::int     AS n_pick_start,
  count(*) FILTER (WHERE event_type = 'PICKING_COMPLETED')::int   AS n_pick_end,
  count(*) FILTER (WHERE event_type = 'PACKING_STARTED')::int     AS n_pack_start,
  count(*) FILTER (WHERE event_type = 'PACKING_COMPLETED')::int   AS n_pack_end,
  count(*) FILTER (WHERE event_type = 'DISPATCHED')::int          AS n_dispatch,
  count(*) FILTER (WHERE event_type = 'DELIVERED')::int           AS n_delivered
FROM public.order_events
GROUP BY order_id;

-- ---------------------------------------------------------------
-- 2. Event quality: missing / duplicate / out-of-sequence events.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.order_event_validation
WITH (security_invoker = true) AS
SELECT
  f.order_id,
  array_remove(ARRAY[
    CASE WHEN f.t_created    IS NULL THEN 'ORDER_CREATED' END,
    CASE WHEN f.t_pick_start IS NULL THEN 'PICKING_STARTED' END,
    CASE WHEN f.t_pick_end   IS NULL THEN 'PICKING_COMPLETED' END,
    CASE WHEN f.t_pack_start IS NULL THEN 'PACKING_STARTED' END,
    CASE WHEN f.t_pack_end   IS NULL THEN 'PACKING_COMPLETED' END,
    CASE WHEN f.t_dispatch   IS NULL THEN 'DISPATCHED' END,
    CASE WHEN f.t_delivered  IS NULL THEN 'DELIVERED' END
  ], NULL) AS missing_events,
  (CASE WHEN f.n_created    > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_pick_start > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_pick_end   > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_pack_start > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_pack_end   > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_dispatch   > 1 THEN 1 ELSE 0 END
   + CASE WHEN f.n_delivered  > 1 THEN 1 ELSE 0 END) AS duplicate_event_types,
  (coalesce(f.t_pick_start  < f.t_created,   false)
   OR coalesce(f.t_pick_end   < f.t_pick_start, false)
   OR coalesce(f.t_pack_start < f.t_pick_end,   false)
   OR coalesce(f.t_pack_end   < f.t_pack_start, false)
   OR coalesce(f.t_dispatch   < f.t_pack_end,   false)
   OR coalesce(f.t_delivered  < f.t_dispatch,   false)) AS out_of_sequence
FROM public.order_event_first f;

-- ---------------------------------------------------------------
-- 3. Single source of truth for stage durations. A stage duration is
--    produced only when its two events exist AND are in order, so a
--    negative duration can never be emitted.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.order_stage_timings
WITH (security_invoker = true) AS
SELECT
  f.order_id,
  f.t_created,
  f.t_pick_start,
  f.t_pick_end,
  f.t_pack_start,
  f.t_pack_end,
  f.t_dispatch,
  f.t_delivered,
  CASE WHEN f.t_pick_start >= f.t_created
       THEN round(EXTRACT(epoch FROM f.t_pick_start - f.t_created) / 60::numeric, 2) END AS pick_start_delay,
  CASE WHEN f.t_pick_end >= f.t_pick_start
       THEN round(EXTRACT(epoch FROM f.t_pick_end - f.t_pick_start) / 60::numeric, 2) END AS pick_duration,
  CASE WHEN f.t_pack_end >= f.t_pack_start
       THEN round(EXTRACT(epoch FROM f.t_pack_end - f.t_pack_start) / 60::numeric, 2) END AS pack_duration,
  CASE WHEN f.t_dispatch >= f.t_pack_end
       THEN round(EXTRACT(epoch FROM f.t_dispatch - f.t_pack_end) / 60::numeric, 2) END AS dispatch_wait,
  CASE WHEN f.t_delivered >= f.t_dispatch
       THEN round(EXTRACT(epoch FROM f.t_delivered - f.t_dispatch) / 60::numeric, 2) END AS delivery_duration,
  CASE WHEN f.t_delivered >= f.t_created
       THEN round(EXTRACT(epoch FROM f.t_delivered - f.t_created) / 60::numeric, 2) END AS total_duration
FROM public.order_event_first f;

ALTER VIEW public.order_participants     SET (security_invoker = true);
ALTER VIEW public.order_facts            SET (security_invoker = true);
ALTER VIEW public.order_stage_overruns   SET (security_invoker = true);
ALTER VIEW public.zone_inventory_health  SET (security_invoker = true);

-- ---------------------------------------------------------------
-- 4. Operational data requires an authenticated operator.
-- ---------------------------------------------------------------
REVOKE SELECT ON public.orders, public.order_events, public.zones, public.workforce,
  public.workforce_metrics, public.packing_stations, public.inventory, public.sla_metrics,
  public.sla_thresholds, public.bottleneck_events, public.diagnoses FROM anon;

DROP POLICY IF EXISTS "orders readable" ON public.orders;
DROP POLICY IF EXISTS "order events readable" ON public.order_events;
DROP POLICY IF EXISTS "zones readable" ON public.zones;
DROP POLICY IF EXISTS "workforce readable" ON public.workforce;
DROP POLICY IF EXISTS "workforce metrics readable" ON public.workforce_metrics;
DROP POLICY IF EXISTS "stations readable" ON public.packing_stations;
DROP POLICY IF EXISTS "inventory readable" ON public.inventory;
DROP POLICY IF EXISTS "sla metrics readable" ON public.sla_metrics;
DROP POLICY IF EXISTS "sla thresholds readable" ON public.sla_thresholds;
DROP POLICY IF EXISTS "bottleneck events readable" ON public.bottleneck_events;
DROP POLICY IF EXISTS "diagnoses readable" ON public.diagnoses;

CREATE POLICY "orders readable by authenticated" ON public.orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "order events readable by authenticated" ON public.order_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "zones readable by authenticated" ON public.zones
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "workforce readable by authenticated" ON public.workforce
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "workforce metrics readable by authenticated" ON public.workforce_metrics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "stations readable by authenticated" ON public.packing_stations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory readable by authenticated" ON public.inventory
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla metrics readable by authenticated" ON public.sla_metrics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla thresholds readable by authenticated" ON public.sla_thresholds
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "bottleneck events readable by authenticated" ON public.bottleneck_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "diagnoses readable by authenticated" ON public.diagnoses
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.orders, public.order_events, public.zones, public.workforce,
  public.workforce_metrics, public.packing_stations, public.inventory, public.sla_metrics,
  public.sla_thresholds, public.bottleneck_events, public.diagnoses TO authenticated;

REVOKE ALL ON public.order_facts, public.order_participants, public.order_stage_timings,
  public.order_stage_overruns, public.zone_inventory_health, public.order_event_first,
  public.order_event_validation FROM anon;
GRANT SELECT ON public.order_facts, public.order_participants, public.order_stage_timings,
  public.order_stage_overruns, public.zone_inventory_health, public.order_event_first,
  public.order_event_validation TO authenticated;
GRANT SELECT ON public.order_facts, public.order_participants, public.order_stage_timings,
  public.order_stage_overruns, public.zone_inventory_health, public.order_event_first,
  public.order_event_validation TO service_role;

-- ---------------------------------------------------------------
-- 5. Intervention measurement integrity.
-- ---------------------------------------------------------------
ALTER TABLE public.interventions DROP CONSTRAINT IF EXISTS interventions_measurement_range;
ALTER TABLE public.interventions ADD CONSTRAINT interventions_measurement_range CHECK (
  (metric <> 'SLA_ADHERENCE_PCT' OR (
      (before_sla IS NULL OR (before_sla >= 0 AND before_sla <= 100)) AND
      (after_sla  IS NULL OR (after_sla  >= 0 AND after_sla  <= 100))))
  AND
  (metric <> 'STAGE_MINUTES' OR (
      (before_sla IS NULL OR before_sla >= 0) AND
      (after_sla  IS NULL OR after_sla  >= 0)))
);

CREATE OR REPLACE FUNCTION public.enforce_intervention_baseline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.before_sla IS DISTINCT FROM OLD.before_sla THEN
    RAISE EXCEPTION 'before_sla is immutable once the intervention has been recorded';
  END IF;
  IF NEW.metric IS DISTINCT FROM OLD.metric THEN
    RAISE EXCEPTION 'metric is immutable once the intervention has been recorded';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS interventions_baseline_immutable ON public.interventions;
CREATE TRIGGER interventions_baseline_immutable
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_intervention_baseline();