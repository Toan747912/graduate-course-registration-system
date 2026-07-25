# Database concurrency & authorization test plan

No SQL test framework (pgTAP or similar) is set up in this repository yet, so
this is a manual, reproducible test plan rather than an executable test
suite. It targets the concurrency/security fixes made to
`supabase/migrations/0008_rpc_register_for_class.sql`,
`0009_rpc_cancel_own_enrollment.sql`, `0011_rpc_get_registration_classes.sql`
and `0007_rls_policies.sql` (including the UC-07 enrollment-history read
policies added there).

Run these against a disposable database (a fresh `supabase start` local
instance, or a scratch Supabase Cloud project) — **never against a project
with real data.**

## Setup

Apply migrations and seed data first:

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

`psql` connects as the Postgres superuser/owner, which bypasses RLS. To
exercise the RPCs the same way PostgREST/Supabase does (as the `authenticated`
role with `auth.uid()` resolving to a specific user), each session below sets:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<profile-uuid>","role":"authenticated"}';
```

`auth.uid()` reads `request.jwt.claims ->> 'sub'`, so this reproduces exactly
what a real API request produces, without needing a running API server.

Two students and enough seat/credit headroom are needed. Create them (adjust
UUIDs/emails to your instance, or use the `seed:demo-users` script's output):

```sql
-- Run as the table owner (plain psql session), not as `authenticated`.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-student-1@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test-student-2@example.com')
on conflict do nothing;

update public.profiles
set role = 'STUDENT', student_status = 'ACTIVE'
where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002');
```

(If the `on_auth_user_created` trigger already created the matching profile
rows with defaults, the `update` above is all you need.)

---

## (a) Same student, two concurrent registrations, cannot jointly exceed the credit limit

Goal: prove the `profiles ... for update` lock added to `register_for_class`
(0008) prevents two concurrent registrations by the **same** student — into
**different** classes — from both being confirmed when only one of them fits
under `registration_periods.max_credits`.

Setup: pick a semester whose `max_credits` is, say, 6, and two ACTIVE classes
in that semester's open period each worth 4 credits (so together they total 8
> 6 and only one may end up CONFIRMED).

Open two `psql` sessions (Session A, Session B), both connected to the same
database.

**Session A:**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.register_for_class('<class-1-id>');
-- Do NOT commit yet — leave this transaction open.
```

**Session B (while A is still open):**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.register_for_class('<class-2-id>');
-- This call blocks here, waiting on Session A's lock on the profiles row.
```

Session B should hang (no result yet) because it is waiting for Session A's
`for update` lock on `profiles` to release.

**Back in Session A:**
```sql
commit;
```

Session B's `select` now returns. Inspect both results plus the actual state:

```sql
select id, course_class_id, status, reason from public.enrollments
where student_id = 'aaaaaaaa-0000-0000-0000-000000000001'
order by created_at;
```

**Expected result:** exactly one of the two enrollments is `CONFIRMED`; the
other is `REJECTED` with reason `'Vượt giới hạn tín chỉ cho phép'` (BUS-05).
Never both `CONFIRMED`.

**Regression check:** comment out the `for update` on the `profiles` select in
`0008_rpc_register_for_class.sql`, re-run this scenario, and confirm Session B
no longer blocks and can return `CONFIRMED` concurrently with A before A
commits — reproducing the race the fix closes. Revert the change afterward.

---

## (b) Two different students race for the last seat — only one CONFIRMED

Goal: prove the existing `course_classes ... for update` lock (unchanged by
this update, already present pre-fix) still serializes seat allocation
correctly and continues to do so with the new profile lock in place (BUS-07).

Setup: an ACTIVE class in an open period with `max_seats = 1` and zero
existing CONFIRMED enrollments (the seed data's `CS601-01` class has
`max_seats = 2`; either lower it for this test or pre-fill one CONFIRMED seat
so exactly one slot remains).

**Session A:**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.register_for_class('<full-class-id>');
-- leave open
```

