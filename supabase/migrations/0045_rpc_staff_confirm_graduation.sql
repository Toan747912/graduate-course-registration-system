-- 0045_rpc_staff_confirm_graduation.sql
-- Batch 5, UC-47/48, H.2. The single RPC allowed to write
-- graduation_records or set profiles.academic_status = 'GRADUATED'
-- (BUS-68..72). Locks the target profile row with SELECT ... FOR UPDATE,
-- rejects if a graduation_records row already exists, recomputes eligibility
-- inside the same transaction via the shared helper (0042) rather than
-- trusting any client-supplied/cached eligibility value (BUS-69).

create or replace function public.staff_confirm_graduation(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_existing public.graduation_records%rowtype;
  v_eligibility record;
  v_record public.graduation_records%rowtype;
begin
  if v_staff_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_training_staff() then
    raise exception 'only training staff may confirm graduation';
  end if;

  -- Lock the target student's profile row for the duration of this
  -- transaction so two concurrent confirm calls for the same student cannot
  -- both proceed past the "already graduated" check (H.2, test #3).
  select * into v_profile from public.profiles where id = p_student_id for update;
  if not found or v_profile.role <> 'STUDENT' then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy học viên.');
  end if;

  -- BUS-72: at most one graduation_records row per student.
  select * into v_existing from public.graduation_records where student_id = p_student_id;
  if found then
    return jsonb_build_object('success', false, 'reason', 'already_graduated');
  end if;

  -- BUS-69: recompute live eligibility inside this locked transaction, never
  -- trust a value computed earlier (e.g. what the dashboard showed when the
  -- staff member opened the page).
  select * into v_eligibility from public._compute_graduation_eligibility(p_student_id);

  if v_eligibility.eligibility_status <> 'ELIGIBLE' then
    return jsonb_build_object(
      'success', false,
      'reason', 'not_eligible',
      'details', to_jsonb(v_eligibility.reasons)
    );
  end if;

  -- All snapshot fields must be present (D.1) or the whole transaction rolls
  -- back -- no partial graduation_records row is ever created.
  if v_eligibility.program_id is null or v_eligibility.thesis_id is null
     or v_eligibility.thesis_completed_at is null then
    raise exception 'graduation eligibility computed ELIGIBLE but snapshot fields are incomplete (internal invariant violation)';
  end if;

  insert into public.graduation_records (
    student_id, confirmed_by, program_id, program_code, program_name,
    cohort_id, cohort_code,
    required_credits_min, elective_credits_min,
    required_credits_earned, elective_credits_earned,
    thesis_id, thesis_code, thesis_completed_at,
    eligibility_rules_version
  ) values (
    p_student_id, v_staff_id, v_eligibility.program_id, v_eligibility.program_code, v_eligibility.program_name,
    v_eligibility.cohort_id, v_eligibility.cohort_code,
    v_eligibility.required_credits_min, v_eligibility.elective_credits_min,
    v_eligibility.required_credits_earned, v_eligibility.elective_credits_earned,
    v_eligibility.thesis_id, v_eligibility.thesis_code, v_eligibility.thesis_completed_at,
    'v1'
  )
  returning * into v_record;

  -- BUS-70: academic_status -> GRADUATED. profiles_academic_guard (0018)
  -- syncs student_status -> INACTIVE automatically; no manual sync here.
  update public.profiles set academic_status = 'GRADUATED' where id = p_student_id;

  return jsonb_build_object('success', true, 'graduation_record', to_jsonb(v_record));
end;
$$;

comment on function public.staff_confirm_graduation(uuid) is 'Staff-only (UC-47/48, BUS-68..72). Locks the target profiles row FOR UPDATE, recomputes eligibility in-transaction via _compute_graduation_eligibility (0042), and is the only RPC that ever writes graduation_records or sets academic_status=GRADUATED. Never reverts (BUS-71: no companion RPC exists).';

revoke all on function public.staff_confirm_graduation(uuid) from public, anon;
grant execute on function public.staff_confirm_graduation(uuid) to authenticated;
