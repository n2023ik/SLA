
CREATE VIEW public.order_facts
WITH (security_invoker = true) AS
SELECT
  o.order_id,
  o.store_id,
  o.created_at,
  o.promised_delivery_time,
  o.delivered_at,
  o.status,
  o.total_items,
  o.customer_distance_km,
  max(ev.zone_id) AS zone_id,
  max(CASE WHEN ev.station_id IS NOT NULL THEN ev.station_id END) AS station_id,
  max(CASE WHEN ev.employee_role = 'PICKER' THEN ev.employee_id END) AS picker_id,
  max(CASE WHEN ev.employee_role = 'PACKER' THEN ev.employee_id END) AS packer_id,
  max(CASE WHEN ev.employee_role = 'RIDER' THEN ev.employee_id END) AS rider_id,
  m.pick_start_delay,
  m.pick_duration,
  m.pack_duration,
  m.dispatch_wait,
  m.delivery_duration,
  m.total_duration,
  m.sla_status,
  m.breach_stage
FROM public.orders o
JOIN public.sla_metrics m ON m.order_id = o.order_id
LEFT JOIN public.order_events ev ON ev.order_id = o.order_id
GROUP BY o.id, o.order_id, o.store_id, o.created_at, o.promised_delivery_time, o.delivered_at,
         o.status, o.total_items, o.customer_distance_km, m.pick_start_delay, m.pick_duration,
         m.pack_duration, m.dispatch_wait, m.delivery_duration, m.total_duration, m.sla_status,
         m.breach_stage;

CREATE VIEW public.zone_inventory_health
WITH (security_invoker = true) AS
SELECT zone_id,
       count(*)::int AS total_skus,
       count(*) FILTER (WHERE stock_level < reorder_threshold)::int AS low_stock_skus
FROM public.inventory
GROUP BY zone_id;

GRANT SELECT ON public.order_facts, public.zone_inventory_health TO anon, authenticated, service_role;
