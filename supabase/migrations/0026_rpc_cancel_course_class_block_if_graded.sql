-- 0026_rpc_cancel_course_class_block_if_graded.sql
-- Updates cancel_course_class (0010) to add BUS-36: reject cancellation if any
-- CONFIRMED (or otherwise) enrollment of the class already has an
-- enrollment_grades row, DRAFT or PUBLISHED. Same signature/return shape as
-- 0010; every other branch/behavior is unchanged. Classes with no grades at
-- all continue to cancel exactly as before Batch 3.

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

  -- BUS-36: a class with any recorded grade (DRAFT or PUBLISHED) attached to
  -- any of its enrollments can no longer be cancelled.
  if exists (
    select 1
    from public.enrollment_grades g
    join public.enrollments e on e.id = g.enrollment_id
    where e.course_class_id = p_class_id
  ) then
    return jsonb_build_object(
      'success', false,
      'class_id', v_class.id,
      'reason', 'Lớp học phần đã có điểm, không thể hủy'
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

comment on function public.cancel_course_class(uuid, text) is 'Staff-only. Cascades CONFIRMED enrollments to CANCELLED_BY_SCHOOL (BUS-11); does not release seats since the class no longer accepts registrations. Batch 3 (BUS-36): rejected outright if any enrollment of the class already has an enrollment_grades row (DRAFT or PUBLISHED).';

-- Batch 3 P3 hardening (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.3):
-- explicit revoke from anon, not just public — see 0023 header comment.
revoke all on function public.cancel_course_class(uuid, text) from public;
revoke all on function public.cancel_course_class(uuid, text) from anon;
grant execute on function public.cancel_course_class(uuid, text) to authenticated;
