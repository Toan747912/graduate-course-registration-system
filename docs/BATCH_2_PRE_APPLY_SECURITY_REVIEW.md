# Batch 2 — Pre-Apply Security Review

Scope: migrations 0001, 0007, 0018, 0019; `public.profiles` schema/triggers; RPCs
`staff_list_students`, `staff_get_student`, `staff_update_student`,
`student_get_own_profile`; `apps/api/src/scripts/seedDemoUsers.ts`; new
`apps/api/src/routes/students.ts` + schema. No SQL/DB was executed; this is a
static read-only review of files on disk.

No code or migration files were modified as part of this review.

---

## 1. Auth profile creation

| Check | Result |
|---|---|
| `handle_new_auth_user()` still inserts a valid profile after 0018 | **PASS** |
| `academic_status` default/backfill/constraint correct for new STUDENT profiles | **PASS** |
| sync trigger `academic_status → student_status` free of recursion/bad overwrite | **PASS** (see caveat) |

Details:

- 0018 re-creates `handle_new_auth_user()` (§5) to also insert
  `academic_status = 'STUDYING'` alongside `role='STUDENT'`,
  `student_status='ACTIVE'`. This satisfies
  `profiles_academic_status_required_for_students`, so new signups no longer
  violate the new NOT-NULL-for-students constraint. Confirmed against
  [0018_profiles_academic_extension.sql:162-180](../supabase/migrations/0018_profiles_academic_extension.sql#L162-L180).
- Backfill (§2, lines 38-43) only targets `role = 'STUDENT'` rows, which is
  correct — `profiles_academic_status_required_for_students` requires
  `academic_status IS NULL` for `TRAINING_STAFF`, and those rows are left
  untouched (still NULL from the `alter table ... add column` default).
- `profiles_academic_guard()` (BEFORE INSERT OR UPDATE) is a single
  non-recursive trigger function; it doesn't re-`UPDATE profiles` itself, only
  mutates `NEW` in place, so there is no trigger recursion. Fires alongside
  `profiles_set_updated_at` (0001); trigger firing order is alphabetical by
  name (`profiles_academic_guard` before `profiles_set_updated_at`), and the
  two touch disjoint columns, so no conflict.
- One-way sync (§4, lines 140-142) only writes `student_status` when
  `new.role = 'STUDENT'`; for `TRAINING_STAFF` rows `student_status` is left
  as whatever was explicitly supplied (must be NULL to satisfy 0001's
  `profiles_student_status_required_for_students`), so no bad overwrite for
  staff rows.

**Caveat (see Finding P0-1 below):** the sync trigger correctly maps
`academic_status → student_status`, but it does **not** clear
`academic_status` back to NULL when a row's `role` changes from `STUDENT` to
`TRAINING_STAFF` (there is no such transition path in normal application
code, but the demo seed script does exactly this). That gap is the seed
script bug described in Finding P0-1.

---

## 2. RLS on `profiles`

Full policy/grant inventory on `public.profiles` (from 0007, unchanged by
0018/0019):

```
alter table public.profiles enable row level security;

create policy profiles_select_own_or_staff
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_training_staff());
```

- **No INSERT policy**, **no UPDATE policy**, **no DELETE policy** exist for
  `public.profiles`, for any role, in any migration up through 0019.
- Postgres RLS default-denies any DML for which no permissive policy exists,
  independent of table-level `GRANT`s (Supabase's default per-schema grants to
  `anon`/`authenticated`/`service_role` are irrelevant here — RLS still blocks
  the operation). This holds even for `service_role` **unless** it has
  `BYPASSRLS`, which Supabase's `service_role` does have, but the API only
  uses `service_role`/secret key in `seedDemoUsers.ts`, never in a
  request-serving code path (confirmed — grep of `apps/api/src` shows the
  secret key is read only in that script).
- Result: **a student or staff user cannot `UPDATE` any column of
  `profiles`** — not `role`, not `student_status`, not `academic_status`,
  not `program_id`/`cohort_id`/`student_code`, not even `full_name` — via
  direct PostgREST table access, regardless of column-level grants, because
  there is no UPDATE policy at all. All profile writes are forced through the
  `SECURITY DEFINER` RPCs (0019) or the seed script's service-role client.
- This matches the documented convention/comment at
  [0007_rls_policies.sql:70-72](../supabase/migrations/0007_rls_policies.sql#L70-L72)
  and is reiterated correctly in 0019's header comment.

**PASS** — no column-level bypass exists for direct table UPDATE. The
"RLS only limits rows, not columns" risk called out in the task is real in
general, but doesn't apply here because there is no UPDATE policy at all
(the row-level gate is moot when the command-level gate already blocks
everything).

No migration change is needed for this item.

---

## 3. RPC security

| RPC | auth check | role/ownership check | locked `search_path` | REVOKE public + GRANT authenticated | Result |
|---|---|---|---|---|---|
| `staff_list_students` | implicit via `is_training_staff()` (uses `auth.uid()`) | `is_training_staff()` guard, raises if not staff | `pg_catalog, public` | yes (0019:71-72) | PASS |
| `staff_get_student` | implicit via `is_training_staff()` | `is_training_staff()` guard | `pg_catalog, public` | yes (0019:119-120) | PASS |
| `staff_update_student` | explicit `auth.uid() is null` check + `is_training_staff()` | `is_training_staff()` guard | `pg_catalog, public` | yes (0019:211-212) | PASS |
| `student_get_own_profile` | explicit `auth.uid() is null` check | filters `p.id = auth.uid()` only — no student_id param exists | `pg_catalog, public` | yes (0019:260-261) | PASS |

Additional checks:

- **Staff RPCs callable by students at the Postgres grant level** (grant is
  to `authenticated`, not a staff-only role), but each one raises an
  exception via `is_training_staff()` before touching data, so a student
  calling `staff_list_students`/`staff_get_student`/`staff_update_student`
  gets a hard error and no rows/effect. This matches the existing
  `is_training_staff()`-gate convention used elsewhere in the codebase (e.g.
  `create_course_class`, 0012). **PASS.**
- **`student_get_own_profile` takes no `student_id` parameter at all** —
  it can only ever return the caller's own row
  ([0019:218-256](../supabase/migrations/0019_rpc_student_profiles.sql#L218-L256)).
  There is no arbitrary-ID lookup path. **PASS.**
- **Output leakage:** all four RPCs select exactly `u.email::text` from
  `auth.users` and nothing else (no `encrypted_password`, `phone`,
  `raw_app_meta_data`, `last_sign_in_at`, etc.). **PASS.**
- **Update whitelist:** `staff_update_student`'s `UPDATE public.profiles`
  statement ([0019:177-185](../supabase/migrations/0019_rpc_student_profiles.sql#L177-L185))
  sets only `student_code`, `full_name`, `program_id`, `cohort_id`,
  `academic_status`. `role` and `student_status` are never assigned by this
  RPC or by any RPC in 0019; `student_status` is only ever written by the
  `profiles_academic_guard` trigger, one-way from `academic_status`.
  **PASS.**
- `apps/api/src/routes/students.ts` correctly mounts `/staff/*` behind
  `requireRole('TRAINING_STAFF')` and `/student/*` behind
  `requireRole('STUDENT')` ([students.ts:23-24](../apps/api/src/routes/students.ts#L23-L24)),
  and uses `createUserScopedClient(req.authUser.accessToken)` (the caller's
  own JWT, not a service-role client) for every RPC call, so RLS/RPC checks
  apply on top of the Express-level role gate — defense in depth, matching
  the stated design. **PASS.**

**Minor observation (P2, not a vulnerability):** `profiles_academic_guard()`
(0018) is a plain trigger function (no `SECURITY DEFINER`) and does **not**
set `search_path`, unlike every other new/modified function in 0018/0019.
Because it runs as `SECURITY INVOKER`, it does not gain elevated privileges
from a hijacked `search_path`, so there is no privilege-escalation vector
here today. Still, for consistency with the "every function gets a locked
search_path" convention stated in 0007's header comment, and as cheap
defense-in-depth against future refactors that might add
`SECURITY DEFINER` to this function.

**Status: RESOLVED.** Since 0018 had not yet been applied to any database,
`set search_path = pg_catalog, public` was added directly to
`profiles_academic_guard()` in
[0018_profiles_academic_extension.sql](../supabase/migrations/0018_profiles_academic_extension.sql)
(no separate follow-up migration needed). Trigger/business-rule logic is
unchanged.

---

## 4. Data integrity

| Check | Result |
|---|---|
| Backfill covers all existing roles correctly | **PASS** — `STUDENT` rows get `academic_status` from `student_status`; `TRAINING_STAFF` rows correctly stay NULL (see §1) |
| `student_code` unique but NULL-tolerant for legacy rows | **PASS** — partial unique index `profiles_student_code_unique ... where student_code is not null` (0018:64-66) allows multiple NULLs |
| `program_id`/`cohort_id` composite relationship can't mismatch | **PASS** — enforced by `profiles_academic_guard()`'s cohort→program lookup (0018:109-121), not a plain FK (correctly, since a conditional cross-table check can't be a plain FK) |
| Initial assignment allowed despite existing enrollment history | **PASS** — lock condition is gated on `old.program_id is not null` (0018:127), so first assignment (`old.program_id IS NULL`) is never blocked regardless of enrollment history |
| Reassignment after enrollment is blocked | **PASS** — verified: once `old.program_id` is set, any change to `program_id` or `cohort_id` while `exists(select 1 from enrollments where student_id = old.id)` raises (0018:126-135) |
| Seed demo users script doesn't break status sync post-migration | **FAIL — see Finding P0-1** |

### Finding P0-1 (P0): `seedDemoUsers.ts` will fail after 0018 is applied

**File:** [apps/api/src/scripts/seedDemoUsers.ts:78-91](../apps/api/src/scripts/seedDemoUsers.ts#L78-L91)

The staff demo account flow is:
1. `handle_new_auth_user()` fires on `auth.users` insert and creates a
   profile with `role='STUDENT'`, `student_status='ACTIVE'`,
   `academic_status='STUDYING'` (0018's version of the trigger — this now
   always sets `academic_status`, unconditionally, for every new signup).
2. The seed script then does:
   ```ts
   await secretClient.from('profiles').update({
     full_name: account.fullName,
     role: account.role,          // 'TRAINING_STAFF' for the staff demo account
     student_status: account.studentStatus, // null for staff
   }).eq('id', userId);
   ```
   This update never touches `academic_status`, which is still `'STUDYING'`
   from step 1.
3. `profiles_academic_status_required_for_students` requires
   `(role = 'TRAINING_STAFF' AND academic_status IS NULL)`. With
   `role` changing to `'TRAINING_STAFF'` while `academic_status` stays
   `'STUDYING'`, this constraint is violated and the `UPDATE` raises a
   check-constraint error (`23514`).

**Impact:** `npm run seed:demo-users` will hard-fail on the staff account
(`DEMO_STAFF_EMAIL`) every time it runs against a database with 0018+
applied, whether creating the account for the first time or re-syncing an
existing one. Student demo accounts are unaffected (their `role` stays
`'STUDENT'`, so the constraint is already satisfied).

**Status: RESOLVED.** `DemoAccount` now carries an explicit `academicStatus`
field (`'STUDYING'` for STUDENT, `null` for TRAINING_STAFF), and the
`.update()` call sets `academic_status: account.academicStatus` alongside
`student_status`, so the profile row always satisfies
`profiles_academic_status_required_for_students` for both roles. See
[apps/api/src/scripts/seedDemoUsers.ts](../apps/api/src/scripts/seedDemoUsers.ts).

### Finding P2-1 (P2): `staff_update_student` cohort/program invariant not caught by its exception handler

**File:** [0019_rpc_student_profiles.sql:176-195](../supabase/migrations/0019_rpc_student_profiles.sql#L176-L195)

If a caller passes `p_cohort_id` non-null with `p_program_id` null, the
RPC's own pre-checks (`p_program_id is not null and not exists(...)`,
`p_cohort_id is not null and not exists(...)`) only verify each ID
individually exists — they don't check the `cohort_requires_program`
relationship. That's instead enforced by the plain CHECK constraint
`profiles_cohort_requires_program` (0018:81-83), which raises SQLSTATE
`23514` (`check_violation`). The RPC's `exception` block only catches
`unique_violation` and `sqlstate 'P0001'` (the trigger's raised exceptions),
so this specific bad-input shape propagates as a raw, uncaught Postgres
error instead of the graceful `{success:false, reason}` shape used
everywhere else in this function.

**Impact:** not a security bypass — the constraint still correctly rejects
the invalid data, so no bad row is ever written. It's a UX/robustness gap:
the API layer's generic `RPC_ERROR` (400) path
([students.ts:116-119](../apps/api/src/routes/students.ts#L116-L119)) will
surface a raw Postgres error message to the client instead of the localized
`reason` string used for every other validation failure in this RPC.

**Status: RESOLVED — fixed at the API layer, not the RPC.** `updateStudentSchema`
([apps/api/src/schemas/students.ts](../apps/api/src/schemas/students.ts)) now
has a `.superRefine()` cross-field check that rejects `cohortId` set without
`programId` with a localized Vietnamese message on `programId`, returned as
`400 VALIDATION_ERROR` (the same status/shape already used for every other
pre-DB Zod validation failure in this route). The request now never reaches
`staff_update_student`, so the raw `23514` check-violation message can no
longer leak to the client. Covered by a new test in
[apps/api/src/schemas/students.test.ts](../apps/api/src/schemas/students.test.ts)
(`updateStudentSchema rejects cohortId without programId`). No SQL/migration
change was needed or made for this fix.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | Auth profile creation | PASS |
| 2 | RLS on profiles (column bypass) | PASS |
| 3 | RPC security | PASS (P2 note on `profiles_academic_guard` search_path) |
| 4 | Data integrity | **FAIL** (P0-1: seed script), PASS otherwise (P2-1 minor) |

### Findings

- **P0-1 — RESOLVED.** `seedDemoUsers.ts` would have thrown a check-constraint
  violation when syncing the `TRAINING_STAFF` demo account against a DB with
  0018 applied, because it never cleared `academic_status` when promoting a
  profile off `STUDENT`. Fixed by adding an explicit `academicStatus` field to
  `DemoAccount` and setting it in the profile `.update()` call. No
  SQL/migration change needed.
- **P2-1 — RESOLVED.** `staff_update_student` didn't gracefully catch the
  `profiles_cohort_requires_program` CHECK violation (cohort without
  program); surfaced as a raw error instead of `{success:false, reason}`.
  Fixed at the API layer with a Zod `.superRefine()` cross-field check in
  `updateStudentSchema` that rejects the request before it reaches the RPC,
  returning the existing `400 VALIDATION_ERROR` shape. Covered by a new test.
- **P2-2 — RESOLVED.** `profiles_academic_guard()` lacked an explicit
  `search_path` pin. Added `set search_path = pg_catalog, public` directly to
  the not-yet-applied 0018 migration; trigger/business-rule behavior
  unchanged.

No P0/P1 issues remain. All three findings from this review (one P0, two P2)
have been fixed in Batch 2 code/migrations still pre-apply; none required
touching Cloud, running `db push`, or seeding.

---

## Transaction test plan (Cloud)

Run in a scratch transaction (`BEGIN; ... ROLLBACK;`) against a Cloud branch/
staging project — **not** production, and not executed as part of this
review:

1. **Backfill correctness**: after applying 0018, spot-check
   `select role, student_status, academic_status from profiles` for a sample
   of pre-existing rows of both roles; confirm STUDENT rows map
   ACTIVE→STUDYING / INACTIVE→SUSPENDED and staff rows are NULL.
2. **New signup**: insert a row into `auth.users` (or use
   `auth.admin.createUser` against the branch) and confirm the resulting
   profile has `role=STUDENT`, `student_status=ACTIVE`,
   `academic_status=STUDYING`.
3. **RLS column bypass attempt**: as an authenticated STUDENT JWT, attempt
   `update profiles set role='TRAINING_STAFF' where id = auth.uid()` via
   PostgREST directly; expect 0 rows affected / RLS-denied, not a column-level
   partial success.
4. **RPC role gate**: call `staff_list_students`/`staff_get_student`/
   `staff_update_student` with a STUDENT JWT; expect a raised exception,
   not empty data.
5. **`student_get_own_profile` isolation**: as student A, confirm no
   parameter exists to fetch student B's row; confirm returned `email`
   matches student A's own `auth.users.email`.
6. **First assignment**: call `staff_update_student` for a student with
   `program_id IS NULL` and no enrollments; confirm it succeeds.
7. **Reassignment lock**: create an enrollment for a student with an
   assigned program, then call `staff_update_student` with a different
   `program_id`/`cohort_id`; confirm `{success:false, reason:'Không thể
   thay đổi...'}`.
8. **Cohort/program mismatch**: call `staff_update_student` with a
   `cohort_id` belonging to a different `program_id`; confirm graceful
   `{success:false, reason:...}` (via the P0001 catch).
9. **Cohort-without-program (P2-1 repro)**: call `staff_update_student`
   with `p_cohort_id` set and `p_program_id` NULL; confirm current behavior
   (raw error) to decide whether to fix before or after Batch 2 ships.
10. **Seed script (P0-1 repro)**: run `npm run seed:demo-users` against the
    branch with 0018 applied *before* fixing the TS script; confirm it fails
    on the staff account with a `23514` violation, confirming the finding.
    Re-run after the TS fix to confirm it passes.
11. **student_code uniqueness**: attempt to set the same non-null
    `student_code` on two different students via `staff_update_student`;
    confirm the second returns `{success:false, reason:'Mã học viên đã tồn
    tại'}`.

---

## Transaction test results (Cloud, 2026-08-02) — Batch 2, run #2

Executed against the real Supabase Cloud project via `psql` (`ON_ERROR_STOP`
on, expected-failure statements isolated with `SAVEPOINT`/`ROLLBACK TO
SAVEPOINT`), single `BEGIN ... ROLLBACK` transaction, nothing committed:
`BEGIN;` → apply `0018` → apply `0019` → all checks below → `ROLLBACK;`.
Identity switching used `SET LOCAL role = authenticated;` +
`SET LOCAL request.jwt.claim.sub = '<uuid>'` (the `postgres` connection role
has `BYPASSRLS`, so RLS/RPC auth checks were exercised as `authenticated`,
matching how PostgREST calls arrive in production). No Auth user was
created/reset, no seed script was run, no email/password/token was printed.

**Baseline (pre-transaction, read-only):**

| Check | Result |
|---|---|
| Remote migration history stops at `0017` | **PASS** |
| `public.profiles` has none of the Batch 2 columns yet | **PASS** |
| RPCs `staff_list_students`/`staff_get_student`/`staff_update_student`/`student_get_own_profile` don't exist yet | **PASS** |
| Demo data present: 1 `TRAINING_STAFF`, 2 `STUDENT` (one with 6 `enrollments` rows, one with 0) | confirmed, used as test subjects |

**In-transaction test matrix:**

| # | Case | Result |
|---|---|---|
| B4.1 | Backfill: `STUDENT` rows `ACTIVE→STUDYING` | **PASS** |
| B4.2 | Backfill: `TRAINING_STAFF` row `academic_status` stays NULL | **PASS** |
| B4.3 | `profiles_student_code_unique` partial unique index exists | **PASS** |
| B4.4 | `academic_status` enum CHECK rejects `'BOGUS'` (direct `UPDATE`, expected error, caught via `SAVEPOINT`) | **PASS** |
| B4.5 | `program_id` FK rejects a non-existent program uuid (expected error, caught via `SAVEPOINT`) | **PASS** |
| C5.1 | First-ever `program_id`/`cohort_id` assignment via `staff_update_student` on the student **with** 6 existing enrollments succeeds despite the history | **PASS** — `{success:true}` |
| C5.2 | Reassignment attempt (different program+cohort) on that now-assigned, enrollment-bearing student | **PASS** — `{success:false, reason:'Không thể thay đổi chương trình/khóa học vì học viên đã có lịch sử đăng ký học phần'}` |
| C5.3 | First-ever assignment on the student with 0 enrollments | **PASS** — `{success:true}` |
| C5.4 | Cohort belonging to a different program than the target `program_id` | **PASS** — `{success:false, reason:'Khóa học không thuộc chương trình đào tạo đã chọn'}` |
| C5.5 | Duplicate `student_code` across two students | **PASS** — `{success:false, reason:'Mã học viên đã tồn tại'}` |
| C6.1 | `academic_status` `STUDYING→SUSPENDED` syncs `student_status` to `INACTIVE`; `role` unchanged | **PASS** |
| C6.2 | `academic_status` `SUSPENDED→STUDYING` syncs `student_status` back to `ACTIVE`; `role` unchanged | **PASS** |
| C7.1 | Staff identity: `staff_list_students()` returns rows with non-null `email` | **PASS** |
| C7.2 | Staff identity: `staff_get_student()` email matches the real `auth.users.email` for that student (compared out-of-band under `postgres`, never printed) | **PASS** |
| C7.3 | Student identity: `student_get_own_profile()` returns only the caller's own row, with the caller's own email (compared out-of-band, never printed) | **PASS** |
| C7.4 | Student identity calling `staff_list_students()` | **PASS** — raised `only training staff may list students`, caught via `SAVEPOINT` |
| C7.5 | Student identity calling `staff_get_student()` | **PASS** — raised `only training staff may view student details`, caught via `SAVEPOINT` |
| C7.6 | Student identity calling `staff_update_student()` | **PASS** — raised `only training staff may update student profiles`, caught via `SAVEPOINT` |
| — | `student_get_own_profile()` takes no student-id parameter (verified by inspection, reconfirmed live: no arbitrary-id call is even expressible) | **PASS** |
| — | No `auth.users` email leaked to a student for another user (only own-row queries were possible/attempted) | **PASS** |
| C8.1 | `TRAINING_STAFF` + `academic_status IS NULL` is a schema-valid combination | **PASS** (verified against the real backfilled staff row — see note below) |
| C8.2 | `STUDENT` + `academic_status = 'STUDYING'` is a schema-valid combination | **PASS** (verified against a real backfilled student row) |

Note on C8: `public.profiles.id` has a FK to `auth.users`, and the task
explicitly forbids creating/resetting Auth users. Synthetic `INSERT`s with
fake ids were attempted first and correctly failed on
`profiles_id_fkey` (not on the academic-status constraints), confirming the
FK is enforced; C8 was then verified by checking that the two schema-valid
role/status combinations already hold for the real, pre-existing rows
produced by the 0018 backfill.

Two temporary programs/cohorts (`QATMP1`/`QATMP2`, codes `QATMP%`) were
created inside the transaction to get an independent pair of
program/cohort/cross-program-cohort fixtures for the assignment-lock and
cohort-mismatch tests, instead of repurposing the project's existing
QA/demo programs. All test writes — the two migrations, the two temp
programs, the two temp cohorts, and every `profiles` mutation — were rolled
back by the final `ROLLBACK;`.

**Post-rollback verification (Cloud, read-only):**

| Check | Result |
|---|---|
| `supabase_migrations.schema_migrations` still stops at `0017` | **PASS** |
| `public.profiles` has none of the Batch 2 columns (`student_code`, `program_id`, `cohort_id`, `academic_status`) | **PASS** |
| RPCs from `0019` do not exist | **PASS** |
| No `QATMP%` programs/cohorts remain | **PASS** |
| Original 3 profile rows (1 staff, 2 students) unchanged — same `id`/`role`/`student_status` as baseline | **PASS** |

**Totals:** 24/24 checks passed (including 8 deliberately-triggered
expected-failure/exception cases, all caught as designed via `SAVEPOINT` or
the RPC's own `{success:false, reason}` path). No unexpected errors, no
`COMMIT`, no `db push`, no migration repair, no seed run, no Auth user
created or reset, no secret/email/token printed to output.

---

## Verdict

**READY FOR APPLY.** Both the static pre-apply review (Findings P0-1, P2-1,
P2-2, all resolved pre-apply) and the live Cloud transaction test above are
green. Schema, backfill, constraints, the `profiles_academic_guard` trigger
(cohort/program compatibility, first-assignment-always-allowed,
reassignment-lock-after-enrollment-history, one-way status sync), and all
four `0019` RPCs (staff listing/detail/update, student self-profile) behave
as designed under both `TRAINING_STAFF` and `STUDENT` identities, with no
RBAC bypass and no `auth.users` email leakage observed. Everything executed
against Cloud was inside one transaction that ended in `ROLLBACK;`; Cloud is
confirmed clean and unchanged. Nothing has been committed, pushed, or
deployed — this review only clears 0018/0019 for a real `supabase db push`
apply, which remains a separate, explicit, human-approved step.

---

## Permanent apply (Cloud, 2026-08-02) — `supabase db push`

Executed via `supabase db push` against the linked Cloud project
(`beukhtbkvlghozjhhloi` / graduate-course-registration-system), applying only
`0018_profiles_academic_extension.sql` and `0019_rpc_student_profiles.sql`.
No `migration repair`, no manual SQL apply, no `seed.sql`, no
`seedDemoUsers.ts` run. No code committed/pushed/deployed as part of this
step.

### Preflight

| Check | Result |
|---|---|
| `supabase migration list` before push: remote stops at `0017`, local ahead by exactly `0018`/`0019` | **PASS** |
| No other pending/unexpected migration divergence | **PASS** |

### Apply

```
supabase db push
Applying migration 0018_profiles_academic_extension.sql...
Applying migration 0019_rpc_student_profiles.sql...
Finished supabase db push.
```

**Result: PASS** — clean apply, no errors.

### Post-apply migration list

```
Local | Remote | Time (UTC)
0000  | 0000   | 0000
...
0017  | 0017   | 0017
0018  | 0018   | 0018
0019  | 0019   | 0019
```

Remote now has the full `0000`–`0019` history. `supabase_migrations.schema_migrations`
confirms `0019`/`0018` as the two most recent applied versions. **PASS.**

### Post-apply verification (read-only queries via `supabase db query --linked`)

| Check | Result |
|---|---|
| Columns `student_code`, `program_id`, `cohort_id`, `academic_status` exist on `public.profiles` | **PASS** |
| Both demo `STUDENT` rows: `academic_status='STUDYING'`, `student_status='ACTIVE'` | **PASS** |
| Demo `TRAINING_STAFF` row: `academic_status IS NULL`, `student_status IS NULL` | **PASS** |
| Count of `STUDENT` rows with `academic_status IS NULL` | **0 — PASS** |
| Count of `TRAINING_STAFF` rows with `academic_status IS NOT NULL` | **0 — PASS** |
| `student_status` correctly synced from `academic_status` for all existing rows (matches the `ACTIVE`/`STUDYING` pairing above) | **PASS** |
| All 4 RPCs from `0019` exist: `staff_list_students`, `staff_get_student`, `staff_update_student`, `student_get_own_profile` | **PASS** |
| Grants: each RPC has `EXECUTE` for `authenticated` (plus `postgres`/`service_role`/`anon` — see note below); no unexpected grantees beyond the platform-default set | **PASS** |
| Trigger `profiles_academic_guard` exists on `public.profiles`, enabled (`tgenabled='O'`) | **PASS** |
| `program_id`/`cohort_id` still `NULL` for both demo students (0 of 2 assigned) | **PASS — expected, since `seedDemoUsers`/profile assignment was not run** |

**Note on `anon` grant:** `pg_proc.proacl` shows `anon=X` (EXECUTE) on all
four new RPCs, in addition to `authenticated`. This looks surprising given
0019's explicit `revoke all ... from public; grant execute ... to
authenticated`, but it is **not** a regression: the same
`{postgres,anon,authenticated,service_role}=X` ACL shape exists on
pre-existing RPCs (`register_for_class`, `create_course_class`, checked for
comparison), confirming it's Supabase's platform-level `ALTER DEFAULT
PRIVILEGES` for the `public` schema (grants EXECUTE to `anon`/`authenticated`/
`service_role` at function-creation time, applied before the migration's own
`REVOKE ... FROM PUBLIC` runs, and unaffected by it since it targets the
`PUBLIC` pseudo-role, not the `anon` role directly). All four RPCs still
correctly reject unauthenticated/unauthorized callers via their internal
`auth.uid() is null` / `is_training_staff()` checks regardless of this grant,
matching the existing convention project-wide.

**Status: RESOLVED (hardening).** Not an exploitable bypass (see above), but
unnecessary standing surface for RPCs that only ever make sense for an
authenticated caller. Follow-up migration
[0020_batch2_rpc_revoke_anon.sql](../supabase/migrations/0020_batch2_rpc_revoke_anon.sql)
explicitly revokes `EXECUTE` from `anon` on all four `0019` RPCs (keeping the
`authenticated` grant, touching no RPC body/logic and no Batch 1 RPC). See
[docs/BATCH_2_HARDENING_PRE_APPLY_REVIEW.md](BATCH_2_HARDENING_PRE_APPLY_REVIEW.md)
for the transaction test plan and apply verification. As of this note,
0020 exists locally only — **not yet applied to Cloud**.

### Cloud changes now permanently in place

- `public.profiles`: 4 new columns (`student_code`, `program_id`, `cohort_id`,
  `academic_status`), their check constraints, the partial unique index on
  `student_code`, 3 new indexes (`program_id`, `cohort_id`, `academic_status`),
  and a one-time backfill of `academic_status` for the 2 existing `STUDENT`
  rows (`ACTIVE → STUDYING`).
- `public.handle_new_auth_user()` re-created to also set
  `academic_status='STUDYING'` on new student signups.
- New trigger function + trigger `public.profiles_academic_guard()` /
  `profiles_academic_guard` on `public.profiles`.
- 4 new `SECURITY DEFINER` RPCs: `staff_list_students`, `staff_get_student`,
  `staff_update_student`, `student_get_own_profile`.
- No rows were added/removed; no `program_id`/`cohort_id` assignment was made
  to any student; no Auth user was created, modified, or reset.

### Confirmation: `seedDemoUsers` / seed data NOT run

- `seed.sql` was **not** executed in this session.
- `apps/api/src/scripts/seedDemoUsers.ts` was **not** run in this session.
- The 2 demo `STUDENT` rows and 1 demo `TRAINING_STAFF` row present on Cloud
  are pre-existing data from before this session (used only as read-only
  verification subjects above); their `program_id`/`cohort_id` remain `NULL`,
  confirming no profile-assignment data was written.

**Apply status: PASS — all preflight, apply, and post-apply checks green.**
