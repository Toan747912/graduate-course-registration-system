-- 0048_rpc_revoke_anon_batch5.sql
-- Final ACL sweep for Batch 5 (BUS-78), same idempotent re-assertion
-- convention as migrations 0020/0038: every RPC below already carries its
-- own inline revoke/grant block in its defining migration; this file is the
-- single place to point to as "the batch 5 ACL sweep" and is safe to re-run.

-- graduation status RPCs (0043, 0044)
revoke all on function public.student_get_own_graduation_status() from public, anon;
grant execute on function public.student_get_own_graduation_status() to authenticated;

revoke all on function public.staff_get_student_graduation_status(uuid) from public, anon;
grant execute on function public.staff_get_student_graduation_status(uuid) to authenticated;

-- confirm graduation (0045)
revoke all on function public.staff_confirm_graduation(uuid) from public, anon;
grant execute on function public.staff_confirm_graduation(uuid) to authenticated;

-- dashboard/list (0046)
revoke all on function public.staff_get_graduation_summary(uuid, uuid, text, text) from public, anon;
grant execute on function public.staff_get_graduation_summary(uuid, uuid, text, text) to authenticated;

revoke all on function public.staff_list_graduation_status(uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.staff_list_graduation_status(uuid, uuid, text, text, integer, integer) to authenticated;

-- thesis proposal, re-checked after 0047's re-create (BUS-74)
revoke all on function public.student_create_thesis_proposal(text, text, uuid) from public, anon;
grant execute on function public.student_create_thesis_proposal(text, text, uuid) to authenticated;

-- thesis completion, re-checked after 0039's re-create (BUS-79)
revoke all on function public.staff_complete_thesis(uuid) from public, anon;
grant execute on function public.staff_complete_thesis(uuid) to authenticated;

-- internal helpers: never callable by any application role (BUS-78).
revoke all on function public._compute_graduation_eligibility(uuid) from public, anon, authenticated;
revoke all on function public._graduation_filtered_rows(uuid, uuid, text, text) from public, anon, authenticated;
