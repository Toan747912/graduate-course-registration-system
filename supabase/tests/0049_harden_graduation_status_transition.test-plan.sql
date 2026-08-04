-- 0049_harden_graduation_status_transition.test-plan.sql
--
-- CANNOT EXECUTE LOCALLY, REQUIRES TRANSACTION TEST PHASE.
-- This repository has no pgTAP or other SQL test framework installed (only
-- supabase/migrations/*.sql plus code-level assertions in
-- apps/api/src/**/*.test.ts that read migration file text -- there is no
-- runtime SQL test harness for this project). No DB connection, Cloud CLI,
-- psql, or `supabase db push` was run to produce or verify this file, per
-- the hardening task's absolute constraints. This file is a BEGIN...ROLLBACK
-- script to run by hand (or via CI's real transaction test phase) against a
-- non-production Postgres instance that already has 0000-0049 applied.
--
-- Covers Batch 5 Pre-Apply Security Review Finding #1 (P1) remediation:
-- docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md, addendum 2026-08-04.

begin;

-- Fixtures: adjust ids/columns to match actual seed/reference data available
-- in the target environment (programs/cohorts requiring FKs are omitted
-- here for brevity -- use existing seeded rows or insert minimal parents
-- first). Replace :student_a, :student_b, :staff_id with real uuids in the
-- target DB, or wrap in DO blocks that look them up/insert fixtures first.

-- ---------------------------------------------------------------------------
-- Case 1: staff_update_student rejects p_academic_status='GRADUATED' on a
-- non-graduated student, WITHOUT creating a graduation_records row.
-- Expect: jsonb ->> 'success' = 'false', reason mentions "Xác nhận tốt nghiệp".
-- ---------------------------------------------------------------------------
-- select public.staff_update_student(:student_a, null, 'Test A', null, null, 'GRADUATED');
-- select count(*) from public.graduation_records where student_id = :student_a; -- expect 0

-- ---------------------------------------------------------------------------
-- Case 2: staff_update_student rejects changing the status of a student whose
-- academic_status is already GRADUATED (set up via staff_confirm_graduation
-- in the fixture, not via direct UPDATE).
-- Expect: success=false, reason mentions "học viên đã tốt nghiệp".
-- ---------------------------------------------------------------------------
-- select public.staff_update_student(:graduated_student, null, 'Test B', null, null, 'STUDYING');
-- select academic_status from public.profiles where id = :graduated_student; -- expect unchanged = 'GRADUATED'

-- ---------------------------------------------------------------------------
-- Case 3: staff_update_student still allows normal transitions
-- (STUDYING<->SUSPENDED<->WITHDRAWN) for a non-graduated student.
-- Expect: success=true.
-- ---------------------------------------------------------------------------
-- select public.staff_update_student(:student_a, null, 'Test A', null, null, 'SUSPENDED');

-- ---------------------------------------------------------------------------
-- Case 4: trigger backstop fires even bypassing staff_update_student -- a
-- direct UPDATE (e.g. as service_role, bypassing RLS) attempting to set
-- academic_status='GRADUATED' without a graduation_records row must still be
-- rejected by aaa_profiles_graduation_transition_guard / equivalent trigger
-- name actually used in 0049 (see file header for the exact function/trigger
-- name landed in this migration).
-- Expect: raises exception, no row committed.
-- ---------------------------------------------------------------------------
-- update public.profiles set academic_status = 'GRADUATED' where id = :student_a; -- expect exception

-- ---------------------------------------------------------------------------
-- Case 5: trigger backstop blocks reverting an already-GRADUATED student even
-- via direct UPDATE bypassing every RPC.
-- Expect: raises exception, no row committed.
-- ---------------------------------------------------------------------------
-- update public.profiles set academic_status = 'STUDYING' where id = :graduated_student; -- expect exception

-- ---------------------------------------------------------------------------
-- Case 6: GRADUATED -> GRADUATED no-op (e.g. re-saving unrelated fields via
-- staff_update_student on an already-graduated profile) is rejected at the
-- RPC layer with a clear message (staff_update_student unconditionally
-- rejects when current status is GRADUATED, regardless of target value) --
-- confirm this is the intended behavior for this codebase (RPC is stricter
-- than the trigger, which explicitly allows the no-op case for any other
-- future direct-UPDATE caller).
-- ---------------------------------------------------------------------------
-- select public.staff_update_student(:graduated_student, null, 'Test C', null, null, 'GRADUATED');
-- -- expect success=false (RPC rejects ANY change attempt on a graduated student,
-- -- including a same-value one, since it checks p_academic_status='GRADUATED' first)

-- ---------------------------------------------------------------------------
-- Case 7: staff_confirm_graduation (0045) still succeeds end-to-end and is
-- unaffected by the new trigger (graduation_records insert happens before
-- the profiles UPDATE in the same function body/transaction, so the trigger's
-- "exists graduation_records" check passes).
-- Expect: success=true, profiles.academic_status = 'GRADUATED',
-- graduation_records has exactly 1 row for the student.
-- ---------------------------------------------------------------------------
-- select public.staff_confirm_graduation(:eligible_student);

-- ---------------------------------------------------------------------------
-- Case 8: RBAC -- non-staff/anon cannot call staff_update_student or trigger
-- the guard's SELECT on graduation_records in a way that leaks data (the
-- trigger runs as the same role as the UPDATE statement itself under
-- SECURITY INVOKER; confirm it does not grant any new read capability to
-- a role that could not already read graduation_records, since the guard
-- only ever runs as part of an UPDATE the caller was already otherwise
-- authorized -- or not -- to perform via RLS on profiles).
-- ---------------------------------------------------------------------------
-- set local role authenticated; -- (without a matching JWT claim / RLS bypass)
-- update public.profiles set academic_status = 'STUDYING' where id = :student_a;
-- -- expect: blocked by existing profiles RLS/RPC-only convention exactly as
-- -- before 0049 (0049 does not change who may attempt the UPDATE, only what
-- -- happens once an UPDATE is attempted)

rollback;

-- Post-rollback cleanup verification (run outside the transaction above):
-- select count(*) from public.graduation_records where student_id in (:student_a, :graduated_student, :eligible_student); -- expect pre-test count
-- select academic_status, student_status from public.profiles where id in (:student_a, :graduated_student, :eligible_student); -- expect pre-test values
