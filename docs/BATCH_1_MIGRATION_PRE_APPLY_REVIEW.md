# Batch 1 — Pre-Apply Review (migrations 0015–0017)

Status: **review only, nothing applied.** No `psql`/`supabase db push` was run
against Cloud, no seed was run, no commit/push/deploy happened as part of this
review. This document is the artifact for that review.

Scope: `supabase/migrations/0015_programs_and_cohorts.sql`,
`0016_program_courses.sql`, `0017_rls_academic_catalog.sql`. Design reference:
[`ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md`](./ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md)
sections C.1–C.3.

---

## 1. Documentation consistency check (done)

Checked `ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md`, `README.md`,
`supabase/seed.sql`, `apps/api/src/schemas/academic.ts` /
`academic.test.ts` for any statement of a *global* unique constraint on
`cohorts.code`.

**Result: no contradiction found, no edits needed.**

- Design doc C.2 (line 86) already states: `code | text | unique theo
  (program_id, code)`.
- Migration 0015 already implements the scoped constraint (see §2).
- `README.md` (Academic management expansion section) only says "no
  student read access yet", makes no claim about uniqueness scope.
- `supabase/seed.sql:77` already does `on conflict (program_id, code) do
  nothing`, consistent with the scoped constraint.
- No test or schema file asserts global cohort-code uniqueness.

**Decision recorded (for future batches):** `cohorts.code` is unique
**within a program** (`UNIQUE(program_id, code)`), not globally. Two
different programs may each have a cohort coded `K2026`. This is
intentional — a khóa/intake code like "K2026" is meaningful per program,
not as a global identifier.

---

## 2. Migration review (0015–0017)

### Dependency order
- 0015 creates `programs`, then `cohorts` (FK → `programs`). Correct order;
  `cohorts.program_id` FK would fail to compile if `programs` didn't exist
  yet.
- 0016 creates `program_courses`, FK → `programs` (0015) and → `courses`
  (0003, already applied). Runs after 0015. Correct.
- 0017 enables RLS and adds policies on all three tables from 0015/0016,
  and calls `public.is_training_staff()` (defined in 0007, already
  applied). Runs after both. Correct.
- No changes to 0000–0014 — confirmed via diff review, migrations
  0000–0014 are untouched.