**Session B (concurrently, different student):**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';
select public.register_for_class('<full-class-id>');
-- blocks, waiting on Session A's lock on the course_classes row
```

**Session A:**
```sql
commit;
```

Session B's call now proceeds and returns.

```sql
select student_id, status, reason from public.enrollments
where course_class_id = '<full-class-id>'
order by created_at;
```

**Expected result:** exactly one row `CONFIRMED`; the other `REJECTED` with
reason `'Lớp đã đủ sĩ số'` (BUS-06/BUS-07). Never both `CONFIRMED`, never a
seat count exceeding `max_seats`.

---

## (c) An inactive/non-student caller cannot call `get_registration_classes`

Goal: prove the `public.is_active_student()` check added in
`0011_rpc_get_registration_classes.sql` rejects everyone except an ACTIVE
STUDENT.

**As an INACTIVE student:**
```sql
update public.profiles set student_status = 'INACTIVE'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.get_registration_classes('<semester-id>');
rollback;
```

**Expected result:** raises an exception —
`only an active student may view the registration class list`. No rows
returned.

**As a TRAINING_STAFF profile:**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-id>","role":"authenticated"}';
select public.get_registration_classes('<semester-id>');
rollback;
```

**Expected result:** same exception. Staff must use their own routes/queries
(`apps/api/src/routes/staff.ts`, and the staff-scoped `select` RLS policies in
`0007_rls_policies.sql`), never this RPC.

**As an ACTIVE student (control case):**
```sql
update public.profiles set student_status = 'ACTIVE'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.get_registration_classes('<semester-id>');
rollback;
```

**Expected result:** succeeds, returns the expected class rows.

---

## (d) UC-07: enrollment history stays readable after period close / class cancellation

Goal: prove the `course_classes_select_own_enrollment_history` and
`class_schedules_select_own_enrollment_history` policies (0007) let a student
read the class name/schedule for their own past enrollments even when the
class is no longer `ACTIVE` and the registration period is no longer open —
and that this does **not** leak the same rows to a student with no enrollment
in that class.

Setup: pick (or create) a class `<hist-class-id>` whose parent
`registration_periods` row has `closes_at` in the past, and set the class's
own `status` to `CANCELLED`. Give student 1 an `enrollments` row for that
class with `status = 'CANCELLED_BY_SCHOOL'`. Student 2 has no enrollment row
for that class at all.

```sql
-- as table owner
update public.course_classes set status = 'CANCELLED' where id = '<hist-class-id>';

update public.enrollments
set status = 'CANCELLED_BY_SCHOOL'
where student_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and course_class_id = '<hist-class-id>';
```

**As student 1 (has the CANCELLED_BY_SCHOOL enrollment):**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select id, status from public.course_classes where id = '<hist-class-id>';
select id, day_of_week, start_time from public.class_schedules where course_class_id = '<hist-class-id>';
rollback;
```

**Expected result:** both queries return the class row and its schedule
row(s), even though the class is `CANCELLED` and the period is closed.

**As student 2 (no enrollment in this class):**
```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

select id, status from public.course_classes where id = '<hist-class-id>';
select id, day_of_week, start_time from public.class_schedules where course_class_id = '<hist-class-id>';
rollback;
```

**Expected result:** both queries return zero rows — the history policies do
not grant visibility to students without an `enrollments` row of their own on
that class, and the `course_classes_select_student_visible` /
`class_schedules_select_student_visible` policies also reject the read
because the class is `CANCELLED` and the period is closed.

**Regression check:** temporarily drop the two
`*_select_own_enrollment_history` policies, re-run the student 1 case, and
confirm both queries now return zero rows — reproducing the UC-07 bug this
migration fixes. Recreate the policies afterward.

---

## Helper function grants (0007)

Confirm the three RLS helper functions reject the anonymous role and accept
`authenticated`:

```sql
set local role anon;
select public.is_active_student();
-- expected: permission denied for function is_active_student

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select public.is_active_student();
-- expected: succeeds, returns true/false per that profile's row
```

Repeat for `public.current_role_name()` and `public.is_training_staff()`.

## Cleanup

Drop the test student rows (and any auth.users rows you inserted) or discard
the disposable database entirely once done — do not leave test data in a
shared project.
