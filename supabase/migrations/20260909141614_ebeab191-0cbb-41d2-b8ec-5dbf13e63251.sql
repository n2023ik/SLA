-- 1. One configurable source of truth for every threshold.
CREATE TABLE IF NOT EXISTS public.sla_thresholds (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pick_start_max numeric NOT NULL DEFAULT 5,
  picking_base numeric NOT NULL DEFAULT 2.5,
  picking_per_item numeric NOT NULL DEFAULT 0.25,
  picking_tolerance numeric NOT NULL DEFAULT 1.25,
  packing_base numeric NOT NULL DEFAULT 2.5,
  packing_per_item numeric NOT NULL DEFAULT 0.12,
  packing_tolerance numeric NOT NULL DEFAULT 1.3,
  dispatch_max numeric NOT NULL DEFAULT 5,
  delivery_base numeric NOT NULL DEFAULT 4,
  delivery_per_km numeric NOT NULL DEFAULT 1.8,
  delivery_tolerance numeric NOT NULL DEFAULT 1.3,
  total_sla_minutes numeric NOT NULL DEFAULT 30,
  at_risk_remaining_minutes numeric NOT NULL DEFAULT 6,
  zone_breach_rate numeric NOT NULL DEFAULT 0.45,
  hour_breach_rate numeric NOT NULL DEFAULT 0.5,
  station_queue numeric NOT NULL DEFAULT 6,
  low_stock_share numeric NOT NULL DEFAULT 0.15,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sla_thresholds (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.sla_thresholds TO anon, authenticated;
GRANT ALL ON public.sla_thresholds TO service_role;
ALTER TABLE public.sla_thresholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sla thresholds readable" ON public.sla_thresholds;
CREATE POLICY "sla thresholds readable" ON public.sla_thresholds
  FOR SELECT TO anon, authenticated USING (true);

-- 2. Threshold helpers — the only place the formulas live.
CREATE OR REPLACE FUNCTION public.stage_expected(_stage text, _total_items integer, _distance_km numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'PICK_START' THEN c.pick_start_max
    WHEN 'PICKING' THEN c.picking_base + _total_items * c.picking_per_item
    WHEN 'PACKING' THEN c.packing_base + _total_items * c.packing_per_item
    WHEN 'DISPATCH' THEN c.dispatch_max
    WHEN 'DELIVERY' THEN c.delivery_base + _distance_km * c.delivery_per_km
  END
  FROM public.sla_thresholds c WHERE c.id;
$$;

CREATE OR REPLACE FUNCTION public.stage_threshold(_stage text, _total_items integer, _distance_km numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'PICK_START' THEN c.pick_start_max
    WHEN 'PICKING' THEN (c.picking_base + _total_items * c.picking_per_item) * c.picking_tolerance
    WHEN 'PACKING' THEN (c.packing_base + _total_items * c.packing_per_item) * c.packing_tolerance
    WHEN 'DISPATCH' THEN c.dispatch_max
    WHEN 'DELIVERY' THEN (c.delivery_base + _distance_km * c.delivery_per_km) * c.delivery_tolerance
  END
  FROM public.sla_thresholds c WHERE c.id;
$$;

CREATE OR REPLACE FUNCTION public.stage_overrun(_stage text, _actual numeric, _total_items integer, _distance_km numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT greatest(0, round(coalesce(_actual, 0) - public.stage_threshold(_stage, _total_items, _distance_km), 2));
$$;

GRANT EXECUTE ON FUNCTION public.stage_expected(text, integer, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_threshold(text, integer, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stage_overrun(text, numeric, integer, numeric) TO anon, authenticated, service_role;

-- 3. Stage timings: the single source of truth for durations.
CREATE OR REPLACE VIEW public.order_stage_timings AS
WITH ev AS (
  SELECT order_id,
    min(CASE WHEN event_type = 'ORDER_CREATED' THEN timestamp END) AS t_created,
    min(CASE WHEN event_type = 'PICKING_STARTED' THEN timestamp END) AS t_pick_start,
    min(CASE WHEN event_type = 'PICKING_COMPLETED' THEN timestamp END) AS t_pick_end,
    min(CASE WHEN event_type = 'PACKING_STARTED' THEN timestamp END) AS t_pack_start,
    min(CASE WHEN event_type = 'PACKING_COMPLETED' THEN timestamp END) AS t_pack_end,
    min(CASE WHEN event_type = 'DISPATCHED' THEN timestamp END) AS t_dispatch,
    min(CASE WHEN event_type = 'DELIVERED' THEN timestamp END) AS t_delivered
  FROM public.order_events
  GROUP BY order_id
)
SELECT order_id,
  t_created, t_pick_start, t_pick_end, t_pack_start, t_pack_end, t_dispatch, t_delivered,
  round((extract(epoch FROM (t_pick_start - t_created)) / 60)::numeric, 2) AS pick_start_delay,
  round((extract(epoch FROM (t_pick_end - t_pick_start)) / 60)::numeric, 2) AS pick_duration,
  round((extract(epoch FROM (t_pack_end - t_pack_start)) / 60)::numeric, 2) AS pack_duration,
  round((extract(epoch FROM (t_dispatch - t_pack_end)) / 60)::numeric, 2) AS dispatch_wait,
  round((extract(epoch FROM (t_delivered - t_dispatch)) / 60)::numeric, 2) AS delivery_duration,
  round((extract(epoch FROM (t_delivered - t_created)) / 60)::numeric, 2) AS total_duration
FROM ev;

GRANT SELECT ON public.order_stage_timings TO anon, authenticated, service_role;

-- 4. Operational ownership from the correct event, deterministically the earliest one.
CREATE OR REPLACE VIEW public.order_participants AS
WITH ranked AS (
  SELECT order_id, event_type, employee_id, employee_role, zone_id, station_id,
    row_number() OVER (PARTITION BY order_id, event_type ORDER BY timestamp, id) AS rn
  FROM public.order_events
),
first_ev AS (
  SELECT * FROM ranked WHERE rn = 1
)
SELECT o.order_id,
  (SELECT coalesce(pick_s.employee_id, pick_c.employee_id)) AS picker_id,
  (SELECT coalesce(pack_s.employee_id, pack_c.employee_id)) AS packer_id,
  (SELECT coalesce(disp.employee_id, deliv.employee_id)) AS rider_id,
  (SELECT coalesce(pick_s.zone_id, pick_c.zone_id, disp.zone_id)) AS zone_id,
  (SELECT coalesce(pack_s.station_id, pack_c.station_id)) AS station_id
FROM public.orders o
LEFT JOIN first_ev pick_s ON pick_s.order_id = o.order_id AND pick_s.event_type = 'PICKING_STARTED'
LEFT JOIN first_ev pick_c ON pick_c.order_id = o.order_id AND pick_c.event_type = 'PICKING_COMPLETED'
LEFT JOIN first_ev pack_s ON pack_s.order_id = o.order_id AND pack_s.event_type = 'PACKING_STARTED'
LEFT JOIN first_ev pack_c ON pack_c.order_id = o.order_id AND pack_c.event_type = 'PACKING_COMPLETED'
LEFT JOIN first_ev disp ON disp.order_id = o.order_id AND disp.event_type = 'DISPATCHED'
LEFT JOIN first_ev deliv ON deliv.order_id = o.order_id AND deliv.event_type = 'DELIVERED';

GRANT SELECT ON public.order_participants TO anon, authenticated, service_role;

-- 5. Order facts rebuilt on the two views above.
DROP VIEW IF EXISTS public.order_facts;
CREATE VIEW public.order_facts AS
SELECT o.order_id,
  o.store_id,
  o.created_at,
  o.promised_delivery_time,
  o.delivered_at,
  o.status,
  o.total_items,
  o.customer_distance_km,
  p.zone_id,
  p.station_id,
  p.picker_id,
  p.packer_id,
  p.rider_id,
  t.pick_start_delay,
  t.pick_duration,
  t.pack_duration,
  t.dispatch_wait,
  t.delivery_duration,
  t.total_duration
FROM public.orders o
LEFT JOIN public.order_stage_timings t ON t.order_id = o.order_id
LEFT JOIN public.order_participants p ON p.order_id = o.order_id;

GRANT SELECT ON public.order_facts TO anon, authenticated, service_role;

-- 6. Per-stage overrun list, derived through the shared threshold functions.
CREATE OR REPLACE VIEW public.order_stage_overruns AS
SELECT f.order_id,
  f.store_id,
  f.zone_id,
  f.station_id,
  f.picker_id,
  f.packer_id,
  f.rider_id,
  f.created_at,
  extract(hour FROM f.created_at)::int AS hour,
  CASE
    WHEN extract(hour FROM f.created_at) BETWEEN 6 AND 13 THEN 'MORNING'
    WHEN extract(hour FROM f.created_at) BETWEEN 14 AND 21 THEN 'EVENING'
    ELSE 'NIGHT'
  END AS shift,
  s.stage,
  s.actual,
  public.stage_expected(s.stage, f.total_items, f.customer_distance_km) AS expected,
  public.stage_threshold(s.stage, f.total_items, f.customer_distance_km) AS threshold,
  public.stage_overrun(s.stage, s.actual, f.total_items, f.customer_distance_km) AS overrun
FROM public.order_facts f
CROSS JOIN LATERAL (
  VALUES
    ('PICK_START', f.pick_start_delay),
    ('PICKING', f.pick_duration),
    ('PACKING', f.pack_duration),
    ('DISPATCH', f.dispatch_wait),
    ('DELIVERY', f.delivery_duration)
) AS s(stage, actual)
WHERE s.actual IS NOT NULL;

GRANT SELECT ON public.order_stage_overruns TO anon, authenticated, service_role;

-- 7. Bottleneck records carry stage AND root cause, plus shift and affected orders.
ALTER TABLE public.bottleneck_events ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE public.bottleneck_events ADD COLUMN IF NOT EXISTS affected_orders integer NOT NULL DEFAULT 0;
ALTER TABLE public.bottleneck_events ADD COLUMN IF NOT EXISTS root_cause_category text;

-- 8. Interventions: signed-in users only.
CREATE TABLE IF NOT EXISTS public.interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature text,
  order_id text,
  zone_id text,
  stage text,
  root_cause text,
  recommendation text NOT NULL,
  action_taken text NOT NULL,
  action_at timestamptz NOT NULL DEFAULT now(),
  before_sla numeric,
  after_sla numeric,
  outcome text NOT NULL DEFAULT 'PENDING',
  improvement_pct numeric,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.interventions TO authenticated;
GRANT ALL ON public.interventions TO service_role;
ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interventions readable by authenticated" ON public.interventions;
CREATE POLICY "interventions readable by authenticated" ON public.interventions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "interventions insertable by authenticated" ON public.interventions;
CREATE POLICY "interventions insertable by authenticated" ON public.interventions
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "interventions updatable by authenticated" ON public.interventions;
CREATE POLICY "interventions updatable by authenticated" ON public.interventions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_interventions_updated_at ON public.interventions;
CREATE TRIGGER update_interventions_updated_at
  BEFORE UPDATE ON public.interventions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
