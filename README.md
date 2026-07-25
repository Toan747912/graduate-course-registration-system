# Graduate Course Registration System

Phase 1 codebase for the business analysis portfolio at
[`../BA_Portfolio_Graduate_Course_Registration/`](../BA_Portfolio_Graduate_Course_Registration/README.md).
This phase builds the monorepo skeleton, the Supabase PostgreSQL schema, RLS
policies, and the core-business RPC functions described in that portfolio. It
does **not** yet implement the full business UI — see [Phase 1 scope](#phase-1-scope).

## Architecture

```
graduate-course-registration-system/
├── apps/
│   ├── web/     React + Vite + React Router frontend. Calls apps/api only —
│   │            never talks to Supabase tables directly for business writes.
│   └── api/     Node.js + Express + TypeScript backend. Verifies the Supabase
│                JWT and role on every request, then calls Postgres RPC
│                functions — it does not reimplement business logic in JS.
├── supabase/
│   ├── migrations/   Numbered SQL migrations: schema, RLS, RPC functions.
│   └── seed.sql       Idempotent reference/demo data (no auth users).
├── docs/
│   ├── SETUP_SUPABASE.md              Full Supabase Cloud setup walkthrough.
│   └── DB_CONCURRENCY_TEST_PLAN.md    Manual test plan for RPC locking/authorization.
└── .env.example
```

- **Database/Auth:** Supabase Cloud (PostgreSQL + Supabase Auth + Row Level
  Security). No ORM — migrations are plain SQL, applied via the Supabase CLI.
- **Authorization is layered, not RLS-only:** RLS policies exist on every
  table, but `apps/api` independently verifies the JWT and role before calling
  any RPC (see `apps/api/src/middleware`). The running server only ever holds
  the Publishable key, scoping every request to the caller's own JWT so RLS
  stays in force; the Secret key is used only by the local
  `seed:demo-users` script and is never sent to the frontend.
- All enrollment writes go through four SECURITY DEFINER RPC functions
  (`register_for_class`, `cancel_own_enrollment`, `cancel_course_class`,
  `get_registration_classes`) so the business rules live in one place. See
  [`supabase/README.md`](supabase/README.md) for details.

## Phase 1 scope

**Built in this phase:**
- Monorepo workspaces for `apps/web` and `apps/api`.
- Full Supabase schema: `profiles`, `semesters`, `registration_periods`,
  `courses`, `course_classes`, `class_schedules`, `enrollments`,
  `enrollment_history`.
- RLS policies for every table and the four core RPC functions.
- Express route skeleton with JWT/role middleware and Zod validation, calling
  the RPCs (no reimplemented business logic).
- React routing/layout with frontend role guards and placeholder pages.
- Idempotent `seed.sql` (reference/demo data) and a separate
  `seed:demo-users` script for auth accounts.

**Not built in this phase (see the BA portfolio for what's in/out of scope
overall):** complete business forms and UI, styling, prerequisite courses,
tuition, grades, thesis, exam schedules, notifications, fine-grained admin
permissions.

## Running locally

Requires Node.js 20+, npm, and a Supabase Cloud project (see
[`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md) for the full first-time
walkthrough — creating the project, migrations, seeding, demo users).

```bash
npm install
cp apps/web/.env.example apps/web/.env   # fill in Supabase URL + Publishable key
cp apps/api/.env.example apps/api/.env   # fill in Supabase URL + Publishable + Secret keys

npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:5173

npm run typecheck
npm run lint
```

## Business analysis reference

This codebase implements the business rules, use cases and data model chốt in
the BA portfolio:

- [Project Charter](../BA_Portfolio_Graduate_Course_Registration/00_Project_Charter.md)
- [Business Rules (BUS-01..BUS-15)](../BA_Portfolio_Graduate_Course_Registration/03_Business_Rules.md)
- [Use Cases](../BA_Portfolio_Graduate_Course_Registration/04_Use_Cases.md)
- [Data Model](../BA_Portfolio_Graduate_Course_Registration/07_Data_Model.md)
- [Test Cases](../BA_Portfolio_Graduate_Course_Registration/08_Test_Cases.md)

Each SQL migration file references the business rule code(s) it implements in
its header comment, for traceability back to the portfolio.

Concurrency-safety and RPC-authorization behavior (row locking in
`register_for_class`/`cancel_own_enrollment`, and the student-only restriction
on `get_registration_classes`) is documented and manually reproducible via
[`docs/DB_CONCURRENCY_TEST_PLAN.md`](docs/DB_CONCURRENCY_TEST_PLAN.md).
