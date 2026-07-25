-- 0010_rpc_cancel_course_class.sql
-- cancel_course_class(p_class_id, p_reason): staff-only class cancellation.
-- Implements BUS-10, BUS-11: mandatory reason, cascades CONFIRMED enrollments to
-- CANCELLED_BY_SCHOOL, does NOT free seats for re-registration (class stops
-- accepting registrations entirely once CANCELLED).

create or replace function public.cancel_course_class(
  p_class_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_class public.course_classes%rowtype;
  v_cancelled_count integer;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may cancel a course class';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'cancellation reason is required';
  end if;

  select * into v_class from public.course_classes where id = p_class_id for update;
  if not found then
    raise exception 'course class not found';
  end if;

  if v_class.status = 'CANCELLED' then
    return jsonb_build_object(
      'success', false,
      'class_id', v_class.id,
      'reason', 'Lớp học phần đã ở trạng thái đã hủy'
    );
  end if;

  update public.course_classes
  set status = 'CANCELLED', cancellation_reason = p_reason
  where id = p_class_id;

  with cancelled as (
    update public.enrollments
    set status = 'CANCELLED_BY_SCHOOL', reason = p_reason
    where course_class_id = p_class_id
      and status = 'CONFIRMED'
    returning id
  )
  insert into public.enrollment_history (enrollment_id, status, reason)
  select id, 'CANCELLED_BY_SCHOOL', p_reason from cancelled;

  get diagnostics v_cancelled_count = row_count;

  return jsonb_build_object(
    'success', true,
    'class_id', v_class.id,
    'status', 'CANCELLED',
    'cancelled_enrollment_count', v_cancelled_count
  );
end;
$$;

comment on function public.cancel_course_class(uuid, text) is 'Staff-only. Cascades CONFIRMED enrollments to CANCELLED_BY_SCHOOL (BUS-11); does not release seats since the class no longer accepts registrations.';

revoke all on function public.cancel_course_class(uuid, text) from public;
grant execute on function public.cancel_course_class(uuid, text) to authenticated;
