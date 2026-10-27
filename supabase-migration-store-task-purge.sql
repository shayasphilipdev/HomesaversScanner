-- Store-task retention, moved out of the API's login cleanup into pg_cron.
--
-- The login cleanup's 90-day delete never completed: it ran as a background
-- task on the free plan's 10 ms Worker CPU budget and asked PostgREST to return
-- every deleted row as JSON, so ~2,400 rows past 90 days were still present.
--
-- Same rules it had: store_task_retention_days (default 90, floor 30), only
-- completed/missed rows, keyed on due_date (the day an instance was generated).
-- A row still inside its period, or any once-off, is never deleted:
-- generate_store_task_instances() would recreate it the next night as a fresh
-- pending task (ON CONFLICT on template/store/period finds nothing to stop it).
create or replace function public.purge_store_task_instances(p_date date default current_date)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_days    int;
  v_keys    text[];
  v_deleted int;
begin
  select greatest(30, coalesce(nullif(regexp_replace(value, '\D', '', 'g'), '')::int, 90))
    into v_days
    from app_settings where key = 'store_task_retention_days';
  v_days := coalesce(v_days, 90);

  v_keys := array[
    to_char(p_date, 'YYYY-MM-DD'),
    to_char(p_date, 'IYYY-"W"IW'),
    to_char(p_date, 'YYYY-MM'),
    to_char(p_date, 'YYYY')
  ];

  delete from store_task_instances
   where status in ('completed', 'missed')
     and due_date < p_date - v_days
     and not (period_key = any(v_keys))
     and period_key not like 'once%';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- 02:20 UTC: after the 01:00 generator, the 01:05 missed-marking and the 02:00
-- task-record purge; before the 02:30/02:40 vacuums.
select cron.schedule('purge-store-task-instances', '20 2 * * *',
                     $$select public.purge_store_task_instances();$$);
