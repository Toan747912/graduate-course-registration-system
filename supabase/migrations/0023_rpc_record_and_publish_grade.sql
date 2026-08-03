-- 0023_rpc_record_and_publish_grade.sql
-- staff_create_draft_grade / staff_update_draft_grade / staff_publish_grade
-- (BUS-27..32, UC-22/23). SECURITY DEFINER, locked search_path, revoke public
-- + grant authenticated only, matching the 0012/0019 convention. Business-
-- rule rejections come back as jsonb {success:false, reason} in Vietnamese;
-- unauthenticated/unauthorized callers raise (matching create_course_class).
-- Batch 3 P3 hardening (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md section 8.3):
-- `revoke ... from public` alone does not remove EXECUTE granted directly to
-- `anon` by ALTER DEFAULT PRIVILEGES on Supabase projects (that grant does not
-- go through the PUBLIC pseudo-role), so anon is revoked explicitly on every
-- RPC below in addition to public. authenticated keeps EXECUTE only.

-- ---------------------------------------------------------------------------
-- staff_create_draft_grade: create a new DRAFT enrollment_grades row for a
-- CONFIRMED enrollment. final_score is mandatory and validated here so no
-- empty-draft row can ever be created (design decision #5, BUS-27/29).
-- ---------------------------------------------------------------------------
create or replace function public.staff_create_draft_grade(
  p_enrollment_id uuid,
  p_final_score numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_grade public.enrollment_grades%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may enter grades';
  end if;

  if p_final_score is null or p_final_score < 0 or p_final_score > 10 then
    return jsonb_build_object('success', false, 'reason', 'Điểm phải nằm trong khoảng 0-10');
  end if;

  select * into v_enrollment from public.enrollments where id = p_enrollment_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy lượt đăng ký');
  end if;

  if v_enrollment.status <> 'CONFIRMED' then
    return jsonb_build_object('success', false, 'reason', 'Lượt đăng ký không ở trạng thái đã xác nhận, không thể nhập điểm');
  end if;

  if exists (select 1 from public.enrollment_grades where enrollment_id = p_enrollment_id) then
    return jsonb_build_object('success', false, 'reason', 'Lượt đăng ký này đã có điểm, vui lòng sửa thay vì tạo mới');
  end if;

  insert into public.enrollment_grades (enrollment_id, final_score, grade_status)
  values (p_enrollment_id, p_final_score, 'DRAFT')
  returning * into v_grade;

  return jsonb_build_object(
    'success', true,
    'id', v_grade.id,
    'enrollment_id', v_grade.enrollment_id,
    'final_score', v_grade.final_score,
    'grade_status', v_grade.grade_status
  );
end;
$$;

comment on function public.staff_create_draft_grade(uuid, numeric) is 'Staff-only. Creates a DRAFT enrollment_grades row for a CONFIRMED enrollment; final_score is mandatory and validated here (BUS-27/29). Rejects if the enrollment already has a grade row.';

revoke all on function public.staff_create_draft_grade(uuid, numeric) from public;
revoke all on function public.staff_create_draft_grade(uuid, numeric) from anon;
grant execute on function public.staff_create_draft_grade(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_update_draft_grade: edit final_score while still DRAFT (BUS-30).
-- ---------------------------------------------------------------------------
create or replace function public.staff_update_draft_grade(
  p_enrollment_id uuid,
  p_final_score numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grade public.enrollment_grades%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may edit grades';
  end if;

  if p_final_score is null or p_final_score < 0 or p_final_score > 10 then
    return jsonb_build_object('success', false, 'reason', 'Điểm phải nằm trong khoảng 0-10');
  end if;

  select * into v_grade from public.enrollment_grades where enrollment_id = p_enrollment_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Chưa có điểm cho lượt đăng ký này');
  end if;

  if v_grade.grade_status <> 'DRAFT' then
    return jsonb_build_object('success', false, 'reason', 'Điểm đã công bố, không thể sửa');
  end if;

  update public.enrollment_grades
  set final_score = p_final_score
  where enrollment_id = p_enrollment_id
  returning * into v_grade;

  return jsonb_build_object(
    'success', true,
    'id', v_grade.id,
    'enrollment_id', v_grade.enrollment_id,
    'final_score', v_grade.final_score,
    'grade_status', v_grade.grade_status
  );
end;
$$;

comment on function public.staff_update_draft_grade(uuid, numeric) is 'Staff-only. Edits final_score while grade_status = DRAFT (BUS-30). Rejects (jsonb) once PUBLISHED, in addition to the 0021 trigger blocking the UPDATE at the table level.';

revoke all on function public.staff_update_draft_grade(uuid, numeric) from public;
revoke all on function public.staff_update_draft_grade(uuid, numeric) from anon;
grant execute on function public.staff_update_draft_grade(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_publish_grade: DRAFT -> PUBLISHED, computing result_status from
-- programs.pass_score_min of the student's current program (BUS-32).
-- ---------------------------------------------------------------------------
create or replace function public.staff_publish_grade(p_enrollment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_grade public.enrollment_grades%rowtype;
  v_pass_score_min numeric;
  v_result_status text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may publish grades';
  end if;

  select * into v_grade from public.enrollment_grades where enrollment_id = p_enrollment_id for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'Chưa có điểm cho lượt đăng ký này');
  end if;

  if v_grade.grade_status <> 'DRAFT' then
    return jsonb_build_object('success', false, 'reason', 'Điểm đã được công bố trước đó');
  end if;

  select pr.pass_score_min into v_pass_score_min
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  join public.programs pr on pr.id = p.program_id
  where e.id = p_enrollment_id;

  if v_pass_score_min is null then
    return jsonb_build_object('success', false, 'reason', 'Học viên chưa được gán chương trình đào tạo, không thể công bố điểm');
  end if;

  v_result_status := case when v_grade.final_score >= v_pass_score_min then 'PASS' else 'FAIL' end;

  update public.enrollment_grades
  set grade_status = 'PUBLISHED',
      result_status = v_result_status,
      published_at = now(),
      published_by = auth.uid()
  where enrollment_id = p_enrollment_id
  returning * into v_grade;

  return jsonb_build_object(
    'success', true,
    'id', v_grade.id,
    'enrollment_id', v_grade.enrollment_id,
    'final_score', v_grade.final_score,
    'grade_status', v_grade.grade_status,
    'result_status', v_grade.result_status,
    'published_at', v_grade.published_at
  );
end;
$$;

comment on function public.staff_publish_grade(uuid) is 'Staff-only. DRAFT -> PUBLISHED, computing result_status = final_score >= programs.pass_score_min (of the student''s current program) ? PASS : FAIL (BUS-32). Idempotent-safe: publishing an already-PUBLISHED row returns success:false.';

revoke all on function public.staff_publish_grade(uuid) from public;
revoke all on function public.staff_publish_grade(uuid) from anon;
grant execute on function public.staff_publish_grade(uuid) to authenticated;
