# Migration Hardening Review — 0013 & 0014

Status: **draft, NOT applied**. Nothing in this review has been run against
Supabase Cloud. No `db push`, no `psql` against a remote/cloud connection
string, no commit, no deploy has been performed. Both migration files exist
only as local, uncommitted files in `supabase/migrations/`.

## 1. `0013_enrollment_single_confirmed_per_course_semester.sql`

### Why

BUS-03 ("một học viên không thể có quá một enrollment CONFIRMED cho cùng một
môn trong cùng học kỳ") is currently enforced in exactly one place:
`public.register_for_class()` (0008), inside the `exists (...)` check at
lines 72–81 of that file. That is correct for the student self-registration
flow, but it is *application logic inside one RPC*, not a database
constraint. Nothing stops:

- a future RPC (e.g. a staff-side "enroll student manually" function) from
  forgetting the check,
- a service-role script, seed script, or manual `psql`/SQL editor session
  from inserting or updating an `enrollments` row directly and skipping the
  check entirely,
- a future refactor of `register_for_class()` from accidentally dropping the
  `exists (...)` branch.

0013 adds that missing layer as a real constraint at the table level, so the
rule holds regardless of which code path writes to `enrollments`.

### Exact mechanism

A `BEFORE INSERT OR UPDATE OF status, course_class_id, student_id` row-level
trigger, `enrollments_enforce_single_confirmed_per_course_semester`, calling
`public.enforce_single_confirmed_enrollment_per_course_semester()`.

Why a trigger and not a unique index (as requested, unique indexes cannot
join tables):

- `public.enrollments` deliberately has no `semester_id` column (see the
  comment at the top of `0005_enrollments.sql`) — the semester is only
  reachable by joining `course_class_id -> course_classes.registration_period_id`.
  A unique index can only reference columns physically present on the
  indexed table (or an immutable expression over them), so it cannot express
  "no two rows with the same `student_id` + `status='CONFIRMED'` + the
  `course_id`/`registration_period_id` reached by joining through
  `course_classes`". No `semester_id` column was added to `enrollments` to
  work around this, per the constraint given.
- `registration_periods.semester_id` is `UNIQUE` (0002, BUS-13: at most one
  registration period per semester), so "same `registration_period_id`" and
  "same `semester_id`" are the same scope here — the trigger compares
  `registration_period_id` directly and needs no additional join to
  `semesters`.

What the function does, in order:

1. Returns immediately (no-op) if `NEW.status <> 'CONFIRMED'` — REJECTED,
   CANCELLED_BY_STUDENT and CANCELLED_BY_SCHOOL rows are never blocked or
   even inspected by this trigger, satisfying "không chặn enrollment
   REJECTED/CANCELLED_BY_STUDENT/CANCELLED_BY_SCHOOL".
2. `select 1 from public.profiles where id = new.student_id for update` —
   locks the student's own profile row, see Concurrency below.
3. Resolves `course_id` and `registration_period_id` for `NEW.course_class_id`
   via `course_classes`.
4. Checks whether another row (`e.id <> new.id`, so an UPDATE re-saving the
   same row never conflicts with itself) already has
   `status = 'CONFIRMED'` for the same `student_id` + `course_id` +
   `registration_period_id`.
5. If found, `raise exception` with the Vietnamese business message
   `'Học viên đã có một đăng ký CONFIRMED cho môn học này trong cùng học kỳ'`
   (errcode `unique_violation`, so client error handling that already
   branches on unique-violation-style errors keeps working), aborting the
   statement before it commits.

### Concurrency / lock order

`register_for_class()` (0008) already documents and relies on a fixed lock
order: **profiles row first, then course_classes row**, both via
`select ... for update`, to make BUS-03/BUS-04/BUS-05/BUS-07 safe under
concurrent requests from the same student.

0013's trigger takes **only** the profiles-row lock (step 2 above) — it never
locks `course_classes`. Consequences:

- When the trigger fires as part of `register_for_class()`'s own insert, the
  profile row is already locked by that same transaction; the trigger's
  `for update` is a no-op re-lock within the same xact (no self-block, no
  extra wait).
- When the trigger fires from any other path (direct insert/update, a future
  RPC, a service-role script) that did **not** already lock the profile row,
  it now blocks until any concurrent transaction holding that same student's
  profile lock commits or rolls back — which forces the two attempts to
  serialize and see each other's committed rows, closing the race where two
  concurrent CONFIRMED inserts for the same student/course/semester could
  otherwise both pass the check before either commits.
- Because the trigger never acquires a `course_classes` lock, it introduces
  no new lock-order edge relative to 0008's (profile → class) ordering, and
  therefore no new deadlock cycle. A transaction that already holds the
  class lock (having taken profile then class, per 0008) and now needs the
  profile lock again is safe — it already holds it, from the same xact.

### Schema / existing-data impact

- No columns added, no columns dropped, no existing constraints changed.
- No data is rewritten. The trigger only evaluates on new `INSERT`s and on
  `UPDATE`s that touch `status`, `course_class_id`, or `student_id`
  (`UPDATE OF status, course_class_id, student_id` — updates to unrelated
  columns such as `reason` never re-run this check).
- **Risk**: if any existing row in the current dataset already violates
  BUS-03 (i.e., a student already has two or more CONFIRMED enrollments for
  the same course in the same registration period), this migration does not
  touch or reject those pre-existing rows — the trigger only fires on new
  writes. However, if any such row is later `UPDATE`d in a way that touches
  `status`/`course_class_id`/`student_id` (e.g. a future cancellation flow
  updating `status`), the trigger will evaluate at that point and could
  raise on an update to the *other*, still-conflicting row. The verification
  query in §3 below checks for any such pre-existing violation before this
  is ever applied to cloud.

### Security / ownership / search_path

- `language plpgsql`, `security definer`, `set search_path = pg_catalog, public`
  — identical hardening convention to every other function in this project
  (0007's `current_role_name`/`is_training_staff`/`is_active_student`, 0008's
  `register_for_class`, etc.).
- `revoke all on function ... from public` — the trigger function is invoked
  only by the trigger mechanism itself (as the table owner/definer), never
  called directly by a client role, so no `grant execute to authenticated`
  is added (matching `set_updated_at()` and
  `forbid_enrollment_history_mutation()` in prior migrations, which are also
  never directly granted).
- No new privileges are opened: the function only reads `public.profiles`
  and `public.course_classes`/`public.enrollments`, all of which the
  definer (migration-runner role, effectively `postgres`) already has full
  access to; RLS is not weakened or bypassed for any *other* code path.

## 2. `0014_harden_handle_new_auth_user_search_path.sql`

### Why

`public.handle_new_auth_user()` (0001) is a `SECURITY DEFINER` trigger
function attached to `auth.users` (`AFTER INSERT`) but was defined with
`set search_path = public` only — every other `SECURITY DEFINER` function
added since (0007, 0008, 0009, 0010, 0011, 0012, 0013) uses the stricter
`set search_path = pg_catalog, public`. This migration brings it in line
with that established baseline.

### Behavior confirmation — no change

- The function body is copied verbatim: same `insert into public.profiles
  (id, full_name, role, student_status) values (...)`, same
  `coalesce(new.raw_user_meta_data ->> 'full_name', new.email)` default full
  name, same hard-coded `'STUDENT'` / `'ACTIVE'`, same
  `on conflict (id) do nothing`, same `return new`.
- `create or replace function` preserves the function's OID, so the existing
  `on_auth_user_created after insert on auth.users` trigger (created once in
  0001 and never re-created here) keeps pointing at the same function
  definition slot — no `drop trigger` / `create trigger` is needed or
  performed, and the trigger's activation timing (`AFTER INSERT`) is
  untouched.
- The body already schema-qualifies its only table reference
  (`public.profiles`) and calls no unqualified/ambiguous identifiers, so
  narrowing the search path from `public` to `pg_catalog, public` changes
  name resolution for nothing the function actually does — it is a pure
  hardening no-op at the behavioral level.

### Best-practice hardening rationale

Per Postgres/Supabase `SECURITY DEFINER` guidance, an explicit,
minimal `search_path` prevents a role that can create objects in `public`
(or any schema earlier in a *default* search path) from shadowing a
catalog function/operator the definer-context call implicitly relies on.
Explicitly listing `pg_catalog` first removes any implicit dependency on
`pg_catalog` being present/first in whatever `search_path` the invoking
session happens to have configured. No new schema is added to the path, and
no privilege is granted that did not already exist — this is strictly a
narrowing/pinning change, not an expansion.

### Schema / existing-data impact

None. No table, column, index, RLS policy, or grant is touched. The only
object modified is the function body/config of
`public.handle_new_auth_user()` itself.

## 3. Rollback plan

Both migrations are purely additive/replacing and have straightforward,
independent rollbacks (run in a single transaction each):

```sql
-- Rollback 0013
begin;
drop trigger if exists enrollments_enforce_single_confirmed_per_course_semester on public.enrollments;
drop function if exists public.enforce_single_confirmed_enrollment_per_course_semester();
commit;
```

```sql
-- Rollback 0014 (restores the exact pre-0014 definition from 0001)
begin;
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, student_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'STUDENT',
    'ACTIVE'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
commit;
```

## 4. Verification / test-plan SQL (run only after explicit approval, in a
   disposable/staging database — never yet run anywhere for this review)

