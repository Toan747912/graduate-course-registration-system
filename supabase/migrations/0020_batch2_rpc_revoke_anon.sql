-- 0020_batch2_rpc_revoke_anon.sql
-- Batch 2 hardening (see docs/BATCH_2_HARDENING_PRE_APPLY_REVIEW.md): the four
-- staff/student profile RPCs added in 0019_rpc_student_profiles.sql carry an
-- implicit `anon=EXECUTE` grant from Supabase's schema-level default
-- privileges (`ALTER DEFAULT PRIVILEGES ... GRANT ... TO anon, authenticated,
-- service_role`), applied at function-creation time before 0019's own
-- `revoke all ... from public` ran — that revoke targets the PUBLIC
-- pseudo-role, not the `anon` role directly, so it never touched this grant.
--
-- Each RPC already rejects unauthenticated/unauthorized callers internally
-- (auth.uid() is null / is_training_staff() checks), so this was not an
-- exploitable bypass, but the standing `anon` grant is unnecessary attack
-- surface for a set of RPCs that only ever make sense for an authenticated
-- caller. This migration only touches grants; no function body/logic is
-- changed, and Batch 1 RPCs (register_for_class, create_course_class, etc.)
-- and all other schema objects are left untouched.
--
-- Signatures below match the exact `create or replace function` signatures
-- in 0019_rpc_student_profiles.sql.

revoke execute on function public.staff_list_students(uuid, uuid, text, text) from anon;
revoke execute on function public.staff_get_student(uuid) from anon;
revoke execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) from anon;
revoke execute on function public.student_get_own_profile() from anon;

grant execute on function public.staff_list_students(uuid, uuid, text, text) to authenticated;
grant execute on function public.staff_get_student(uuid) to authenticated;
grant execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.student_get_own_profile() to authenticated;
