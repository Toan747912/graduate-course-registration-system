-- 0007_rls_policies.sql
-- Enable RLS on every public table and define explicit, narrow policies.
-- RLS is defense in depth only: the Express API independently verifies the JWT
-- and the caller's role before performing any write (see apps/api/src/middleware).
--
-- Helper functions are SECURITY DEFINER with a locked-down search_path so they can
-- read public.profiles without recursing through profiles' own RLS policies.

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_training_staff()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'TRAINING_STAFF'
  );
$$;

create or replace function public.is_active_student()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'STUDENT' and student_status = 'ACTIVE'
  );
$$;

-- Lock down execution of the three helpers above: only signed-in (authenticated)
-- callers may invoke them, never the anonymous/public role. Each function
-- already reads auth.uid() internally, so an anonymous caller gets no useful
-- result anyway, but revoking public execute closes off the surface entirely
-- rather than relying on that behavior.
revoke all on function public.current_role_name() from public;
grant execute on function public.current_role_name() to authenticated;

revoke all on function public.is_training_staff() from public;
grant execute on function public.is_training_staff() to authenticated;

revoke all on function public.is_active_student() from public;
grant execute on function public.is_active_student() to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own_or_staff
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_training_staff());

-- No insert/update/delete policy for regular clients: profile rows are created by
-- the on_auth_user_created trigger and adjusted only via the service-role seed
-- script, never directly by an authenticated user.

-- ---------------------------------------------------------------------------
-- semesters
-- ---------------------------------------------------------------------------
alter table public.semesters enable row level security;

create policy semesters_select_authenticated
  on public.semesters
  for select
  to authenticated
  using (true);

create policy semesters_manage_staff
  on public.semesters
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy semesters_update_staff
  on public.semesters
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- ---------------------------------------------------------------------------
-- registration_periods (managed by training staff; students read via RPC only)
-- ---------------------------------------------------------------------------
alter table public.registration_periods enable row level security;

create policy registration_periods_select_staff
  on public.registration_periods
  for select
  to authenticated
  using (public.is_training_staff());

create policy registration_periods_insert_staff
  on public.registration_periods
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy registration_periods_update_staff
  on public.registration_periods
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- ---------------------------------------------------------------------------
-- courses (reference data, read-only for all authenticated users)
-- ---------------------------------------------------------------------------
alter table public.courses enable row level security;

create policy courses_select_authenticated
  on public.courses
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- course_classes
-- Students may read classes that are visible for registration (ACTIVE class in
-- an open period). Staff may read/manage everything.
-- ---------------------------------------------------------------------------
alter table public.course_classes enable row level security;

create policy course_classes_select_staff
  on public.course_classes
  for select
  to authenticated
  using (public.is_training_staff());

create policy course_classes_select_student_visible
  on public.course_classes
  for select
  to authenticated
  using (
    public.is_active_student()
    and status = 'ACTIVE'
    and exists (
      select 1 from public.registration_periods rp
      where rp.id = course_classes.registration_period_id
        and now() between rp.opens_at and rp.closes_at
    )
  );

-- UC-07: a student must still see the class name/schedule of an enrollment in
-- their history even after the period closes or the class is cancelled, so this
-- policy is intentionally NOT gated on class status or period window — only on
-- the student owning an enrollments row for that class (any enrollment status).
create policy course_classes_select_own_enrollment_history
  on public.course_classes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      where e.course_class_id = course_classes.id
        and e.student_id = auth.uid()
    )
  );

create policy course_classes_insert_staff
  on public.course_classes
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy course_classes_update_staff
  on public.course_classes
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- ---------------------------------------------------------------------------
-- class_schedules (visibility mirrors the parent course_class)
-- ---------------------------------------------------------------------------
alter table public.class_schedules enable row level security;

create policy class_schedules_select_staff
  on public.class_schedules
  for select
  to authenticated
  using (public.is_training_staff());

create policy class_schedules_select_student_visible
  on public.class_schedules
  for select
  to authenticated
  using (
    public.is_active_student()
    and exists (
      select 1 from public.course_classes cc
      join public.registration_periods rp on rp.id = cc.registration_period_id
      where cc.id = class_schedules.course_class_id
        and cc.status = 'ACTIVE'
        and now() between rp.opens_at and rp.closes_at
    )
  );

-- UC-07: mirrors course_classes_select_own_enrollment_history above so the
-- schedule rows for a past/cancelled enrollment remain visible in history.
create policy class_schedules_select_own_enrollment_history
  on public.class_schedules
  for select
  to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      where e.course_class_id = class_schedules.course_class_id
        and e.student_id = auth.uid()
    )
  );

create policy class_schedules_insert_staff
  on public.class_schedules
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy class_schedules_update_staff
  on public.class_schedules
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- ---------------------------------------------------------------------------
-- enrollments
-- Read-only for clients (own rows for students, all rows for staff). All writes
-- happen exclusively through the SECURITY DEFINER RPC functions in later
-- migrations, so no insert/update/delete policy is granted here.
-- ---------------------------------------------------------------------------
alter table public.enrollments enable row level security;

create policy enrollments_select_own_or_staff
  on public.enrollments
  for select
  to authenticated
  using (student_id = auth.uid() or public.is_training_staff());

-- ---------------------------------------------------------------------------
-- enrollment_history
-- Same read pattern as enrollments; writes are RPC-only (and also blocked from
-- UPDATE/DELETE at the trigger level, see 0006_enrollment_history.sql).
-- ---------------------------------------------------------------------------
alter table public.enrollment_history enable row level security;

create policy enrollment_history_select_own_or_staff
  on public.enrollment_history
  for select
  to authenticated
  using (
    public.is_training_staff()
    or exists (
      select 1 from public.enrollments e
      where e.id = enrollment_history.enrollment_id
        and e.student_id = auth.uid()
    )
  );
