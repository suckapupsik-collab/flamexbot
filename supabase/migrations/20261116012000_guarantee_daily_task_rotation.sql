-- Rotate the three daily challenges by UTC day so the set changes every day.
create or replace function private.get_flamexbot_daily_task_codes()
returns text[]
language sql
stable
set search_path = ''
as $$
  with catalog as (
    select c.*,
      row_number() over(order by c.task_order)::integer as rn,
      count(*) over()::integer as total
    from private.get_flamexbot_daily_task_catalog() c
  ),
  seed as (
    select mod(
      ((now() at time zone 'UTC')::date - date '2000-01-01')::bigint,
      max(total)::bigint
    )::integer as start_index
    from catalog
  ),
  rotated as (
    select c.task_code,
      mod(c.rn-1-s.start_index+c.total,c.total) as slot
    from catalog c cross join seed s
  )
  select coalesce(array_agg(task_code order by slot),'{}'::text[])
  from rotated where slot<3;
$$;
