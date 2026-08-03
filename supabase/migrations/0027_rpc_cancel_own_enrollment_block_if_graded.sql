-- 0027_rpc_cancel_own_enrollment_block_if_graded.sql
-- Updates cancel_own_enrollment (0009) to add BUS-37: reject self-cancel if
-- the enrollment already has an enrollment_grades row, DRAFT or PUBLISHED.
-- Same signature/return shape/locking order as 0009; every other branch
-- (ownership check, CONFIRMED check, registration-period window check,
-- refund/credit-count behavior) is unchanged. Enrollments with no grade at
-- all continue to self-cancel exactly as before Batch 3.

create or replace function public.cancel_own_enrollment(
  p_enrollment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_student_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_period public.registration_periods%rowtype;
begin
  if v_student_id is null then
    raise exception 'not authenticated';
  end if;

  -- Same lock register_for_class() takes, in the same role: serializes this
  -- call against any other register/cancel call by this student.
  select * into v_profile from public.profiles where id = v_student_id for update;
  if not found then
    raise exception 'profile not found';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    raise exception 'enrollment not found';
  end if;

  if v_enrollment.student_id <> v_student_id then
    raise exception 'not the owner of this enrollment';
  end if;

  if v_enrollment.status <> 'CONFIRMED' then
    return jsonb_build_object(
      'success', false,
      'enrollment_id', v_enrollment.id,
      'status', v_enrollment.status,
      'reason', 'Đăng ký không ở trạng thái có thể hủy'
    );
  end if;

  -- BUS-37: an enrollment that already has a grade (DRAFT or PUBLISHED)
  -- cannot be self-cancelled, regardless of caller (UI or direct RPC/API).
  if exists (select 1 from public.enrollment_grades where enrollment_id = p_enrollment_id) then
    return jsonb_build_object(
      'success', false,
      'enrollment_id', v_enrollment.id,
      'status', v_enrollment.status,
      'reason', 'Lượt đăng ký đã có điểm, không thể tự hủy'
    );
  end if;

  select rp.* into v_period
  from public.registration_periods rp
  join public.course_classes cc on cc.id = v_enrollment.course_class_id
  where rp.id = cc.registration_period_id;

  if now() < v_period.opens_at or now() > v_period.closes_at then
    return jsonb_build_object(
      'success', false,
      'enrollment_id', v_enrollment.id,
      'status', v_enrollment.status,
      'reason', 'Đợt đăng ký không còn mở'
    );
  end if;

  update public.enrollments
  set status = 'CANCELLED_BY_STUDENT', reason = p_reason
  where id = p_enrollment_id;

  insert into public.enrollment_history (enrollment_id, status, reason)
  values (p_enrollment_id, 'CANCELLED_BY_STUDENT', p_reason);

  return jsonb_build_object(
    'success', true,
    'enrollment_id', v_enrollment.id,
    'status', 'CANCELLED_BY_STUDENT',
    'reason', p_reason
  );
end;
$$;

comment on function public.cancel_own_enrollment(uuid, text) is 'Student self-cancel of their own CONFIRMED enrollment while the registration period is open (BUS-08). Seat count is derived, so no counter update is needed. Batch 3 (BUS-37): rejected outright if the enrollment already has an enrollment_grades row (DRAFT or PUBLISHED), enforced here regardless of UI state.';

-- Batch 3 P3 hardening (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.3):
-- explicit revoke from anon, not just public — see 0023 header comment.
revoke all on function public.cancel_own_enrollment(uuid, text) from public;
revoke all on function public.cancel_own_enrollment(uuid, text) from anon;
grant execute on function public.cancel_own_enrollment(uuid, text) to authenticated;
