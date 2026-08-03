-- 0025_rpc_student_grades_and_progress.sql
-- student_get_own_grades / staff_get_student_grades / student_get_own_progress
-- / staff_get_student_progress (UC-24/25/26, BUS-33/34/35, design decision
-- #3). The two progress RPCs and the two grades-listing RPCs each share one
-- internal SECURITY DEFINER helper so student and staff never drift apart on
-- what counts as "published, passed, in-program" (design decision #3).

-- ---------------------------------------------------------------------------
-- _student_grades_rows: internal helper, not exposed directly. Returns every
-- enrollment_grades row (any grade_status) for one student, with enough
-- course/program context to know whether it is in the student's current
-- program (BUS-33) and whether it counts towards progress (published + PASS
-- + in-program). Callers filter grade_status themselves (student-facing RPC
-- keeps PUBLISHED only; staff-facing RPC keeps everything).
-- ---------------------------------------------------------------------------
create or replace function public._student_grades_rows(p_student_id uuid)
returns table (
  enrollment_id uuid,
  course_id uuid,
  course_code text,
  course_name text,
  credits integer,
  class_code text,
  semester_name text,
  final_score numeric,
  grade_status text,
  result_status text,
  published_at timestamptz,
  in_program boolean,
  requirement_type text,
  counts_towards_progress boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    e.id,
    c.id,
    c.code,
    c.name,
    c.credits,
    cc.class_code,
    s.name,
    g.final_score,
    g.grade_status,
    g.result_status,
    g.published_at,
    pc.id is not null as in_program,
    pc.requirement_type,
    (g.grade_status = 'PUBLISHED' and g.result_status = 'PASS' and pc.id is not null) as counts_towards_progress
  from public.enrollment_grades g
  join public.enrollments e on e.id = g.enrollment_id
  join public.course_classes cc on cc.id = e.course_class_id
  join public.courses c on c.id = cc.course_id
  join public.registration_periods rp on rp.id = cc.registration_period_id
  join public.semesters s on s.id = rp.semester_id
  left join public.profiles p on p.id = e.student_id
  left join public.program_courses pc on pc.program_id = p.program_id and pc.course_id = c.id
  where e.student_id = p_student_id
  order by g.published_at desc nulls last, e.created_at desc;
$$;

-- Internal helper: no auth/ownership check in the body (see caller comments
-- above) — safety depends entirely on nobody but SECURITY DEFINER callers
-- being able to EXECUTE it. Revoking from PUBLIC alone is not sufficient on
-- projects where `ALTER DEFAULT PRIVILEGES` grants EXECUTE directly to
-- `anon`/`authenticated` at creation time (that grant does not go through the
-- PUBLIC pseudo-role, so `revoke ... from public` does not touch it) — so
-- anon/authenticated are revoked explicitly here as well, verified live by
-- transaction test on 2026-08-02 (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md
-- section 8.2, P0). Never grant execute on this function to anon/authenticated.
revoke all on function public._student_grades_rows(uuid) from public;
revoke all on function public._student_grades_rows(uuid) from anon;
revoke all on function public._student_grades_rows(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- _student_progress: internal helper computing dedup'd (BUS-35) progress
-- credit totals grouped by requirement_type, for one student's current
-- program. Not exposed directly.
-- ---------------------------------------------------------------------------
create or replace function public._student_progress(p_student_id uuid)
returns table (
  program_id uuid,
  required_credits_min integer,
  elective_credits_min integer,
  required_credits_earned integer,
  elective_credits_earned integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_program_id uuid;
  v_required_min integer;
  v_elective_min integer;
  v_required_earned integer := 0;
  v_elective_earned integer := 0;
begin
  select pr.id, pr.required_credits_min, pr.elective_credits_min
  into v_program_id, v_required_min, v_elective_min
  from public.profiles p
  join public.programs pr on pr.id = p.program_id
  where p.id = p_student_id;

  if v_program_id is null then
    return query select null::uuid, null::integer, null::integer, 0, 0;
    return;
  end if;

  -- BUS-35: a course's credits are counted at most once, as soon as at least
  -- one PUBLISHED+PASS attempt exists for it, regardless of other attempts.
  select
    coalesce(sum(credits) filter (where requirement_type = 'REQUIRED'), 0),
    coalesce(sum(credits) filter (where requirement_type = 'ELECTIVE'), 0)
  into v_required_earned, v_elective_earned
  from (
    select distinct on (course_id) course_id, credits, requirement_type
    from public._student_grades_rows(p_student_id)
    where counts_towards_progress
  ) distinct_courses;

  return query select v_program_id, v_required_min, v_elective_min, v_required_earned, v_elective_earned;
end;
$$;

-- Same rationale as _student_grades_rows above: explicit revoke from
-- anon/authenticated, not just public. Never grant execute on this function
-- to anon/authenticated.
revoke all on function public._student_progress(uuid) from public;
revoke all on function public._student_progress(uuid) from anon;
revoke all on function public._student_progress(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- student_get_own_grades: PUBLISHED-only, own rows (UC-25). Filters on
-- p_student_id = auth.uid() in addition to RLS on the underlying table -
-- deliberate second layer of defense (design decision #2).
-- ---------------------------------------------------------------------------
create or replace function public.student_get_own_grades()
returns table (
  enrollment_id uuid,
  course_code text,
  course_name text,
  credits integer,
  class_code text,
  semester_name text,
  final_score numeric,
  result_status text,
  published_at timestamptz,
  in_program boolean,
  counts_towards_progress boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
  select r.enrollment_id, r.course_code, r.course_name, r.credits, r.class_code, r.semester_name,
         r.final_score, r.result_status, r.published_at, r.in_program, r.counts_towards_progress
  from public._student_grades_rows(auth.uid()) r
  where r.grade_status = 'PUBLISHED';
end;
$$;

comment on function public.student_get_own_grades() is 'Any authenticated student. Returns only the caller''s own PUBLISHED grades; DRAFT never leaves this function (design decision #2, UC-25).';

revoke all on function public.student_get_own_grades() from public;
revoke all on function public.student_get_own_grades() from anon;
grant execute on function public.student_get_own_grades() to authenticated;

-- ---------------------------------------------------------------------------
-- staff_get_student_grades: staff view of one student's full grade history,
-- both DRAFT and PUBLISHED (J.1).
-- ---------------------------------------------------------------------------
create or replace function public.staff_get_student_grades(p_student_id uuid)
returns table (
  enrollment_id uuid,
  course_code text,
  course_name text,
  credits integer,
  class_code text,
  semester_name text,
  final_score numeric,
  grade_status text,
  result_status text,
  published_at timestamptz,
  in_program boolean,
  counts_towards_progress boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may view a student''s grades';
  end if;

  return query
  select r.enrollment_id, r.course_code, r.course_name, r.credits, r.class_code, r.semester_name,
         r.final_score, r.grade_status, r.result_status, r.published_at, r.in_program, r.counts_towards_progress
  from public._student_grades_rows(p_student_id) r;
end;
$$;

comment on function public.staff_get_student_grades(uuid) is 'Staff-only. Full grade history (DRAFT and PUBLISHED) of any student.';

revoke all on function public.staff_get_student_grades(uuid) from public;
revoke all on function public.staff_get_student_grades(uuid) from anon;
grant execute on function public.staff_get_student_grades(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- student_get_own_progress (UC-26).
-- ---------------------------------------------------------------------------
create or replace function public.student_get_own_progress()
returns table (
  program_id uuid,
  required_credits_min integer,
  elective_credits_min integer,
  required_credits_earned integer,
  elective_credits_earned integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query select * from public._student_progress(auth.uid());
end;
$$;

comment on function public.student_get_own_progress() is 'Any authenticated student. Own cumulative progress-credit totals (BUS-33/34/35). program_id null means the student has not been assigned a program yet.';

revoke all on function public.student_get_own_progress() from public;
revoke all on function public.student_get_own_progress() from anon;
grant execute on function public.student_get_own_progress() to authenticated;

-- ---------------------------------------------------------------------------
-- staff_get_student_progress (design decision #3): staff-only, reuses the
-- exact same _student_progress helper as the student-facing RPC.
-- ---------------------------------------------------------------------------
create or replace function public.staff_get_student_progress(p_student_id uuid)
returns table (
  program_id uuid,
  required_credits_min integer,
  elective_credits_min integer,
  required_credits_earned integer,
  elective_credits_earned integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may view a student''s progress';
  end if;

  return query select * from public._student_progress(p_student_id);
end;
$$;

comment on function public.staff_get_student_progress(uuid) is 'Staff-only. Reuses _student_progress, the exact same logic student_get_own_progress uses, for an arbitrary student (design decision #3).';

revoke all on function public.staff_get_student_progress(uuid) from public;
revoke all on function public.staff_get_student_progress(uuid) from anon;
grant execute on function public.staff_get_student_progress(uuid) to authenticated;
