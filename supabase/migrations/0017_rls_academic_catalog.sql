-- 0017_rls_academic_catalog.sql
-- RLS for the Batch 1 academic-management catalog tables (programs, cohorts,
-- program_courses), shipped in the same batch as the tables themselves per
-- docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md (RLS ships with every batch,
-- not deferred to a later "hardening" batch).
--
-- Batch 1 decision: Training Staff manage all rows; Student has no read
-- access to these catalog tables yet (deferred to a later batch that wires up
-- student-facing "my program" screens against profiles.program_id/cohort_id,
-- which do not exist until Batch 2). This is narrower than is strictly
-- necessary functionally, but matches the explicit Batch 1 scope decision.

alter table public.programs enable row level security;

create policy programs_select_staff
  on public.programs
  for select
  to authenticated
  using (public.is_training_staff());

create policy programs_insert_staff
  on public.programs
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy programs_update_staff
  on public.programs
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: programs are never hard-deleted in the MVP.

alter table public.cohorts enable row level security;

create policy cohorts_select_staff
  on public.cohorts
  for select
  to authenticated
  using (public.is_training_staff());

create policy cohorts_insert_staff
  on public.cohorts
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy cohorts_update_staff
  on public.cohorts
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: cohorts are never hard-deleted in the MVP.

alter table public.program_courses enable row level security;

create policy program_courses_select_staff
  on public.program_courses
  for select
  to authenticated
  using (public.is_training_staff());

create policy program_courses_insert_staff
  on public.program_courses
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy program_courses_update_staff
  on public.program_courses
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: program_courses assignments are never hard-deleted in the MVP.
