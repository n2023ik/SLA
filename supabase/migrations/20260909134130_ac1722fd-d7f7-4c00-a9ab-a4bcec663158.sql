
CREATE TABLE public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id text NOT NULL UNIQUE,
  zone_name text NOT NULL,
  store_id text NOT NULL
);

CREATE TABLE public.workforce (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  zone_id text NOT NULL,
  shift text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  joining_date date NOT NULL DEFAULT current_date
);

CREATE TABLE public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id text NOT NULL,
  zone_id text NOT NULL,
  stock_level integer NOT NULL DEFAULT 0,
  reorder_threshold integer NOT NULL DEFAULT 0
);

CREATE TABLE public.packing_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id text NOT NULL UNIQUE,
  store_id text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  current_queue_length integer NOT NULL DEFAULT 0
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  store_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  promised_delivery_time timestamptz NOT NULL,
  delivered_at timestamptz,
  status text NOT NULL DEFAULT 'CREATED',
  total_items integer NOT NULL DEFAULT 1,
  customer_distance_km numeric(6,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  event_type text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  employee_id text,
  employee_role text,
  zone_id text,
  station_id text,
  notes text
);
CREATE INDEX order_events_order_idx ON public.order_events (order_id);
CREATE INDEX order_events_type_idx ON public.order_events (event_type);

CREATE TABLE public.sla_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL UNIQUE,
  pick_start_delay numeric(8,2),
  pick_duration numeric(8,2),
  pack_duration numeric(8,2),
  dispatch_wait numeric(8,2),
  delivery_duration numeric(8,2),
  total_duration numeric(8,2),
  sla_status text NOT NULL DEFAULT 'ON_TRACK',
  breach_stage text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  stage text NOT NULL,
  root_cause text NOT NULL,
  confidence_score numeric(4,2) NOT NULL DEFAULT 0,
  recommended_action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  UNIQUE (order_id, stage)
);

CREATE TABLE public.workforce_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  role text NOT NULL,
  date date NOT NULL,
  orders_handled integer NOT NULL DEFAULT 0,
  average_stage_time numeric(8,2) NOT NULL DEFAULT 0,
  delay_count integer NOT NULL DEFAULT 0,
  sla_breach_count integer NOT NULL DEFAULT 0,
  productivity_score numeric(6,2) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, date)
);

CREATE TABLE public.bottleneck_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id text NOT NULL,
  zone_id text NOT NULL,
  stage text NOT NULL,
  time_bucket text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 0,
  average_delay numeric(8,2) NOT NULL DEFAULT 0,
  root_cause text,
  severity text NOT NULL DEFAULT 'LOW'
);

GRANT SELECT ON public.zones, public.workforce, public.inventory, public.packing_stations,
  public.orders, public.order_events, public.sla_metrics, public.diagnoses,
  public.workforce_metrics, public.bottleneck_events TO anon, authenticated;
GRANT ALL ON public.zones, public.workforce, public.inventory, public.packing_stations,
  public.orders, public.order_events, public.sla_metrics, public.diagnoses,
  public.workforce_metrics, public.bottleneck_events TO service_role;

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bottleneck_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zones readable" ON public.zones FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workforce readable" ON public.workforce FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "inventory readable" ON public.inventory FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "stations readable" ON public.packing_stations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "orders readable" ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "order events readable" ON public.order_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sla metrics readable" ON public.sla_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "diagnoses readable" ON public.diagnoses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "workforce metrics readable" ON public.workforce_metrics FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "bottleneck events readable" ON public.bottleneck_events FOR SELECT TO anon, authenticated USING (true);

-- ============ DEMO DATA (correlated patterns) ============
DO $seed$
DECLARE
  v_store text := 'STORE-01';
  v_zone_names text[] := ARRAY['North Hub','Central Market','Riverside','Tech Park','Old Town'];
  v_shifts text[] := ARRAY['MORNING','EVENING','NIGHT'];
  z int; s int; k int; i int;
  v_zone text; v_shift text;
  v_created timestamptz; v_hour int; v_items int; v_dist numeric;
  v_picker text; v_packer text; v_rider text; v_station text;
  d_pick_start numeric; d_pick numeric; d_pack numeric; d_dispatch numeric; d_deliver numeric;
  v_total numeric; v_status text; v_sla text; v_breach text;
  v_oid text; t timestamptz; v_live boolean; v_stage int;
  v_slow_pick boolean; v_slow_pack boolean; v_slow_ride boolean;
