-- 0042_helper_compute_graduation_eligibility.sql
-- Batch 5 internal helper (design doc D.4, mirrors the _student_progress /
-- _student_grades_rows convention from migration 0025). NOT exposed to any
-- client role -- see the explicit revoke block at the end of this file and
-- BUS-78. Every other Batch 5 RPC that needs a live eligibility answer calls
-- this function so there is exactly one implementation of BUS-65 (design doc
-- D.4 / BUS-67).
--
-- Reuses public._student_progress (0025) verbatim for credit totals -- does
-- NOT reimplement the progress formula.

create or replace function public._compute_graduation_eligibility(p_student_id uuid)
returns table (
  student_id uuid,
  academic_status text,
  eligibility_status text,
  reasons text[],
  program_id uuid,
  program_code text,
  program_name text,
  cohort_id uuid,
  cohort_code text,
  required_credits_min numeric,
  elective_credits_min numeric,
  required_credits_earned numeric,
  elective_credits_earned numeric,
  thesis_id uuid,
  thesis_code text,
  thesis_completed_at timestamptz,
  has_active_thesis boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles%rowtype;
  v_progress record;
  v_program public.programs%rowtype;
  v_cohort public.cohorts%rowtype;
  v_reasons text[] := array[]::text[];
  v_thesis public.theses%rowtype;
  v_has_active boolean := false;
  v_status text;
begin
  select p.* into v_profile from public.profiles p where p.id = p_student_id;
  if not found or v_profile.role <> 'STUDENT' then
    raise exception 'not a student';
  end if;

  -- BUS-65(a): eligibility is only meaningful for a student currently
  -- STUDYING. For any other academic_status, report NOT_APPLICABLE with no
  -- credit/thesis computation (H.1).
  if v_profile.academic_status <> 'STUDYING' then
    return query select
      p_student_id, v_profile.academic_status, 'NOT_APPLICABLE'::text,
      array['not_studying']::text[],
      v_profile.program_id, null::text, null::text,
      v_profile.cohort_id, null::text,
      null::numeric, null::numeric, null::numeric, null::numeric,
      null::uuid, null::text, null::timestamptz, null::boolean;
    return;
  end if;

  select * into v_progress from public._student_progress(p_student_id);

  select pr.* into v_program from public.programs pr where pr.id = v_progress.program_id;
  if v_profile.cohort_id is not null then
    select c.* into v_cohort from public.cohorts c where c.id = v_profile.cohort_id;
  end if;

  if v_program.id is null then
    v_reasons := array_append(v_reasons, 'not_assigned_to_program');
  else
    -- BUS-65(b)/(c): reuse the exact same _student_progress totals used by
    -- the Progress page (BUS-67); never recomputed differently here.
    if coalesce(v_progress.required_credits_earned, 0) < v_progress.required_credits_min then
      v_reasons := array_append(v_reasons, 'required_credits_not_met');
    end if;
    if coalesce(v_progress.elective_credits_earned, 0) < v_progress.elective_credits_min then
      v_reasons := array_append(v_reasons, 'elective_credits_not_met');
    end if;
  end if;

  -- BUS-65(e): any active thesis blocks graduation.
  select exists (
    select 1 from public.theses t
    where t.student_id = p_student_id
      and t.status in ('PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS')
  ) into v_has_active;

  if v_has_active then
    v_reasons := array_append(v_reasons, 'has_active_thesis');
  end if;

  -- BUS-65(d)/BUS-80: at least one COMPLETED thesis; when several exist,
  -- deterministically pick completed_at DESC, created_at DESC.
  select t.* into v_thesis
  from public.theses t
  where t.student_id = p_student_id and t.status = 'COMPLETED'
  order by t.completed_at desc nulls last, t.created_at desc
  limit 1;

  if not found then
    v_reasons := array_append(v_reasons, 'no_completed_thesis');
  end if;

  if array_length(v_reasons, 1) is null then
    v_status := 'ELIGIBLE';
  else
    v_status := 'NOT_ELIGIBLE';
  end if;

  return query select
    p_student_id,
    v_profile.academic_status,
    v_status,
    v_reasons,
    v_program.id, v_program.code, v_program.name,
    v_cohort.id, v_cohort.code,
    v_progress.required_credits_min::numeric, v_progress.elective_credits_min::numeric,
    coalesce(v_progress.required_credits_earned, 0)::numeric, coalesce(v_progress.elective_credits_earned, 0)::numeric,
    v_thesis.id, v_thesis.thesis_code, v_thesis.completed_at,
    v_has_active;
end;
$$;

comment on function public._compute_graduation_eligibility(uuid) is 'Internal helper (Batch 5, BUS-65/67/80). Not exposed to any application role -- see revoke below. Reuses public._student_progress verbatim; single source of truth for graduation eligibility, called by student_get_own_graduation_status (0043), staff_get_student_graduation_status (0044), staff_confirm_graduation (0045), and the dashboard/list RPCs (0046).';

-- BUS-78: helper never grantable to any application role, exactly like
-- _student_grades_rows / _student_progress in 0025.
revoke all on function public._compute_graduation_eligibility(uuid) from public;
revoke all on function public._compute_graduation_eligibility(uuid) from anon;
revoke all on function public._compute_graduation_eligibility(uuid) from authenticated;
