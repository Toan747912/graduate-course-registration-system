-- 0012_rpc_create_course_class.sql
-- create_course_class(...): staff-only, atomic creation of a course_class
-- plus its class_schedules rows (BUS-12/BUS-14). Prior to this migration the
-- API performed two separate inserts (course_classes then class_schedules);
-- if the second insert failed the class would be left with zero schedules.
-- A single plpgsql function call is one implicit transaction, so any
-- exception (including the duplicate-class-code check below) rolls back the
-- class row too - no partial class can be created.
--
-- Expected/validatable failures are returned as jsonb {success:false, reason}
-- (Vietnamese, for direct display), matching the convention used by
-- register_for_class/cancel_own_enrollment. Truly unexpected situations
-- (not authenticated, not training staff) raise, since those paths are
-- already blocked by requireAuth/requireRole before this RPC is reachable.

create or replace function public.create_course_class(
  p_registration_period_id uuid,
  p_course_id uuid,
  p_class_code text,
  p_max_seats integer,
  p_schedules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_class public.course_classes%rowtype;
  v_schedule_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may create a course class';
  end if;

  if p_class_code is null or btrim(p_class_code) = '' then
    return jsonb_build_object('success', false, 'reason', 'Mã lớp không được để trống');
  end if;

  if p_max_seats is null or p_max_seats <= 0 then
    return jsonb_build_object('success', false, 'reason', 'Sĩ số tối đa phải lớn hơn 0');
  end if;

  if not exists (select 1 from public.registration_periods where id = p_registration_period_id) then
    return jsonb_build_object('success', false, 'reason', 'Đợt đăng ký không tồn tại');
  end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('success', false, 'reason', 'Môn học không tồn tại');
  end if;

  if p_schedules is null or jsonb_typeof(p_schedules) <> 'array' or jsonb_array_length(p_schedules) < 1 then
    return jsonb_build_object('success', false, 'reason', 'Phải có ít nhất một buổi học');
  end if;

  begin
    insert into public.course_classes (registration_period_id, course_id, class_code, max_seats)
    values (p_registration_period_id, p_course_id, btrim(p_class_code), p_max_seats)
    returning * into v_class;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'reason', 'Mã lớp đã tồn tại trong đợt đăng ký này');
  end;

  insert into public.class_schedules (course_class_id, day_of_week, session_slot, room)
  select
    v_class.id,
    (elem->>'day_of_week')::int,
    (elem->>'session_slot')::int,
    nullif(elem->>'room', '')
  from jsonb_array_elements(p_schedules) as elem;

  get diagnostics v_schedule_count = row_count;

  return jsonb_build_object(
    'success', true,
    'class_id', v_class.id,
    'class_code', v_class.class_code,
    'status', v_class.status,
    'schedule_count', v_schedule_count
  );
end;
$$;

comment on function public.create_course_class(uuid, uuid, text, integer, jsonb) is 'Staff-only. Atomically creates a course_class and its class_schedules rows in one transaction (BUS-12/BUS-14); any failure after the class insert rolls back the class too.';

revoke all on function public.create_course_class(uuid, uuid, text, integer, jsonb) from public;
grant execute on function public.create_course_class(uuid, uuid, text, integer, jsonb) to authenticated;
