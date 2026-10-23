-- Pin search_path on the two functions the Supabase security advisor flags
-- (function_search_path_mutable). Both only touch public tables and pg_catalog
-- built-ins, so name resolution is unchanged; this only stops a caller's
-- search_path from redirecting what they resolve to.
ALTER FUNCTION public.mark_overdue_store_tasks(date) SET search_path = public, pg_catalog;
ALTER FUNCTION public.fmt_task_details(jsonb)        SET search_path = public, pg_catalog;
