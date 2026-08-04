-- 0041_rls_graduation_records.sql
-- Batch 5, mirrors the 0033 pattern for public.theses: SELECT-only policies,
-- no INSERT/UPDATE/DELETE policy for any application role. The single write
-- path is staff_confirm_graduation (0045), a SECURITY DEFINER RPC that
-- bypasses RLS and performs its own checks. This is the RLS half of the
-- "graduation_records is immutable once written" guarantee -- the other half
-- is simply that no UPDATE/DELETE RPC is ever written for this table.

alter table public.graduation_records enable row level security;

create policy graduation_records_select_staff
  on public.graduation_records
  for select
  to authenticated
  using (public.is_training_staff());

create policy graduation_records_select_own
  on public.graduation_records
  for select
  to authenticated
  using (student_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for any role: only staff_confirm_graduation
-- (SECURITY DEFINER) may write, and it never updates/deletes.
