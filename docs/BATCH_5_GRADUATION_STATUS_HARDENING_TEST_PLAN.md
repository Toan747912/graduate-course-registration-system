# Batch 5 graduation-status hardening (0049) — transaction test plan

**Status: NOT EXECUTED.** No SQL test framework (pgTAP or similar) is set up
in this repository (same situation as `docs/DB_CONCURRENCY_TEST_PLAN.md`).
This document describes the manual `BEGIN ... ROLLBACK` cases required to
verify migration `supabase/migrations/0049_harden_graduation_status_transition.sql`
at runtime. It is written so it can be run as-is against a disposable
database (fresh `supabase start` local instance or scratch Cloud project) —
**never against a project with real data.** These cases have NOT been run
locally: this repository/environment has no live Postgres connection
available. Cannot execute locally, requires transaction test phase.

Related: `docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md` Finding #1 (P1) and
`docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md` section 7.7's "Bổ sung bắt buộc".

## Setup

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Each case below runs as the `authenticated` role impersonating a specific
profile, matching the convention in `docs/DB_CONCURRENCY_TEST_PLAN.md`:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-uuid>","role":"authenticated"}';
```

## Case 1 — staff_update_student rejects setting GRADUATED directly

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-uuid>","role":"authenticated"}';

select public.staff_update_student(
  '<studying-student-uuid>', null, 'Nguyễn Văn A', null, null, 'GRADUATED'
);
-- Expect: {"success": false, "reason": "Không thể đặt trạng thái Tốt nghiệp qua
-- chức năng này. Vui lòng sử dụng chức năng Xác nhận tốt nghiệp."}
-- Expect: profiles.academic_status for that student unchanged (still STUDYING).

select academic_status from public.profiles where id = '<studying-student-uuid>';
-- Expect: STUDYING

rollback;
```

## Case 2 — staff_update_student rejects reverting a GRADUATED student

Precondition: a student with an existing `graduation_records` row and
`academic_status = 'GRADUATED'` (e.g. via `staff_confirm_graduation` run
earlier in the same disposable DB, or seeded directly for the test).

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-uuid>","role":"authenticated"}';

select public.staff_update_student(
  '<graduated-student-uuid>', null, 'Nguyễn Văn B', null, null, 'STUDYING'
);
-- Expect: {"success": false, "reason": "Không thể thay đổi trạng thái của học
-- viên đã tốt nghiệp."}

select academic_status from public.profiles where id = '<graduated-student-uuid>';
-- Expect: GRADUATED (unchanged)

rollback;
```

## Case 3 — DB trigger backstop fires even bypassing the RPC (service_role / direct UPDATE)

This is the defense-in-depth layer: verifies the invariant holds even if a
future code path updates `profiles` directly instead of going through
`staff_update_student`.

```sql
begin;
-- run as table owner / service_role (bypasses RLS, NOT the RPC layer)
update public.profiles set academic_status = 'STUDYING' where id = '<graduated-student-uuid>';
-- Expect: ERROR: Không thể thay đổi trạng thái của học viên đã tốt nghiệp.
rollback;
```

```sql
begin;
-- a STUDYING student with NO graduation_records row
update public.profiles set academic_status = 'GRADUATED' where id = '<studying-student-uuid-no-record>';
-- Expect: ERROR: Không thể đặt trạng thái Tốt nghiệp trực tiếp; phải xác nhận
-- tốt nghiệp qua chức năng Xác nhận tốt nghiệp.
rollback;
```

## Case 4 — trigger ordering: profiles_academic_00_graduation_guard runs before profiles_academic_guard

```sql
select tgname, tgrelid::regclass
from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal
order by tgname;
-- Expect profiles_academic_00_graduation_guard listed alphabetically before
-- profiles_academic_guard, confirming BEFORE-trigger execution order.
```

Then re-run Case 3's first block and confirm the error message is the
graduation-guard message (not a student_status-sync side effect), proving the
guard trigger raises before profiles_academic_guard's sync logic executes.

## Case 5 — valid transitions on a non-GRADUATED student still work (no regression)

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-uuid>","role":"authenticated"}';

select public.staff_update_student(
  '<studying-student-uuid>', 'SV0099', 'Nguyễn Văn C', null, null, 'SUSPENDED'
);
-- Expect: {"success": true, ..., "academic_status": "SUSPENDED"}

select public.staff_update_student(
  '<studying-student-uuid>', 'SV0099', 'Nguyễn Văn C', null, null, 'STUDYING'
);
-- Expect: {"success": true, ..., "academic_status": "STUDYING"}
-- (STUDYING <-> SUSPENDED <-> WITHDRAWN transitions for a non-GRADUATED
-- student are unaffected by this migration.)

rollback;
```

## Case 6 — order of operations in staff_confirm_graduation (static verification only)

Re-reading `supabase/migrations/0045_rpc_staff_confirm_graduation.sql` lines
63-82: `insert into public.graduation_records (...)` (line 63) executes and
`returning * into v_record` completes BEFORE `update public.profiles set
academic_status = 'GRADUATED'` (line 82) — correct order already, confirmed
statically. No transaction-level test is strictly required for ordering
itself (it is a straight-line statement sequence within one function body,
which is one transaction), but Case 3's second block above exercises the
consequence of this ordering (the trigger backstop can find the
graduation_records row that staff_confirm_graduation's real flow always
creates first).

## Post-rollback cleanup verification

```sql
select academic_status, student_status from public.profiles
where id in ('<studying-student-uuid>', '<graduated-student-uuid>');
-- Expect: values equal to pre-test state (every case above ends in ROLLBACK).

select version from supabase_migrations.schema_migrations order by version desc limit 5;
-- 0049 should not appear if this preflight ran before the migration was
-- actually applied.
```