### 4a. Pre-check: does any existing data already violate BUS-03?

Run this **before** applying 0013 to confirm the trigger has nothing
pre-existing to conflict with:

```sql
select e.student_id, cc.course_id, cc.registration_period_id, count(*)
from public.enrollments e
join public.course_classes cc on cc.id = e.course_class_id
where e.status = 'CONFIRMED'
group by e.student_id, cc.course_id, cc.registration_period_id
having count(*) > 1;
```

Expect zero rows. If any row is returned, resolve those enrollments
(business decision, not a schema change) before applying 0013.

### 4b. Direct-insert bypass attempt (should now fail)

Simulates writing to `enrollments` outside `register_for_class()` entirely —
e.g. from a service-role session — to prove the trigger, not just the RPC,
blocks the duplicate:

```sql
begin;
-- Assume :student, :class_a, :class_b resolve to two ACTIVE course_classes
-- for the SAME course in the SAME registration_period, and :student has no
-- existing CONFIRMED enrollment for that course/period yet.
insert into public.enrollments (student_id, course_class_id, status)
values (:'student', :'class_a', 'CONFIRMED');

-- This second insert must raise:
-- "Học viên đã có một đăng ký CONFIRMED cho môn học này trong cùng học kỳ"
insert into public.enrollments (student_id, course_class_id, status)
values (:'student', :'class_b', 'CONFIRMED');
rollback;
```