### `programs` (0015)
| Constraint | Definition | Purpose |
|---|---|---|
| PK | `id uuid primary key default gen_random_uuid()` | |
| UNIQUE | `code text not null unique` | one code per program, global (programs aren't scoped to anything higher) |
| CHECK | `required_credits_min > 0` | |
| CHECK | `elective_credits_min >= 0` | |
| CHECK | `pass_score_min >= 0 and pass_score_min <= 10` | |
| CHECK | `thesis_credits_min >= 0` | |
| trigger | `programs_set_updated_at` → `public.set_updated_at()` (existing function from 0001) | |

No index beyond the PK/unique (both auto-indexed by Postgres). No FK out.

### `cohorts` (0015)
| Constraint | Definition | Purpose |
|---|---|---|
| PK | `id uuid primary key default gen_random_uuid()` | |
| FK | `program_id references public.programs(id)`, `not null` | BUS-17: cohort belongs to exactly one program |
| UNIQUE | `cohorts_code_unique_per_program unique (program_id, code)` | **scoped**, not global — see §1 |
| index | `cohorts_program_idx on (program_id)` | supports FK-join and RLS filtering by program |
| trigger | `cohorts_set_updated_at` | |

No `ON DELETE` clause specified on the `program_id` FK, so it defaults to
`NO ACTION`: a program row can never be deleted while cohorts reference it
(irrelevant in practice — there is no delete RPC or policy for `programs`
in this batch, see §2 RLS below).

### `program_courses` (0016)
| Constraint | Definition | Purpose |
|---|---|---|
| PK | `id uuid primary key default gen_random_uuid()` | |
| FK | `program_id references public.programs(id)`, `not null` | |
| FK | `course_id references public.courses(id)`, `not null` | reuses existing MVP `courses` table (0003) |
| CHECK | `requirement_type in ('REQUIRED', 'ELECTIVE')` | BUS-18 |
| UNIQUE | `program_courses_unique_per_program unique (program_id, course_id)` | a course has exactly one requirement type per program |
| index | `program_courses_program_idx on (program_id)` | |
| index | `program_courses_course_idx on (course_id)` | supports the reverse lookup ("which programs use this course") |
| trigger | `program_courses_set_updated_at` | |

### RLS (0017)
All three tables: `alter table ... enable row level security;` then
per-table `SELECT` / `INSERT` / `UPDATE` policies, all `to authenticated`,
all gated by `public.is_training_staff()` in both `USING` and `WITH CHECK`
where applicable. Confirmed:

- **No `for all` / allow-all policy anywhere in 0017.** Every policy names
  a specific command (`select`, `insert`, `update`).
- **No `DELETE` policy on any of the three tables.** Combined with RLS
  being enabled and no policy matching `DELETE`, this means **no role —
  including `TRAINING_STAFF` — can delete rows** through PostgREST/Supabase
  client. (The Express API layer also has no delete route per
  `apps/api/src/routes/academic.ts`, so this is enforced at two layers.)
  Matches the design decision "MVP never hard-deletes these rows."
- **No policy grants access to `anon`.** All policies specify `to
  authenticated` only; the implicit-deny-by-default behavior of Postgres
  RLS means `anon` gets nothing, and `authenticated` gets nothing unless
  `is_training_staff()` returns true.
- **STUDENT read access:** `is_training_staff()` (defined in 0007) checks
  `profiles.role = 'TRAINING_STAFF'` for `auth.uid()`. A STUDENT's row has
  `role = 'STUDENT'`, so `is_training_staff()` returns `false` for them,
  and every `USING`/`WITH CHECK` clause on `programs`/`cohorts`/
  `program_courses` evaluates to `false`. A STUDENT gets zero rows on
  `SELECT` and is rejected on `INSERT`/`UPDATE`. Confirmed by inspection;
  exercised concretely by the transaction test plan in §4.
- **Helper function safety:** `is_training_staff()` is not redefined in
  this batch — it's the existing 0007 function: `SECURITY DEFINER`,
  `set search_path = pg_catalog, public` (locked down, not mutable by
  session), `language sql stable`, execute revoked from `public` and
  granted only to `authenticated` (0007:53-54). 0017 does not touch grants
  or function definitions at all — it only references the function inside
  policy bodies. No new functions are introduced in 0015-0017.

**No changes to migrations 0000–0014** — confirmed by re-reading 0007
(RLS helpers) and 0014 (search_path hardening) unmodified; 0015-0017 only
add new objects.

---

## 3. Impact on current Cloud schema and data

Cloud currently has migrations 0000–0014 applied (per `README.md` / prior
`MIGRATION_HARDENING_REVIEW.md`; not re-verified against Cloud in this
review since no `psql`/Cloud access was used — see §5 for the read-only
check to run before applying).

Applying 0015–0017 would, in order:
1. Create three new tables (`programs`, `cohorts`, `program_courses`).
   **Purely additive** — no existing table is altered, no existing column
   is added/dropped/renamed, no existing FK/constraint/index is touched.
2. Add 3 new triggers, reusing the existing `public.set_updated_at()`
   function (already present since 0001) — no new trigger function.
3. Enable RLS + add 9 new policies (3 tables × SELECT/INSERT/UPDATE),
   reusing the existing `public.is_training_staff()` function (already
   present since 0007) — no new RLS helper function.
4. No `ALTER TABLE ... DROP/RENAME`, no data migration/backfill, no
   changes to `profiles`, `courses`, `enrollments`, or any other existing
   table.

**Risk to existing data: none.** These are net-new, empty tables; nothing
existing is read, altered, or backfilled. The only way this could fail on
Cloud is if objects with these names already exist (see preflight below)
or if a required dependency (`courses` table, `set_updated_at()`,
`is_training_staff()`) is missing — both are expected to already exist
from 0001–0007 per the design doc's migration history.

**Reversibility:** additive-only changes are trivially reversible by
`DROP TABLE public.program_courses, public.cohorts, public.programs
CASCADE;` (in reverse dependency order) if ever needed post-apply, since
no other table references them yet (no FK from `profiles` in this batch —
that's Batch 2 per the design doc).

---

## 4. Preflight SQL (read-only — safe to run against Cloud before applying)

Run these against Cloud via the Supabase SQL editor or `psql` in read-only
fashion before applying 0015–0017. None of these mutate anything.

```sql
-- 4.1 Confirm which migrations Cloud believes are already applied
-- (adjust to whatever migration-tracking table/convention the project uses,
-- e.g. supabase_migrations.schema_migrations)
select version, name
from supabase_migrations.schema_migrations
order by version;

-- 4.2 Confirm none of the new object names already exist (would collide)
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('programs', 'cohorts', 'program_courses');
-- expect: 0 rows

-- 4.3 Confirm the dependencies this batch relies on are present
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('set_updated_at', 'is_training_staff');
-- expect: 2 rows

select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'courses';
-- expect: 1 row

-- 4.4 Confirm no existing policy/trigger names collide
select policyname from pg_policies
where schemaname = 'public'
  and policyname like any (array[
    'programs_%_staff', 'cohorts_%_staff', 'program_courses_%_staff'
  ]);
-- expect: 0 rows

select tgname from pg_trigger
where tgname in (
  'programs_set_updated_at', 'cohorts_set_updated_at',
  'program_courses_set_updated_at'
);
-- expect: 0 rows

-- 4.5 Sanity check current row counts on tables this batch does NOT touch,
-- to have a before/after baseline for the "no impact on existing data" claim
select 'profiles' t, count(*) from public.profiles
union all select 'courses', count(*) from public.courses
union all select 'enrollments', count(*) from public.enrollments;
```

Expected outcome: 4.2 and 4.4 return zero rows (clean slate for the new
names), 4.3 confirms dependencies exist, 4.5 gives a baseline to re-check
unchanged after apply.

---

## 5. Transaction test plan (`BEGIN ... ROLLBACK`, not run in this review)

To be run against a scratch/local Postgres or inside an explicit
transaction on Cloud that is always rolled back — **never committed**.
This review does not execute this plan; it is documented for the
apply-time step.

```sql
begin;

-- Assume 0015-0017 already applied within this transaction or before it.

-- 5.1 Create a program
insert into public.programs
  (code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min)
values
  ('CS-MASTER', 'Master CNTT', 30, 6, 5.0, 12)
returning id \gset prog1_

-- 5.2 Create a cohort under it
insert into public.cohorts (program_id, code, name)
values (:'prog1_id', 'K2026', 'Khoa 2026')
returning id \gset coh1_

-- 5.3 Create a program_course mapping (reuses an existing course row;
-- substitute a real id from public.courses, e.g. via a subselect)
insert into public.program_courses (program_id, course_id, requirement_type)
select :'prog1_id', id, 'REQUIRED' from public.courses limit 1
returning id \gset pc1_

-- 5.4 Duplicate program code -> expect unique_violation (23505)
savepoint sp1;
insert into public.programs
  (code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min)
values ('CS-MASTER', 'Duplicate', 30, 6, 5.0, 12);
-- EXPECT: ERROR duplicate key value violates unique constraint "programs_code_key"
rollback to savepoint sp1;

-- 5.5 Duplicate cohort code within the SAME program -> expect unique_violation
savepoint sp2;
insert into public.cohorts (program_id, code, name)
values (:'prog1_id', 'K2026', 'Duplicate K2026');
-- EXPECT: ERROR duplicate key value violates unique constraint "cohorts_code_unique_per_program"
rollback to savepoint sp2;

-- 5.6 SAME cohort code ("K2026") allowed in a DIFFERENT program -> expect success
savepoint sp3;
insert into public.programs
  (code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min)
values ('DS-MASTER', 'Master KHDL', 30, 6, 5.0, 12)
returning id \gset prog2_

insert into public.cohorts (program_id, code, name)
values (:'prog2_id', 'K2026', 'Khoa 2026 - KHDL');
-- EXPECT: INSERT 0 1 (success — different program_id, same code is fine)
-- (kept, not rolled back to sp3, so it's visible for the RLS tests below;
-- whole transaction is rolled back at the very end regardless)

-- 5.7 Duplicate course-program mapping -> expect unique_violation
savepoint sp4;
insert into public.program_courses (program_id, course_id, requirement_type)
select :'prog1_id', id, 'ELECTIVE' from public.courses limit 1;
-- EXPECT: ERROR duplicate key value violates unique constraint "program_courses_unique_per_program"
rollback to savepoint sp4;

-- 5.8 FK violation: program_id that doesn't exist -> expect foreign_key_violation
savepoint sp5;
insert into public.cohorts (program_id, code, name)
values ('00000000-0000-0000-0000-000000000000', 'K9999', 'Ghost');
-- EXPECT: ERROR insert or update on table "cohorts" violates foreign key constraint
rollback to savepoint sp5;

-- 5.9 CHECK violation: bad requirement_type -> expect check_violation
savepoint sp6;
insert into public.program_courses (program_id, course_id, requirement_type)
select :'prog1_id', id, 'OPTIONAL' from public.courses limit 1;
-- EXPECT: ERROR new row for relation "program_courses" violates check constraint "program_courses_requirement_type_check"
rollback to savepoint sp6;

-- 5.10 CHECK violation: pass_score_min out of range -> expect check_violation
savepoint sp7;
insert into public.programs
  (code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min)
values ('BAD-SCORE', 'Bad', 30, 6, 10.5, 12);
-- EXPECT: ERROR new row for relation "programs" violates check constraint "programs_pass_score_min_check"
rollback to savepoint sp7;

-- 5.11 RLS: staff allowed
-- (requires `set local role authenticated;` plus a way to fake auth.uid(),
--  e.g. `set local request.jwt.claims = '{"sub":"<staff-profile-id>"}';`
--  using a profile id that has role = 'TRAINING_STAFF' in public.profiles)
set local role authenticated;
set local request.jwt.claims = '{"sub":"<staff-profile-uuid>"}';
select count(*) from public.programs;
-- EXPECT: staff sees the rows inserted above (>= 1)

-- 5.12 RLS: student denied
set local request.jwt.claims = '{"sub":"<student-profile-uuid>"}';
select count(*) from public.programs;
-- EXPECT: 0 rows (RLS filters everything out for a STUDENT role)

savepoint sp8;
insert into public.programs
  (code, name, required_credits_min, elective_credits_min, pass_score_min, thesis_credits_min)
values ('STUDENT-TRY', 'Should fail', 30, 6, 5.0, 12);
-- EXPECT: ERROR new row violates row-level security policy for table "programs"
rollback to savepoint sp8;

reset role;

-- clean rollback: nothing from this test plan is committed
rollback;
```

Notes:
- Steps 5.11/5.12 require substituting real `profiles.id` values for a
  TRAINING_STAFF and a STUDENT row (or inserting throwaway profile rows
  inside the same transaction before switching role — also rolled back).
- The whole block ends in `rollback`, so nothing here persists regardless
  of individual `savepoint`/`rollback to savepoint` usage inside it.
- This plan is documentation only in this review; it has **not** been
  executed against Cloud or any other database as part of preparing this
  report.

---

## 6. Post-apply verification plan

After 0015–0017 are actually applied (out of scope for this review):

1. Re-run preflight query 4.1 — confirm 0015, 0016, 0017 now show as
   applied.
2. Re-run 4.2 — now expect exactly `programs`, `cohorts`,
   `program_courses` (3 rows).
3. Re-run 4.5 — confirm `profiles`/`courses`/`enrollments` counts are
   **unchanged** from the pre-apply baseline (proves no side effects on
   existing data).
4. Confirm RLS is enabled: `select relrowsecurity from pg_class where
   relname in ('programs','cohorts','program_courses');` → all `true`.
5. Confirm policy count: `select tablename, count(*) from pg_policies
   where schemaname='public' and tablename in
   ('programs','cohorts','program_courses') group by tablename;` → 3 each
   (select/insert/update), 0 delete policies present anywhere.
6. From the app: log in as a TRAINING_STAFF demo account and confirm the
   "Chương trình đào tạo" page loads with zero rows (empty tables, no
   error). Log in as a STUDENT demo account and confirm the same routes
   are inaccessible/return nothing (per existing route guards in
   `apps/api/src/routes/academic.ts`).
7. Only after 1–6 pass: apply `supabase/seed.sql`, then repeat step 6 and
   confirm the one sample program/cohort/course-assignment appear for
   staff and remain invisible to a student account.

---

## 7. Seed confirmation

`supabase/seed.sql` (the Batch 1 program/cohort/program_courses section,
lines ~53–87) is idempotent (`on conflict ... do nothing`) but **depends
on 0015–0017 already being applied** — it inserts into tables that don't
exist until then. Per the plan above and per `README.md`/design doc,
**seed.sql must only be run after migrations 0015–0017 are applied**, not
before and not concurrently. Confirmed by reading the file: it contains no
`create table`/DDL of its own, only `insert ... on conflict` statements
against `public.programs`, `public.cohorts`, `public.program_courses`.

---

## 8. What this review did NOT do (as of the original review)

- Did not connect to Supabase Cloud (no `psql`, no `supabase db push`, no
  SQL editor session).
- Did not run `seed.sql`.
- Did not commit, push, or deploy anything.
- Did not execute the §5 transaction test plan — it is written for
  execution at apply time, on a local/scratch Postgres instance or inside
  an explicit rolled-back transaction, not run here.

The §5 plan **has since been executed for real against Supabase Cloud**,
inside a single rolled-back transaction. See §9 for the actual results.

---

## 9. Transaction test execution — actual results (executed against Cloud)

Executed 2026-08-02 against Supabase Cloud, using `SUPABASE_DB_URL` from
`apps/api/.env` (not printed). Single `psql` session, `BEGIN` at the top,
`ROLLBACK` at the very end — nothing committed. No `supabase db push`, no
`migration repair`, no `seed.sql`, no commit/push/deploy. DB URL/keys/
passwords/tokens were never printed to output at any point.

### Part A — read-only baseline (before the transaction)
- Migration history: highest applied version is `0014` (`harden_handle_new_auth_user_search_path`). **Confirmed.**
- `public.programs` / `public.cohorts` / `public.program_courses`: **0 rows** in `information_schema.tables`. **Confirmed absent.**
- No leftover policies on those table names in `pg_policies`. **Confirmed.**
- `public.is_training_staff()` and `public.set_updated_at()` already exist (from 0007/0001). **Confirmed present**, as expected.

### Part B — inside the transaction (`BEGIN` ... `ROLLBACK`)

Migration load:
| Step | Result |
|---|---|
| Load `0015_programs_and_cohorts.sql` | PASS — applied cleanly |
| Load `0016_program_courses.sql` | PASS — applied cleanly |
| Load `0017_rls_academic_catalog.sql` | PASS — applied cleanly |

Constraint tests (each wrapped in its own `SAVEPOINT` / expected error /
`ROLLBACK TO SAVEPOINT`, transaction kept alive throughout):

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Valid program insert | success | PASS |
| 2 | Valid cohort insert under that program | success | PASS |
| 3 | Second valid program insert | success | PASS |
| 4 | Cohort code `K2026` reused under the second program | success (scoped uniqueness) | PASS |
| 5 | Duplicate program `code` | `23505 unique_violation` on `programs_code_key` | PASS (errored as expected) |
| 6 | Duplicate cohort `code` within same program | `23505` on `cohorts_code_unique_per_program` | PASS |
| 7 | Valid `program_courses` insert | success | PASS |
| 8 | Duplicate `(program_id, course_id)` in `program_courses` | `23505` on `program_courses_unique_per_program` | PASS |
| 9 | `program_courses.program_id` FK to nonexistent program | `23503 foreign_key_violation` | PASS |
| 10 | `program_courses.course_id` FK to nonexistent course | `23503` | PASS |
| 11 | `cohorts.program_id` FK to nonexistent program | `23503` | PASS |
| 12 | `pass_score_min = -0.1` | `23514 check_violation` on `programs_pass_score_min_check` | PASS |
| 13 | `pass_score_min = 10.1` | `23514` on `programs_pass_score_min_check` | PASS |
| 14 | `required_credits_min = 0` | `23514` on `programs_required_credits_min_check` | PASS |
| 15 | `elective_credits_min = -1` | `23514` on `programs_elective_credits_min_check` | PASS |
| 16 | `thesis_credits_min = -1` | `23514` on `programs_thesis_credits_min_check` | PASS |
| 17 | `requirement_type = 'BOGUS'` | `23514` on `program_courses_requirement_type_check` | PASS |

RLS tests (real runtime IDs looked up via `public.profiles` joined to
`auth.users` by the demo emails from `apps/api/.env`; IDs used only in
`request.jwt.claims`, never printed):

| # | Test (role) | Expected | Result |
|---|---|---|---|
| 18 | Staff `SELECT` on `programs` | staff sees the rows | PASS (count = 2) |
| 19 | Staff `INSERT` on `programs` | success | PASS |
| 20 | Staff `UPDATE` on `programs` | success | PASS |
| 21 | Staff `INSERT` on `cohorts` | success | PASS |
| 22 | Staff `UPDATE` on `cohorts` | success | PASS |
| 23 | Staff `INSERT` on `program_courses` | success | PASS |
| 24 | Staff `UPDATE` on `program_courses` | success | PASS |
| 25 | Staff `DELETE` on `programs` (no delete policy exists) | 0 rows affected, row still present | PASS — row count unchanged after `DELETE`, confirming there is no delete policy on any of the three tables |
| 26 | Student `SELECT` on `programs`/`cohorts`/`program_courses` | 0 rows each | PASS (all three returned 0) |
| 27 | Student `INSERT` on `programs` | RLS deny (`new row violates row-level security policy`) | PASS (errored as expected) |
| 28 | Student `UPDATE` on `programs` | 0 rows affected (filtered by `USING`, no error) | PASS — `UPDATE` silently matched 0 rows; row confirmed unchanged (`Txn Test Program 1`) when re-read as staff afterward |

All 28 checks passed with no deviations from the expected outcome in §5's
original test plan.

### Part C — after `ROLLBACK`
- `programs` / `cohorts` / `program_courses`: **absent again** (0 rows in `information_schema.tables`). **Confirmed.**
- Migration history: still tops out at `0014`. **Confirmed** — 0015–0017 were never recorded as applied (the test loaded the raw `.sql` files directly inside the transaction, not through `supabase db push`, and the whole transaction was rolled back).
- No `programs`/`cohorts`/`program_courses` policies present in `pg_policies`. **Confirmed.**
- No test rows of any kind remain (querying the tables after rollback errors with "relation does not exist", which is itself proof the tables — and any rows in them — are gone).

### Limitations
- This validates the migration SQL and RLS logic in isolation, run once,
  in a single transaction on Cloud. It does not exercise the Express API
  layer, PostgREST-specific behavior (e.g. `Prefer: return=representation`
  quirks), or concurrent-transaction interactions.
- `is_training_staff()` and `set_updated_at()` were reused as-is from
  0001/0007 (not modified by this batch), consistent with §2's review —
  their correctness was not re-derived here, only their presence and
  effect were exercised indirectly through the constraint/RLS tests above.
- The demo staff/student runtime IDs were resolved once at the start of
  the session and reused for the duration of the transaction; no attempt
  was made to test with additional staff/student accounts or edge-case
  roles (e.g. a STUDENT with `student_status = 'INACTIVE'`, which was not
  relevant to these policies since they only branch on `role`, not
  `student_status`).

**Conclusion: Cloud is clean.** No permanent schema changes, no residual
test data, migration history unchanged at `0014`. Migrations 0015–0017 are
verified to behave as designed and are ready to be applied for real via
the normal `supabase db push` flow, at the user's discretion, in a
separate, explicit step.

---

## 10. Permanent apply — actual results (executed 2026-08-02)

Executed via `supabase db push` (CLI v2.90.0, linked project
`beukhtbkvlghozjhhloi`). No `migration repair`, no raw `psql` mutation, no
`seed.sql`, no commit/push/deploy.

### Preflight (`supabase migration list`)
Local vs. remote diverged only at 0015/0016/0017 (remote missing all
three, 0000–0014 identical). No other pending/unexpected migrations.
**PASS — matched the expected scope exactly, proceeded to apply.**

### Apply (`supabase db push`)
```
Applying migration 0015_programs_and_cohorts.sql...
Applying migration 0016_program_courses.sql...
Applying migration 0017_rls_academic_catalog.sql...
Finished supabase db push.
```
**PASS — all three applied in order, no errors.**

### Post-apply `supabase migration list`
Remote now shows 0000 through 0017, all matching local. **PASS.**

### Post-apply read-only verification (via `supabase db query --linked`)
| Check | Result |
|---|---|
| `programs`, `cohorts`, `program_courses` exist in `information_schema.tables` | PASS — all 3 present |
| Constraints present (PK/FK/UNIQUE/CHECK per §2 tables above) | PASS — all constraints from the migration files found in `pg_constraint`, names match exactly (`cohorts_code_unique_per_program`, `program_courses_requirement_type_check`, `programs_pass_score_min_check`, etc.) |
| RLS enabled on all 3 tables | PASS — `relrowsecurity = true` for all three in `pg_class` |
| Policies: only staff SELECT/INSERT/UPDATE, no DELETE | PASS — `pg_policies` shows exactly 9 rows (3 tables × 3 commands), all `roles = {authenticated}`, no `DELETE` policy anywhere |
| No auto-generated rows | PASS — `count(*)` on all three tables = 0 |

### Seed confirmation
`supabase/seed.sql` was **not** run in this session. Row counts of 0 on
all three tables (checked above) directly confirm no seed data or
migration-generated data exists.

### git status after apply
No files were staged, committed, or modified by this session's actions.
`git status --short` shows only the pre-existing local working-tree state
(uncommitted feature work already present before this session started:
modified `README.md`, `apps/api/**`, `apps/web/**`, `package.json`,
`supabase/seed.sql`; untracked `apps/api/src/routes/academic.ts`,
`apps/api/src/schemas/academic.{ts,test.ts}`, `apps/web/src/pages/staff/
StaffProgram{Detail,s}.tsx`, `docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md`,
`docs/BATCH_1_MIGRATION_PRE_APPLY_REVIEW.md`, and the three
`supabase/migrations/0015-0017` files themselves). None of this was
touched, committed, or pushed by the apply step.

**Conclusion: Batch 1 (0015, 0016, 0017) is now permanently applied to
Supabase Cloud.** Schema/RLS matches design exactly, tables are empty
(seed not run), no other data or code was touched.
