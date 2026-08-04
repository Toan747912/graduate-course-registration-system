-- 0033_rls_research_areas_advisors_theses.sql
-- RLS for the Batch 4 tables, shipped in the same batch as the tables
-- themselves (docs/BATCH_4_THESIS_ADVISOR_DESIGN.md section I). All four
-- tables (research_areas, advisors, theses, thesis_advisor_history) are
-- covered here, matching the design doc's decision to keep them together
-- since they were all created in the immediately preceding migrations of
-- this same batch.
--
-- Write policy: student-facing writes to theses (create/edit/cancel) are NOT
-- granted directly here -- they only ever go through SECURITY DEFINER RPCs
-- (0035-0037), which bypass RLS by design and re-check ownership/status
-- inside the function body. This mirrors the enrollment_grades approach from
-- Batch 3: RLS here exists for SELECT (and to guarantee no other write path
-- exists), not to carry the INSERT/UPDATE business rules themselves.

-- ---------------------------------------------------------------------------
-- research_areas
-- ---------------------------------------------------------------------------
alter table public.research_areas enable row level security;

create policy research_areas_select_staff
  on public.research_areas
  for select
  to authenticated
  using (public.is_training_staff());

-- Students may read only ACTIVE areas, to populate the picker when
-- creating/editing a PENDING_APPROVAL proposal (BUS-62).
create policy research_areas_select_student_active
  on public.research_areas
  for select
  to authenticated
  using (is_active = true);

create policy research_areas_insert_staff
  on public.research_areas
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy research_areas_update_staff
  on public.research_areas
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: research_areas are never hard-deleted (BUS-61).

-- ---------------------------------------------------------------------------
-- advisors
-- ---------------------------------------------------------------------------
alter table public.advisors enable row level security;

-- BUS-54: students have no direct SELECT on advisors; they only ever see the
-- current advisor's name embedded in the response of the student thesis RPCs
-- (0035), which are SECURITY DEFINER and read advisors internally.
create policy advisors_select_staff
  on public.advisors
  for select
  to authenticated
  using (public.is_training_staff());

create policy advisors_insert_staff
  on public.advisors
  for insert
  to authenticated
  with check (public.is_training_staff());

create policy advisors_update_staff
  on public.advisors
  for update
  to authenticated
  using (public.is_training_staff())
  with check (public.is_training_staff());

-- No delete policy: advisors are never hard-deleted (BUS-58 covers
-- deactivate instead).

-- ---------------------------------------------------------------------------
-- theses
-- ---------------------------------------------------------------------------
alter table public.theses enable row level security;

create policy theses_select_staff
  on public.theses
  for select
  to authenticated
  using (public.is_training_staff());

create policy theses_select_own
  on public.theses
  for select
  to authenticated
  using (student_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for students or staff: every write to
-- theses goes through a SECURITY DEFINER RPC (0035-0037), which bypasses RLS
-- and performs its own role/ownership/status checks. This guarantees there is
-- exactly one place BUS-38..51/56/57 are enforced.

-- ---------------------------------------------------------------------------
-- thesis_advisor_history
-- ---------------------------------------------------------------------------
alter table public.thesis_advisor_history enable row level security;

create policy thesis_advisor_history_select_staff
  on public.thesis_advisor_history
  for select
  to authenticated
  using (public.is_training_staff());

create policy thesis_advisor_history_select_own
  on public.thesis_advisor_history
  for select
  to authenticated
  using (
    exists (
      select 1 from public.theses t
      where t.id = thesis_advisor_history.thesis_id
        and t.student_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy for any client role: append-only, written
-- exclusively by the SECURITY DEFINER assignment RPCs in 0037 (BUS-53).
