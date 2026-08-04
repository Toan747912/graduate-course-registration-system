-- 0038_rpc_revoke_anon_batch4.sql
-- Final ACL sweep for Batch 4, applying the convention hardening learned in
-- Batch 3 (docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md, docs/BATCH_2_HARDENING
-- _PRE_APPLY_REVIEW.md, migration 0020): every public-facing RPC added in
-- this batch (0031, 0034-0037) already carries its own inline
-- revoke(public)+revoke(anon)+grant(authenticated) block. This migration is
-- an idempotent re-assertion executed last, in its own file, so a single
-- migration can be pointed to as "the batch 4 ACL sweep" and re-run safely if
-- any of the earlier per-file grants were ever missed or reordered by a
-- future edit. Re-running `revoke`/`grant` on an already-correct ACL is a
-- no-op in Postgres.

-- research_areas / advisors catalog RPCs (0034)
revoke all on function public.staff_create_research_area(text, text) from public, anon;
grant execute on function public.staff_create_research_area(text, text) to authenticated;
revoke all on function public.staff_update_research_area(uuid, text, text, boolean) from public, anon;
grant execute on function public.staff_update_research_area(uuid, text, text, boolean) to authenticated;
revoke all on function public.staff_deactivate_research_area(uuid) from public, anon;
grant execute on function public.staff_deactivate_research_area(uuid) to authenticated;
revoke all on function public.staff_list_research_areas() from public, anon;
grant execute on function public.staff_list_research_areas() to authenticated;
revoke all on function public.staff_create_advisor(text, text, text, integer) from public, anon;
grant execute on function public.staff_create_advisor(text, text, text, integer) to authenticated;
revoke all on function public.staff_update_advisor(uuid, text, text, integer) from public, anon;
grant execute on function public.staff_update_advisor(uuid, text, text, integer) to authenticated;
revoke all on function public.staff_deactivate_advisor(uuid) from public, anon;
grant execute on function public.staff_deactivate_advisor(uuid) to authenticated;
revoke all on function public.staff_list_advisors() from public, anon;
grant execute on function public.staff_list_advisors() to authenticated;

-- student thesis proposal RPCs (0035)
revoke all on function public.student_check_thesis_eligibility() from public, anon;
grant execute on function public.student_check_thesis_eligibility() to authenticated;
revoke all on function public.student_create_thesis_proposal(text, text, uuid) from public, anon;
grant execute on function public.student_create_thesis_proposal(text, text, uuid) to authenticated;
revoke all on function public.student_update_own_thesis_proposal(uuid, text, text, uuid) from public, anon;
grant execute on function public.student_update_own_thesis_proposal(uuid, text, text, uuid) to authenticated;
revoke all on function public.student_cancel_own_thesis(uuid, text) from public, anon;
grant execute on function public.student_cancel_own_thesis(uuid, text) to authenticated;
revoke all on function public.student_get_own_theses() from public, anon;
grant execute on function public.student_get_own_theses() to authenticated;
revoke all on function public.student_get_own_thesis(uuid) from public, anon;
grant execute on function public.student_get_own_thesis(uuid) to authenticated;

-- staff review RPCs (0036)
revoke all on function public.staff_list_theses(text) from public, anon;
grant execute on function public.staff_list_theses(text) to authenticated;
revoke all on function public.staff_get_thesis(uuid) from public, anon;
grant execute on function public.staff_get_thesis(uuid) to authenticated;
revoke all on function public.staff_approve_thesis(uuid) from public, anon;
grant execute on function public.staff_approve_thesis(uuid) to authenticated;
revoke all on function public.staff_reject_thesis(uuid, text) from public, anon;
grant execute on function public.staff_reject_thesis(uuid, text) to authenticated;

-- advisor assignment lifecycle RPCs (0037)
revoke all on function public.staff_assign_advisor(uuid, uuid) from public, anon;
grant execute on function public.staff_assign_advisor(uuid, uuid) to authenticated;
revoke all on function public.staff_change_advisor(uuid, uuid, text) from public, anon;
grant execute on function public.staff_change_advisor(uuid, uuid, text) to authenticated;
revoke all on function public.staff_cancel_thesis(uuid, text) from public, anon;
grant execute on function public.staff_cancel_thesis(uuid, text) to authenticated;
revoke all on function public.staff_complete_thesis(uuid) from public, anon;
grant execute on function public.staff_complete_thesis(uuid) to authenticated;
revoke all on function public.staff_get_thesis_advisor_history(uuid) from public, anon;
grant execute on function public.staff_get_thesis_advisor_history(uuid) to authenticated;
revoke all on function public.student_get_own_thesis_advisor_history(uuid) from public, anon;
grant execute on function public.student_get_own_thesis_advisor_history(uuid) to authenticated;

-- internal helper trigger function (0031): never callable directly by any
-- client role, kept revoked from public/anon/authenticated (matches
-- public._student_grades_rows / public._student_progress convention).
revoke all on function public.advisors_block_deactivate_when_in_progress() from public, anon, authenticated;

-- internal helper trigger functions added to harden findings F-1/F-2 (0030,
-- 0032): same convention -- never callable directly by any client role.
revoke all on function public.theses_block_inactive_advisor_in_progress() from public, anon, authenticated;
revoke all on function public.theses_block_inactive_research_area() from public, anon, authenticated;
revoke all on function public.theses_require_cancellation_reason() from public, anon, authenticated;
revoke all on function public.thesis_advisor_history_guard() from public, anon, authenticated;
