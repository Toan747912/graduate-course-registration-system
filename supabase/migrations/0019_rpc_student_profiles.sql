-- 0019_rpc_student_profiles.sql
-- Batch 2: staff-facing student profile RPCs. All of them read auth.users
-- internally (never exposed to clients directly) and return only the columns
-- the UI needs. No RLS SELECT/UPDATE policy is added on public.profiles for
-- these new academic columns: profiles writes stay RPC-only (matching the
-- existing convention - see 0007_rls_policies.sql's comment on profiles), and
-- staff already has SELECT on profiles via profiles_select_own_or_staff
-- (0007), so listing without email works through the client directly; these
-- RPCs exist specifically to add the email column safely.

-- ---------------------------------------------------------------------------
-- staff_list_students: list/search students for the staff "Học viên" screen.
-- All filters are optional; null means "no filter".
-- ---------------------------------------------------------------------------
create or replace function public.staff_list_students(
  p_program_id uuid default null,
  p_cohort_id uuid default null,
  p_academic_status text default null,
  p_search text default null
)
returns table (
  id uuid,
  student_code text,
  full_name text,
  email text,
  program_id uuid,
  cohort_id uuid,
  academic_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may list students';
  end if;

  return query
  select
    p.id,
    p.student_code,
    p.full_name,
    u.email::text,
    p.program_id,
    p.cohort_id,
    p.academic_status,
    p.created_at,
    p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'STUDENT'
    and (p_program_id is null or p.program_id = p_program_id)
    and (p_cohort_id is null or p.cohort_id = p_cohort_id)
    and (p_academic_status is null or p.academic_status = p_academic_status)
    and (
      p_search is null or btrim(p_search) = ''
      or p.student_code ilike '%' || p_search || '%'
      or p.full_name ilike '%' || p_search || '%'
      or u.email ilike '%' || p_search || '%'
    )
  order by p.created_at desc;
end;
$$;

comment on function public.staff_list_students(uuid, uuid, text, text) is 'Staff-only. Lists STUDENT profiles with email read from auth.users; never exposes auth.users directly to clients.';

revoke all on function public.staff_list_students(uuid, uuid, text, text) from public;
grant execute on function public.staff_list_students(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_get_student: single-student detail (staff "chi tiết học viên" screen).
-- ---------------------------------------------------------------------------
create or replace function public.staff_get_student(p_student_id uuid)
returns table (
  id uuid,
  student_code text,
  full_name text,
  email text,
  program_id uuid,
  cohort_id uuid,
  academic_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_training_staff() then
    raise exception 'only training staff may view student details';
  end if;

  return query
  select
    p.id,
    p.student_code,
    p.full_name,
    u.email::text,
    p.program_id,
    p.cohort_id,
    p.academic_status,
    p.created_at,
    p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_student_id
    and p.role = 'STUDENT';
end;
$$;

comment on function public.staff_get_student(uuid) is 'Staff-only. Single STUDENT profile with email read from auth.users.';

revoke all on function public.staff_get_student(uuid) from public;
grant execute on function public.staff_get_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_update_student: staff-only edit of the academic fields chosen for
-- Batch 2 (student_code, full_name, program_id, cohort_id, academic_status).
-- Never touches role or student_status directly - student_status is only
-- ever set by the profiles_academic_guard trigger (0018), one-way from
-- academic_status. Expected/validatable failures (duplicate code, cohort not
-- in program, locked reassignment, not found) are returned as
-- jsonb {success:false, reason}; unauthenticated/unauthorized still raise,
-- matching the create_course_class convention (0012).
-- ---------------------------------------------------------------------------
create or replace function public.staff_update_student(
  p_student_id uuid,
  p_student_code text,
  p_full_name text,
  p_program_id uuid,
  p_cohort_id uuid,
  p_academic_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_training_staff() then
    raise exception 'only training staff may update student profiles';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'Họ tên không được để trống');
  end if;

  if p_academic_status is null or p_academic_status not in ('STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN') then
    return jsonb_build_object('success', false, 'reason', 'Trạng thái học tập không hợp lệ');
  end if;

  if not exists (select 1 from public.profiles where id = p_student_id and role = 'STUDENT') then
    return jsonb_build_object('success', false, 'reason', 'Không tìm thấy học viên');
  end if;

  if p_program_id is not null and not exists (select 1 from public.programs where id = p_program_id) then
    return jsonb_build_object('success', false, 'reason', 'Chương trình đào tạo không tồn tại');
  end if;

  if p_cohort_id is not null and not exists (select 1 from public.cohorts where id = p_cohort_id) then
    return jsonb_build_object('success', false, 'reason', 'Khóa học không tồn tại');
  end if;

  begin
    update public.profiles
    set
      student_code = nullif(btrim(p_student_code), ''),
      full_name = btrim(p_full_name),
      program_id = p_program_id,
      cohort_id = p_cohort_id,
      academic_status = p_academic_status
    where id = p_student_id
    returning * into v_profile;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'reason', 'Mã học viên đã tồn tại');
    when sqlstate 'P0001' then
      -- Catches the profiles_academic_guard trigger's raised exceptions
      -- (cohort/program mismatch, locked reassignment) and returns them as
      -- the same jsonb {success:false, reason} shape as every other
      -- validatable failure, instead of surfacing a raw Postgres error.
      return jsonb_build_object('success', false, 'reason', sqlerrm);
  end;

  return jsonb_build_object(
    'success', true,
    'id', v_profile.id,
    'student_code', v_profile.student_code,
    'full_name', v_profile.full_name,
    'program_id', v_profile.program_id,
    'cohort_id', v_profile.cohort_id,
    'academic_status', v_profile.academic_status
  );
end;
$$;

comment on function public.staff_update_student(uuid, text, text, uuid, uuid, text) is 'Staff-only. Updates the Batch 2 academic profile fields; never role or student_status directly. Business-rule failures (duplicate code, cohort/program mismatch, locked reassignment) come back as jsonb {success:false, reason}.';

revoke all on function public.staff_update_student(uuid, text, text, uuid, uuid, text) from public;
grant execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- student_get_own_profile: the student's own profile, with email from the
-- caller's own auth.users row (never another user's).
-- ---------------------------------------------------------------------------
create or replace function public.student_get_own_profile()
returns table (
  id uuid,
  student_code text,
  full_name text,
  email text,
  program_id uuid,
  cohort_id uuid,
  academic_status text,
  created_at timestamptz,
  updated_at timestamptz
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
  select
    p.id,
    p.student_code,
    p.full_name,
    u.email::text,
    p.program_id,
    p.cohort_id,
    p.academic_status,
    p.created_at,
    p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid()
    and p.role = 'STUDENT';
end;
$$;

comment on function public.student_get_own_profile() is 'Any authenticated student. Returns only the caller''s own profile row plus their own email from auth.users.';

revoke all on function public.student_get_own_profile() from public;
grant execute on function public.student_get_own_profile() to authenticated;
