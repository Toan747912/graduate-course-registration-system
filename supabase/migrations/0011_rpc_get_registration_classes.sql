-- 0011_rpc_get_registration_classes.sql
-- get_registration_classes(p_semester_id): read model for the registration screen.
-- Only classes in an open registration period and in ACTIVE status are returned
-- (BUS-15). A full class still appears, with display_status = 'FULL'.
--
-- This is the STUDENT-facing registration screen read model, restricted to
-- callers who are an ACTIVE STUDENT (public.is_active_student()). Training
-- staff must use their own endpoints/queries (see apps/api/src/routes/staff.ts
-- and the staff-scoped RLS select policies in 0007_rls_policies.sql), not this
-- RPC — it intentionally does not serve a staff-oriented view.

create or replace function public.get_registration_classes(p_semester_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_active_student() then
    raise exception 'only an active student may view the registration class list';
  end if;

  return query
  select jsonb_build_object(
    'class_id', cc.id,
    'course_code', co.code,
    'course_name', co.name,
    'credits', co.credits,
    'class_code', cc.class_code,
    'max_seats', cc.max_seats,
    'confirmed_count', coalesce(seat.confirmed_count, 0),
    'seats_remaining', greatest(cc.max_seats - coalesce(seat.confirmed_count, 0), 0),
    'display_status', case
      when coalesce(seat.confirmed_count, 0) >= cc.max_seats then 'FULL'
      else 'OPEN'
    end,
    'schedules', coalesce(sched.schedules, '[]'::jsonb)
  )
  from public.course_classes cc
  join public.registration_periods rp on rp.id = cc.registration_period_id
  join public.courses co on co.id = cc.course_id
  left join lateral (
    select count(*) as confirmed_count
    from public.enrollments e
    where e.course_class_id = cc.id and e.status = 'CONFIRMED'
  ) seat on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'day_of_week', cs.day_of_week,
        'session_slot', cs.session_slot,
        'room', cs.room
      )
      order by cs.day_of_week, cs.session_slot
    ) as schedules
    from public.class_schedules cs
    where cs.course_class_id = cc.id
  ) sched on true
  where rp.semester_id = p_semester_id
    and cc.status = 'ACTIVE'
    and now() between rp.opens_at and rp.closes_at
  order by co.code, cc.class_code;
end;
$$;

comment on function public.get_registration_classes(uuid) is 'Read model for the registration screen. Only ACTIVE classes in an open period for the given semester; full classes still appear with display_status = FULL (BUS-15).';

revoke all on function public.get_registration_classes(uuid) from public;
grant execute on function public.get_registration_classes(uuid) to authenticated;
