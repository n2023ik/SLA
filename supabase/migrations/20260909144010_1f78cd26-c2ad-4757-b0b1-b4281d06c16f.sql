REVOKE ALL ON FUNCTION public.refresh_demo_live_orders() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_demo_live_orders() FROM authenticated;
REVOKE ALL ON FUNCTION public.refresh_demo_live_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_demo_live_orders() TO service_role;