BEGIN
  PERFORM setseed(0.42);

  FOR z IN 1..5 LOOP
    INSERT INTO public.zones (zone_id, zone_name, store_id)
    VALUES ('Z' || z, v_zone_names[z], v_store);
  END LOOP;

  -- 30 pickers, 15 packers, 15 riders: one+ per zone/shift combination
  k := 0;
  FOR z IN 1..5 LOOP
    FOR s IN 1..3 LOOP
      FOR i IN 1..2 LOOP
        k := k + 1;
        INSERT INTO public.workforce (employee_id, name, role, zone_id, shift, active, joining_date)
        VALUES ('PICK-' || lpad(k::text, 3, '0'), 'Picker ' || k, 'PICKER', 'Z' || z, v_shifts[s], true,
                current_date - (100 + k * 7));
      END LOOP;
    END LOOP;
  END LOOP;
  k := 0;
  FOR z IN 1..5 LOOP
    FOR s IN 1..3 LOOP
      k := k + 1;
      INSERT INTO public.workforce (employee_id, name, role, zone_id, shift, active, joining_date)
      VALUES ('PACK-' || lpad(k::text, 3, '0'), 'Packer ' || k, 'PACKER', 'Z' || z, v_shifts[s], true,
              current_date - (90 + k * 11));
      INSERT INTO public.workforce (employee_id, name, role, zone_id, shift, active, joining_date)
      VALUES ('RIDE-' || lpad(k::text, 3, '0'), 'Rider ' || k, 'RIDER', 'Z' || z, v_shifts[s], true,
              current_date - (60 + k * 9));
    END LOOP;
  END LOOP;

  FOR i IN 1..12 LOOP
    INSERT INTO public.packing_stations (station_id, store_id, status, current_queue_length)
    VALUES ('ST-' || lpad(i::text, 2, '0'), v_store,
            CASE WHEN i = 9 THEN 'MAINTENANCE' ELSE 'ACTIVE' END,
            CASE WHEN i IN (7, 11) THEN 8 + (i % 4) ELSE (random() * 3)::int END);
  END LOOP;

  FOR i IN 1..150 LOOP
    z := 1 + (i % 5);
    INSERT INTO public.inventory (sku_id, zone_id, stock_level, reorder_threshold)
    VALUES ('SKU-' || lpad(i::text, 4, '0'), 'Z' || z,
            CASE WHEN z = 3 AND i % 4 = 0 THEN (random() * 8)::int ELSE 20 + (random() * 180)::int END,
            25);
  END LOOP;

  FOR i IN 1..1000 LOOP
    v_live := i > 940;
    v_oid := 'QC-' || lpad(i::text, 5, '0');

    IF v_live THEN
      v_created := now() - make_interval(mins => (4 + random() * 26)::int);
    ELSE
      -- weighted towards evening peak hours
      v_hour := CASE WHEN random() < 0.42 THEN 17 + (random() * 5)::int ELSE 7 + (random() * 10)::int END;
      v_created := date_trunc('day', now()) - make_interval(days => (random() * 29)::int)
                   + make_interval(hours => v_hour, mins => (random() * 59)::int);
    END IF;
    v_hour := extract(hour FROM v_created)::int;
    v_shift := CASE WHEN v_hour BETWEEN 6 AND 13 THEN 'MORNING'
                    WHEN v_hour BETWEEN 14 AND 21 THEN 'EVENING' ELSE 'NIGHT' END;
    -- Zone 3 gets a disproportionate share of load
    z := CASE WHEN random() < 0.34 THEN 3 ELSE 1 + (random() * 4.99)::int END;
    v_zone := 'Z' || z;
    v_items := 3 + (random() * 22)::int;
    v_dist := round((0.8 + random() * 6.5)::numeric, 2);

    SELECT employee_id INTO v_picker FROM public.workforce
      WHERE role = 'PICKER' AND zone_id = v_zone AND shift = v_shift ORDER BY random() LIMIT 1;
    SELECT employee_id INTO v_packer FROM public.workforce
      WHERE role = 'PACKER' AND shift = v_shift ORDER BY random() LIMIT 1;
    SELECT employee_id INTO v_rider FROM public.workforce
      WHERE role = 'RIDER' AND zone_id = v_zone AND shift = v_shift ORDER BY random() LIMIT 1;
    v_station := CASE WHEN random() < 0.32 THEN (ARRAY['ST-07','ST-11'])[1 + (random() * 1.99)::int]
                      ELSE 'ST-' || lpad((1 + (random() * 11.99)::int)::text, 2, '0') END;

    v_slow_pick := v_picker IN ('PICK-007', 'PICK-018');
    v_slow_pack := v_packer = 'PACK-004';
    v_slow_ride := v_rider = 'RIDE-011';

    -- pick start delay: manpower shortage in the evening peak
    d_pick_start := 1.2 + random() * 2.5;
    IF v_hour BETWEEN 18 AND 21 THEN d_pick_start := d_pick_start + 5 + random() * 7; END IF;
    IF z = 3 THEN d_pick_start := d_pick_start + 1.5 + random() * 3; END IF;

    -- picking: item count driven, zone 3 congestion, individual anomalies
    d_pick := 2.5 + v_items * 0.32 + random() * 2;
    IF z = 3 THEN d_pick := d_pick * 1.45; END IF;
    IF v_slow_pick THEN d_pick := d_pick * 1.7; END IF;

    -- packing: station queue congestion + one packer anomaly
    d_pack := 1.8 + v_items * 0.14 + random() * 1.6;
    IF v_station IN ('ST-07', 'ST-11') THEN d_pack := d_pack + 4 + random() * 5; END IF;
    IF v_slow_pack THEN d_pack := d_pack * 1.55; END IF;

    -- dispatch wait: rider scarcity in the evening
    d_dispatch := 1.0 + random() * 2.2;
    IF v_hour BETWEEN 18 AND 21 THEN d_dispatch := d_dispatch + 4 + random() * 6; END IF;

    d_deliver := 5 + v_dist * 2.6 + random() * 3;
    IF v_slow_ride THEN d_deliver := d_deliver * 1.4; END IF;

    d_pick_start := round(d_pick_start, 2); d_pick := round(d_pick, 2);
    d_pack := round(d_pack, 2); d_dispatch := round(d_dispatch, 2); d_deliver := round(d_deliver, 2);
    v_total := d_pick_start + d_pick + d_pack + d_dispatch + d_deliver;

    v_breach := NULL;
    IF d_pick_start > 5 THEN v_breach := 'PICK_START'; END IF;
    IF d_pick > 11 AND (v_breach IS NULL OR d_pick - 11 > d_pick_start - 5) THEN v_breach := 'PICKING'; END IF;
    IF d_pack > 8 THEN v_breach := COALESCE(v_breach, 'PACKING'); END IF;
    IF d_dispatch > 6 THEN v_breach := COALESCE(v_breach, 'DISPATCH'); END IF;

    IF v_live THEN
      v_stage := 1 + (i % 4);
      v_status := (ARRAY['CREATED','PICKING','PACKING','DISPATCHED'])[v_stage];
      INSERT INTO public.orders (order_id, store_id, created_at, promised_delivery_time, delivered_at, status, total_items, customer_distance_km)
      VALUES (v_oid, v_store, v_created, v_created + interval '30 minutes', NULL, v_status, v_items, v_dist);

      t := v_created;
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'ORDER_CREATED', t, NULL, NULL, v_zone, NULL);
      IF v_stage >= 2 THEN
        t := t + make_interval(secs => (d_pick_start * 60)::int);
        INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
        VALUES (v_oid, 'PICKING_STARTED', t, v_picker, 'PICKER', v_zone, NULL);
      END IF;
      IF v_stage >= 3 THEN
        t := t + make_interval(secs => (d_pick * 60)::int);
        INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
        VALUES (v_oid, 'PICKING_COMPLETED', t, v_picker, 'PICKER', v_zone, NULL);
        INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
        VALUES (v_oid, 'PACKING_STARTED', t, v_packer, 'PACKER', v_zone, v_station);
      END IF;
      IF v_stage >= 4 THEN
        t := t + make_interval(secs => (d_pack * 60)::int);
        INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
        VALUES (v_oid, 'PACKING_COMPLETED', t, v_packer, 'PACKER', v_zone, v_station);
        t := t + make_interval(secs => (d_dispatch * 60)::int);
        INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
        VALUES (v_oid, 'DISPATCHED', t, v_rider, 'RIDER', v_zone, NULL);
      END IF;

      INSERT INTO public.sla_metrics (order_id, pick_start_delay, pick_duration, pack_duration, dispatch_wait, delivery_duration, total_duration, sla_status, breach_stage, created_at)
      VALUES (v_oid,
              CASE WHEN v_stage >= 2 THEN d_pick_start END,
              CASE WHEN v_stage >= 3 THEN d_pick END,
              CASE WHEN v_stage >= 4 THEN d_pack END,
              CASE WHEN v_stage >= 4 THEN d_dispatch END,
              NULL, NULL,
              CASE WHEN v_breach IS NOT NULL THEN 'AT_RISK' ELSE 'ON_TRACK' END,
              v_breach, v_created);
    ELSE
      v_sla := CASE WHEN v_total > 30 THEN 'BREACHED'
                    WHEN v_total > 26 THEN 'AT_RISK' ELSE 'ON_TRACK' END;
      IF v_sla = 'ON_TRACK' THEN v_breach := NULL; END IF;
      INSERT INTO public.orders (order_id, store_id, created_at, promised_delivery_time, delivered_at, status, total_items, customer_distance_km)
      VALUES (v_oid, v_store, v_created, v_created + interval '30 minutes',
              v_created + make_interval(secs => (v_total * 60)::int), 'DELIVERED', v_items, v_dist);

      t := v_created;
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'ORDER_CREATED', t, NULL, NULL, v_zone, NULL);
      t := t + make_interval(secs => (d_pick_start * 60)::int);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'PICKING_STARTED', t, v_picker, 'PICKER', v_zone, NULL);
      t := t + make_interval(secs => (d_pick * 60)::int);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'PICKING_COMPLETED', t, v_picker, 'PICKER', v_zone, NULL);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'PACKING_STARTED', t, v_packer, 'PACKER', v_zone, v_station);
      t := t + make_interval(secs => (d_pack * 60)::int);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'PACKING_COMPLETED', t, v_packer, 'PACKER', v_zone, v_station);
      t := t + make_interval(secs => (d_dispatch * 60)::int);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'DISPATCHED', t, v_rider, 'RIDER', v_zone, NULL);
      t := t + make_interval(secs => (d_deliver * 60)::int);
      INSERT INTO public.order_events (order_id, event_type, timestamp, employee_id, employee_role, zone_id, station_id)
      VALUES (v_oid, 'DELIVERED', t, v_rider, 'RIDER', v_zone, NULL);

      INSERT INTO public.sla_metrics (order_id, pick_start_delay, pick_duration, pack_duration, dispatch_wait, delivery_duration, total_duration, sla_status, breach_stage, created_at)
      VALUES (v_oid, d_pick_start, d_pick, d_pack, d_dispatch, d_deliver, round(v_total, 2), v_sla, v_breach, v_created);
    END IF;
  END LOOP;

  -- daily workforce metrics aggregated from events
  INSERT INTO public.workforce_metrics (employee_id, role, date, orders_handled, average_stage_time, delay_count, sla_breach_count, productivity_score)
  SELECT e.employee_id,
         e.employee_role,
         (e.timestamp AT TIME ZONE 'UTC')::date AS d,
         count(DISTINCT e.order_id),
         round(coalesce(avg(CASE e.employee_role WHEN 'PICKER' THEN m.pick_duration WHEN 'PACKER' THEN m.pack_duration ELSE m.delivery_duration END), 0)::numeric, 2),
         count(*) FILTER (WHERE m.breach_stage IS NOT NULL),
         count(*) FILTER (WHERE m.sla_status = 'BREACHED'),
         round(greatest(0, 100 - coalesce(avg(CASE e.employee_role WHEN 'PICKER' THEN m.pick_duration WHEN 'PACKER' THEN m.pack_duration ELSE m.delivery_duration END), 0) * 3)::numeric, 2)
  FROM public.order_events e
  JOIN public.sla_metrics m ON m.order_id = e.order_id
  WHERE e.employee_id IS NOT NULL AND e.event_type IN ('PICKING_STARTED', 'PACKING_STARTED', 'DISPATCHED')
  GROUP BY e.employee_id, e.employee_role, d;

  -- recurring bottleneck clusters by zone / stage / hour bucket
  INSERT INTO public.bottleneck_events (store_id, zone_id, stage, time_bucket, occurrence_count, average_delay, root_cause, severity)
  SELECT v_store, x.zone_id, x.stage, x.bucket, count(*),
         round(avg(x.delay)::numeric, 2),
         CASE x.stage
           WHEN 'PICK_START' THEN 'Picker assignment delay / manpower shortage'
           WHEN 'PICKING' THEN 'Zone congestion or high item count'
           WHEN 'PACKING' THEN 'Packing station queue congestion'
           ELSE 'Rider availability / dispatch queue' END,
         CASE WHEN count(*) > 40 THEN 'HIGH' WHEN count(*) > 15 THEN 'MEDIUM' ELSE 'LOW' END
  FROM (
    SELECT ev.zone_id,
           m.breach_stage AS stage,
           lpad(extract(hour FROM o.created_at)::text, 2, '0') || ':00' AS bucket,
           CASE m.breach_stage
             WHEN 'PICK_START' THEN m.pick_start_delay - 5
             WHEN 'PICKING' THEN m.pick_duration - 11
             WHEN 'PACKING' THEN m.pack_duration - 8
             ELSE m.dispatch_wait - 6 END AS delay
    FROM public.sla_metrics m
    JOIN public.orders o ON o.order_id = m.order_id
    JOIN public.order_events ev ON ev.order_id = m.order_id AND ev.event_type = 'ORDER_CREATED'
    WHERE m.breach_stage IS NOT NULL
  ) x
  WHERE x.delay IS NOT NULL
  GROUP BY x.zone_id, x.stage, x.bucket;
END
$seed$;
