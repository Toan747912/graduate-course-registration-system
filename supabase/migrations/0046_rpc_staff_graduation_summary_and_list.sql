-- 0046_rpc_staff_graduation_summary_and_list.sql
-- Batch 5, UC-44/45, BUS-76/81. Both RPCs share the same filter parameters
-- (p_program_id, p_cohort_id, p_academic_status, p_eligibility_status) and
-- compute eligibility per-row via the shared helper (0042) -- no separate
-- formula. staff_list_graduation_status enforces BUS-81 (page_size default
-- 20, max 100, reject rather than silently clamp).

-- ---------------------------------------------------------------------------
-- Internal (not exposed): the filtered/eligibility-annotated row set shared
-- by both public RPCs below, so summary counts and list rows can never drift
-- apart on what a row's eligibility_status is.
-- ---------------------------------------------------------------------------
create or replace function public._graduation_filtered_rows(
  p_program_id uuid,
  p_cohort_id uuid,
  p_academic_status text,
  p_eligibility_status text
)
returns table (
  student_id uuid,
  student_code text,
  full_name text,
  program_id uuid,
  program_code text,
  program_name text,
  cohort_id uuid,
  cohort_code text,
  academic_status text,
  eligibility_status text,
  reasons text[],
  required_credits_min numeric,
  elective_credits_min numeric,
  required_credits_earned numeric,
  elective_credits_earned numeric,
  thesis_completed_at timestamptz,
  graduation_record_id uuid,
  confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may list graduation status';
  end if;

  return query
  select
    p.id,
    p.student_code,
    p.full_name,
    e.program_id,
    e.program_code,
    e.program_name,
    e.cohort_id,
    e.cohort_code,
    e.academic_status,
    e.eligibility_status,
    e.reasons,
    e.required_credits_min,
    e.elective_credits_min,
    e.required_credits_earned,
    e.elective_credits_earned,
    e.thesis_completed_at,
    gr.id,
    gr.confirmed_at
  from public.profiles p
  cross join lateral public._compute_graduation_eligibility(p.id) e
  left join public.graduation_records gr on gr.student_id = p.id
  where p.role = 'STUDENT'
    and (p_program_id is null or p.program_id = p_program_id)
    and (p_cohort_id is null or p.cohort_id = p_cohort_id)
    and (p_academic_status is null or p.academic_status = p_academic_status)
    and (p_eligibility_status is null or e.eligibility_status = p_eligibility_status)
  order by p.full_name asc, p.id asc;
end;
$$;

revoke all on function public._graduation_filtered_rows(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- staff_get_graduation_summary (UC-44)
-- ---------------------------------------------------------------------------
create or replace function public.staff_get_graduation_summary(
  p_program_id uuid default null,
  p_cohort_id uuid default null,
  p_academic_status text default null,
  p_eligibility_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total integer;
  v_studying integer;
  v_eligible integer;
  v_not_eligible integer;
  v_graduated integer;
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may view the graduation summary';
  end if;

  select
    count(*),
    count(*) filter (where academic_status = 'STUDYING'),
    count(*) filter (where eligibility_status = 'ELIGIBLE'),
    count(*) filter (where eligibility_status = 'NOT_ELIGIBLE'),
    count(*) filter (where academic_status = 'GRADUATED')
  into v_total, v_studying, v_eligible, v_not_eligible, v_graduated
  from public._graduation_filtered_rows(p_program_id, p_cohort_id, p_academic_status, p_eligibility_status);

  return jsonb_build_object(
    'total', v_total,
    'studying', v_studying,
    'eligible', v_eligible,
    'not_eligible', v_not_eligible,
    'graduated', v_graduated
  );
end;
$$;

comment on function public.staff_get_graduation_summary(uuid, uuid, text, text) is 'Staff-only (UC-44, BUS-76). Aggregate counts over the same filtered/eligibility row set used by staff_list_graduation_status.';

revoke all on function public.staff_get_graduation_summary(uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_get_graduation_summary(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_list_graduation_status (UC-45, BUS-81)
-- ---------------------------------------------------------------------------
create or replace function public.staff_list_graduation_status(
  p_program_id uuid default null,
  p_cohort_id uuid default null,
  p_academic_status text default null,
  p_eligibility_status text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_page integer := coalesce(p_page, 1);
  v_page_size integer := coalesce(p_page_size, 20);
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may list graduation status';
  end if;

  if v_page < 1 then
    raise exception 'page must be >= 1';
  end if;
  -- BUS-81: reject, never silently clamp.
  if v_page_size < 1 or v_page_size > 100 then
    raise exception 'page_size must be between 1 and 100';
  end if;

  select count(*) into v_total
  from public._graduation_filtered_rows(p_program_id, p_cohort_id, p_academic_status, p_eligibility_status);

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select * from public._graduation_filtered_rows(p_program_id, p_cohort_id, p_academic_status, p_eligibility_status)
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) r;

  return jsonb_build_object(
    'items', v_rows,
    'page', v_page,
    'page_size', v_page_size,
    'total', v_total
  );
end;
$$;

comment on function public.staff_list_graduation_status(uuid, uuid, text, text, integer, integer) is 'Staff-only (UC-45, BUS-81). page_size default 20, max 100, rejected (not clamped) beyond that.';

revoke all on function public.staff_list_graduation_status(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.staff_list_graduation_status(uuid, uuid, text, text, integer, integer) to authenticated;