### 4c. Non-CONFIRMED statuses remain unrestricted

```sql
begin;
insert into public.enrollments (student_id, course_class_id, status, reason)
values (:'student', :'class_a', 'REJECTED', 'test');
insert into public.enrollments (student_id, course_class_id, status, reason)
values (:'student', :'class_b', 'CANCELLED_BY_STUDENT', 'test');
insert into public.enrollments (student_id, course_class_id, status, reason)
values (:'student', :'class_a', 'CANCELLED_BY_SCHOOL', 'test');
-- All three inserts must succeed with no exception.
rollback;
```

### 4d. Concurrency: two simultaneous direct inserts for the same
   student/course/semester (run in two separate psql sessions, session A
   commits first)

```sql
-- Session A
begin;
insert into public.enrollments (student_id, course_class_id, status)
values (:'student', :'class_a', 'CONFIRMED');
-- pause here (do not commit yet)
```

```sql
-- Session B (started while Session A is paused above)
begin;
insert into public.enrollments (student_id, course_class_id, status)
values (:'student', :'class_b', 'CONFIRMED');
-- This blocks on the profiles-row lock held by Session A, not on a
-- unique-index conflict — confirms the concurrency guard, not just the
-- logical check, is active.
```

```sql
-- Back in Session A
commit;
-- Session B's insert now unblocks and must raise the BUS-03 exception,
-- then:
rollback;
```

### 4e. `register_for_class()` still works end-to-end (no regression)

```sql
select public.register_for_class(:'class_a'); -- expect success = true
select public.register_for_class(:'class_b'); -- expect success = false,
                                                -- reason 'Đã đăng ký môn này trong học kỳ'
                                                -- (0008's own check fires first,
                                                --  same business outcome either way)
```

### 4f. 0014 sanity check — trigger still fires and still creates a profile

```sql
select tgname, tgenabled, tgrelid::regclass
from pg_trigger
where tgname = 'on_auth_user_created';
-- expect exactly one row, tgenabled = 'O' (origin, i.e. enabled)

select prosecdef, proconfig
from pg_proc
where proname = 'handle_new_auth_user';
-- expect prosecdef = true, proconfig containing 'search_path=pg_catalog, public'
```

(An actual `auth.users` insert to confirm profile auto-creation should only
be exercised in the local/staging Supabase stack that already has
`supabase/seed.sql`-style test fixtures — not against cloud data.)

## 5. Confirmation: no cloud data touched

- No `supabase db push`, `supabase migration up`, `psql` against any
  cloud/remote connection string, or Supabase Studio SQL editor action was
  performed as part of preparing this review.
- No `git add` / `git commit` / `git push` was performed; both migration
  files and this document exist only as local, uncommitted files.
- No existing, already-applied migration file (0000–0012) was modified —
  0013 and 0014 are new files only.
- A local `psql`/Postgres syntax check was attempted but no local server was
  reachable without an interactive password prompt in this environment;
  both files were instead manually reviewed line-by-line against the syntax
  and conventions of the already-applied migrations (0001, 0005, 0006, 0007,
  0008) they extend. **Recommend running §4's verification queries against
  a local `supabase start` stack or a disposable staging database before any
  cloud apply.**
