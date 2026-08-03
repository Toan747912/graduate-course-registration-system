-- 0022_rls_enrollment_grades.sql
-- RLS for enrollment_grades (Batch 3), shipped in the same batch as the table
-- itself per the established convention (0007/0017: RLS ships with the table
-- it protects, never deferred).
--
-- Training staff: SELECT/INSERT/UPDATE on all rows (both DRAFT and
-- PUBLISHED). UPDATE only ever has effect on DRAFT rows in practice, because
-- the 0021 trigger blocks any UPDATE once grade_status = PUBLISHED — RLS
-- and the trigger are independent, deliberately overlapping layers.
--
-- Student: SELECT only their own rows, and only when grade_status =
-- 'PUBLISHED' (design doc decision #2 - DRAFT is internal staff data, must
-- not leak through RLS under any circumstance). No INSERT/UPDATE/DELETE
-- policy for students. No DELETE policy for anyone (no hard delete, matches
-- every other Batch 1-3 table).

alter table public.enrollment_grades enable row level security;

create policy enrollment_grades_select_staff
  on public.enrollment_grades
  for select
  to authenticated
  using (public.is_training_staff());

create policy enrollment_grades_select_own_published
  on public.enrollment_grades
  for select
  to authenticated
  using (
    grade_status = 'PUBLISHED'
    and exists (
      select 1 from public.enrollments e
      where e.id = enrollment_grades.enrollment_id
        and e.student_id = auth.uid()
    )
  );

create policy enrollment_grades_insert_staff
  on public.enrollment_grades
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy enrollment_grades_update_staff
  on public.enrollment_grades
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: enrollment_grades rows are never hard-deleted (append-
-- only history, matching enrollment_history/BUS-09 precedent).
