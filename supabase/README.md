# Supabase schema

PostgreSQL schema, RLS policies and RPC functions for the graduate course
registration system, implementing the business rules chốt in
[`../../BA_Portfolio_Graduate_Course_Registration/03_Business_Rules.md`](../../BA_Portfolio_Graduate_Course_Registration/03_Business_Rules.md).

## Layout

```
supabase/
├── migrations/
│   ├── 0000_extensions.sql                     # pgcrypto for gen_random_uuid()
│   ├── 0001_profiles.sql                       # profiles + auto-provision trigger
│   ├── 0002_semesters_and_registration_periods.sql
│   ├── 0003_courses_and_classes.sql
│   ├── 0004_class_schedules.sql
│   ├── 0005_enrollments.sql
│   ├── 0006_enrollment_history.sql             # append-only, update/delete blocked
│   ├── 0007_rls_policies.sql                   # RLS + is_training_staff()/is_active_student() helpers
│   ├── 0008_rpc_register_for_class.sql
│   ├── 0009_rpc_cancel_own_enrollment.sql
│   ├── 0010_rpc_cancel_course_class.sql
│   ├── 0011_rpc_get_registration_classes.sql
│   └── 0012_rpc_create_course_class.sql
└── seed.sql                                    # reference/demo data, no auth users
```

Migrations are numbered and must be applied in order. Each file is scoped to one
concern so a reviewer can trace a migration back to the business rule(s) it
implements (referenced in the file's header comment).

## Applying migrations

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and a linked
project (see [`../docs/SETUP_SUPABASE.md`](../docs/SETUP_SUPABASE.md) for the
full first-time setup).

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`supabase db push` applies every file under `migrations/` that hasn't been
applied yet, in filename order.

## Seeding reference data

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

`seed.sql` is idempotent (`ON CONFLICT DO NOTHING` on every insert) and creates
only reference/demo data: one semester, one registration period, four courses,
four classes and their weekly schedules. It intentionally does **not** create
any `auth.users` rows — see the root `README.md` and
[`../docs/SETUP_SUPABASE.md`](../docs/SETUP_SUPABASE.md) for the separate
`npm run seed:demo-users` script that provisions demo accounts.

## Design notes

- **No ORM.** Migrations are plain SQL, applied via the Supabase CLI/`psql`.
- **No stored seat counters.** `course_classes` has no "available seats" column;
  confirmed seats are always computed by counting `enrollments` rows with
  `status = 'CONFIRMED'` (see `get_registration_classes` and
  `register_for_class`).
- **No `semester_id` on `enrollments`.** The semester is derived by joining
  `enrollments -> course_classes -> registration_periods -> semesters`.
- **Atomic seat allocation (BUS-07).** `register_for_class` takes
  `select ... for update` on the target `course_classes` row before checking
  seat availability, which serializes concurrent registration attempts against
  the same class within Postgres — no advisory locks or application-level
  mutexes are needed.
- **Atomic per-student checks (BUS-03/BUS-04/BUS-05).** `register_for_class`
  and `cancel_own_enrollment` both also take `select ... for update` on the
  caller's own `profiles` row before reading/writing `enrollments`. This
  serializes every registration/cancellation attempt by the same student —
  even across different classes — so two concurrent requests can't both read
  a stale confirmed-credit total or both pass the duplicate-course/schedule
  checks. See the header comments in `0008_rpc_register_for_class.sql` and
  `0009_rpc_cancel_own_enrollment.sql`, and
  [`../docs/DB_CONCURRENCY_TEST_PLAN.md`](../docs/DB_CONCURRENCY_TEST_PLAN.md)
  for a reproducible manual test of this behavior.
- **`get_registration_classes` is student-only.** It raises if the caller is
  not an ACTIVE STUDENT (`public.is_active_student()`); training staff use
  their own routes/queries instead.
- **RLS is not the only guard.** All policies are written to be as narrow as
  possible (no `USING (true)` outside read-only reference tables), the RLS
  helper functions (`is_training_staff()`, `is_active_student()`,
  `current_role_name()`) are only grantable to `authenticated` (not `public`),
  and the Express API in `apps/api` independently verifies the caller's JWT
  and role before calling any RPC — see `apps/api/src/middleware`.
