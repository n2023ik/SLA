ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS demo_remaining_minutes numeric;

COMMENT ON COLUMN public.orders.demo_remaining_minutes IS
  'Demo-only intent: minutes of promised SLA that should remain at refresh time for in-progress orders. NULL for completed/real orders.';

-- Backfill the intent for the in-progress demo orders: three even buckets.
WITH live AS (
  SELECT order_id, row_number() OVER (ORDER BY order_id) AS rn, count(*) OVER () AS total
  FROM public.orders
  WHERE delivered_at IS NULL
)
UPDATE public.orders o
SET demo_remaining_minutes = CASE
      WHEN l.rn <= ceil(l.total / 3.0) THEN 18
      WHEN l.rn <= ceil(2 * l.total / 3.0) THEN 3
      ELSE -9
    END
FROM live l
WHERE o.order_id = l.order_id;

-- Re-anchors in-progress demo orders (and every one of their events) so their
-- timestamps are relative to now(). Idempotent: safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.refresh_demo_live_orders()
RETURNS TABLE (orders_shifted integer, events_shifted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders integer := 0;
  v_events integer := 0;
BEGIN
  CREATE TEMP TABLE _shift ON COMMIT DROP AS
  SELECT order_id,
         (now() + make_interval(secs => (demo_remaining_minutes * 60)::double precision))
           - promised_delivery_time AS delta
  FROM public.orders
  WHERE delivered_at IS NULL
    AND demo_remaining_minutes IS NOT NULL;

  UPDATE public.order_events e
  SET timestamp = e.timestamp + s.delta
  FROM _shift s
  WHERE e.order_id = s.order_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  UPDATE public.orders o
  SET created_at = o.created_at + s.delta,
      promised_delivery_time = o.promised_delivery_time + s.delta
  FROM _shift s
  WHERE o.order_id = s.order_id;
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  RETURN QUERY SELECT v_orders, v_events;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_demo_live_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_demo_live_orders() TO service_role;