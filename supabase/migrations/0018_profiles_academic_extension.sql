-- 0018_profiles_academic_extension.sql
-- Batch 2 of the academic-management expansion
-- (docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md): student profile fields
-- (student_code, program_id, cohort_id, academic_status) on public.profiles.
--
-- Design decisions (see docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md, Batch 2):
--   - email is never copied onto profiles; it stays exclusively in auth.users
--     and is read by staff only through the SECURITY DEFINER RPCs added in
--     0019_rpc_student_profiles.sql.
--   - academic_status becomes the business source of truth for a student's
--     study status. student_status (0001) is kept only for backward
--     compatibility with is_active_student()/existing RPCs and is now
--     one-way synced FROM academic_status (never the other way).
--   - program_id/cohort_id assignment is allowed the first time regardless of
--     enrollment history; once assigned, it is locked as soon as the student
--     has any enrollments row (grade/thesis checks are left as an extension
--     point for a later batch, see the trigger comment below).

-- ---------------------------------------------------------------------------
-- 1. Add columns (nullable first; backfill before adding check constraints).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column student_code text,
  add column program_id uuid references public.programs (id),
  add column cohort_id uuid references public.cohorts (id),
  add column academic_status text;

comment on column public.profiles.student_code is 'Staff-entered unique student code. Manual data entry (no auto-generation), students only.';
comment on column public.profiles.program_id is 'Assigned graduate program. Nullable until staff assigns it; immutable once the student has enrollment history (see profiles_academic_guard trigger).';
comment on column public.profiles.cohort_id is 'Assigned cohort/khoa; must belong to program_id (enforced by trigger, not FK, since a cross-table conditional check cannot be expressed as a plain foreign key).';
comment on column public.profiles.academic_status is 'Business source of truth for study status (STUDYING/SUSPENDED/GRADUATED/WITHDRAWN). One-way synced onto student_status for backward compatibility; never the reverse.';

-- ---------------------------------------------------------------------------
-- 2. Backfill academic_status from the legacy student_status for every
--    existing student row so no student is left with a null academic_status
--    once the NOT-NULL-for-students check constraint is added below.
-- ---------------------------------------------------------------------------
update public.profiles
set academic_status = case student_status
  when 'ACTIVE' then 'STUDYING'
  when 'INACTIVE' then 'SUSPENDED'
end
where role = 'STUDENT';

-- ---------------------------------------------------------------------------
-- 3. Constraints.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_academic_status_check
    check (academic_status in ('STUDYING', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN'));

-- Mirrors the existing profiles_student_status_required_for_students pattern:
-- students must have a status, staff must not.
alter table public.profiles
  add constraint profiles_academic_status_required_for_students
    check (
      (role = 'STUDENT' and academic_status is not null)
      or (role = 'TRAINING_STAFF' and academic_status is null)
    );

-- student_code: staff only, unique when present. Partial unique index (not a
-- plain unique constraint) so multiple NULLs (unassigned students, and every
-- TRAINING_STAFF row) are allowed.
create unique index profiles_student_code_unique
  on public.profiles (student_code)
  where student_code is not null;

alter table public.profiles
  add constraint profiles_student_code_only_for_students
    check (role = 'STUDENT' or student_code is null);

alter table public.profiles
  add constraint profiles_cohort_only_for_students
    check (role = 'STUDENT' or cohort_id is null);

alter table public.profiles
  add constraint profiles_program_only_for_students
    check (role = 'STUDENT' or program_id is null);

-- A cohort cannot be set without its program (partial assignment not allowed).
alter table public.profiles
  add constraint profiles_cohort_requires_program
    check (cohort_id is null or program_id is not null);

create index profiles_program_idx on public.profiles (program_id);
create index profiles_cohort_idx on public.profiles (cohort_id);
create index profiles_academic_status_idx on public.profiles (academic_status);

-- ---------------------------------------------------------------------------
-- 4. Guard trigger: cohort/program compatibility, one-way status sync, and
--    the assignment-lock rule.
--
-- Extension point for a later batch: once enrollment_grades/theses tables
-- exist, add `or exists (select 1 from public.enrollment_grades where
-- student_id = old.id)` / `... theses ...` to the has_history check below so
-- the lock also covers grade and thesis records, per
-- docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md BUS-26. Batch 2 only has
-- enrollments to check.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_academic_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_cohort_program_id uuid;
  v_has_history boolean;
begin
  -- Cohort must belong to the assigned program.
  if new.cohort_id is not null then
    select program_id into v_cohort_program_id
    from public.cohorts
    where id = new.cohort_id;

    if v_cohort_program_id is null then
      raise exception 'Khóa học không tồn tại';
    end if;

    if v_cohort_program_id is distinct from new.program_id then
      raise exception 'Khóa học không thuộc chương trình đào tạo đã chọn';
    end if;
  end if;

  -- Assignment-lock rule (BUS-26): first assignment is always allowed. Once
  -- program_id has been set, changing program_id or cohort_id is blocked as
  -- soon as the student has any enrollment history.
  if tg_op = 'UPDATE' then
    if old.program_id is not null
       and (new.program_id is distinct from old.program_id or new.cohort_id is distinct from old.cohort_id) then
      select exists (select 1 from public.enrollments where student_id = old.id) into v_has_history;

      if v_has_history then
        raise exception 'Không thể thay đổi chương trình/khóa học vì học viên đã có lịch sử đăng ký học phần';
      end if;
    end if;
  end if;

  -- One-way sync academic_status -> student_status (BUS-25). Never the
  -- reverse: a direct write to student_status by legacy code paths does not
  -- affect academic_status.
  if new.role = 'STUDENT' then
    new.student_status := case when new.academic_status = 'STUDYING' then 'ACTIVE' else 'INACTIVE' end;
  end if;

  return new;
end;
$$;

comment on function public.profiles_academic_guard() is 'BEFORE INSERT/UPDATE guard on profiles: enforces cohort-program compatibility, locks program/cohort reassignment once enrollment history exists (BUS-26), and one-way syncs academic_status onto student_status (BUS-25).';

create trigger profiles_academic_guard
  before insert or update on public.profiles
  for each row
  execute function public.profiles_academic_guard();

-- ---------------------------------------------------------------------------
-- 5. handle_new_auth_user (0001, hardened in 0014) must also seed
--    academic_status now that it is required for every STUDENT row, or new
--    signups would violate profiles_academic_status_required_for_students.
--    Re-created here (not edited in place) following the same convention as
--    0014_harden_handle_new_auth_user_search_path.sql.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name, role, student_status, academic_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'STUDENT',
    'ACTIVE',
    'STUDYING'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
