# Batch 1 — Integration Report (seed + read-only API/UI/RBAC/RLS test)

Executed 2026-08-02 against Supabase Cloud (project `beukhtbkvlghozjhhloi`),
using demo staff/student accounts. All actions were read-only against
business data: no program/cohort/program_course/class/enrollment/grade/
thesis record was created, edited, or deleted through UI or API. No
commit/push/deploy happened. No secret, password, token, or DB URL was
printed at any point (env values were sourced into shell variables and
only their *lengths* or booleans were echoed for confirmation).

---

## Part A — Seed pre-check (done before running)

Read `supabase/seed.sql` in full. Findings:

- Every statement is `INSERT ... ON CONFLICT ... DO NOTHING`. **No
  `DELETE`, `TRUNCATE`, or `UPDATE` statement anywhere in the file.**
- No statement touches `enrollments`, `enrollment_history`, or any audit
  table — those are never referenced.
- Batch 1 section (lines 52-87) inserts exactly:
  - 1 program: `CS-MASTER` ("Thạc sĩ Khoa học Máy tính")
  - 1 cohort: `K2026` under `CS-MASTER`
  - 4 `program_courses` rows for `CS-MASTER`: CS601/CS602/CS603 =
    `REQUIRED`, MG601 = `ELECTIVE`
- Matches the expected scope exactly. **No out-of-scope effects found —
  proceeded to run.**

---

## Part B — Seed run (actual results)

Ran `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql`,
with `SUPABASE_DB_URL` sourced from `apps/api/.env` into a shell variable,
never echoed. Command succeeded, no error, `ON_ERROR_STOP=1` never
triggered.

Insert results per statement, in file order:
| Statement (table) | Rows inserted this run |
|---|---|
| `semesters` | 0 (already existed from a prior session) |
| `registration_periods` | 0 (already existed) |
| `courses` | 0 (already existed) |
| `course_classes` | 0 (already existed) |
| `class_schedules` | 0 (already existed) |
| `programs` | **1** (CS-MASTER — new) |
| `cohorts` | **1** (K2026 — new) |
| `program_courses` | **4** (new) |

Post-seed read-only verification (via `supabase db query --linked`):

| Check | Result |
|---|---|
| `programs` contains `CS-MASTER` with correct fields (20/6/5.0/12) | PASS |
| `cohorts` contains `K2026` under `CS-MASTER` | PASS |
| `program_courses` has exactly 4 rows for `CS-MASTER`: CS601/CS602/CS603 REQUIRED, MG601 ELECTIVE | PASS |
| Existing module row counts unaffected: `semesters`=1, `registration_periods`=1, `courses`=4, `course_classes`=6, `class_schedules`=8, `enrollments`=6, `enrollment_history`=8 | PASS — all pre-existing, none touched by this run |

Seed was run **once**; not re-run.

---

## Part C — API/UI/RBAC/RLS read-only test

Started `npm run dev` locally (API on `:4000`, web/Vite on `:5173`)
against the seeded Cloud DB, then stopped both processes after testing.

### Staff demo (TRAINING_STAFF)

| Case | Result |
|---|---|
| Login via Supabase password grant | PASS |
| `GET /api/staff/programs` returns `CS-MASTER` with correct fields | PASS |
| `GET /api/staff/cohorts` returns `K2026` (program_id → CS-MASTER) | PASS |
| `GET /api/staff/program-courses` returns exactly 4 mappings (3 REQUIRED + 1 ELECTIVE), joined course codes/names correct | PASS |
| Frontend route guard (`apps/web/src/routes/RequireRole.tsx`) allows `TRAINING_STAFF` on `/staff/programs` and `/staff/programs/:id` | PASS (confirmed by code trace — `allow=['TRAINING_STAFF']` on both routes in `App.tsx`) |
| `StaffPrograms.tsx` load-state logic | PASS by trace — `apiFetch` returned a 1-element array, so `state` resolves to `'ready'` (table view), never `'error'` or stuck `'loading'`; no `'empty'` state possible now that seed data exists |
| No create/edit button was clicked | Confirmed — only `GET` requests were issued (via curl to the API), no `POST`/`PATCH`/`DELETE` call made against academic endpoints in this session |

### Student demo (STUDENT)

| Case | Result |
|---|---|
| Login via Supabase password grant | PASS |
| `GET /api/student/semesters` (existing module) still returns data | PASS — returns the seeded `2026-1` semester |
| `GET /api/student/enrollments/history` (existing module) still returns full prior history unchanged (6 records, including CONFIRMED/CANCELLED_BY_SCHOOL/REJECTED/CANCELLED_BY_STUDENT rows from before this session) | PASS |
| `GET /api/staff/programs`, `/api/staff/cohorts`, `/api/staff/program-courses` via Express | PASS — all three return `403 FORBIDDEN` (`"Requires role: TRAINING_STAFF"`), enforced by `requireRole('TRAINING_STAFF')` middleware |
| Direct PostgREST `GET .../rest/v1/programs`, `/cohorts`, `/program_courses` as student (bypassing Express, hitting RLS directly) | PASS — all three return `200` with `[]` (RLS filters every row; student has no `SELECT` visibility per §RLS policies from Batch 1's `0017` migration) |
| Frontend route guard on `/staff/programs*` for a STUDENT profile | PASS by code trace — `RequireRole` redirects any role not in `allow` to `HOME_PATH_BY_ROLE[role]` (`/student/classes` for STUDENT), confirmed in `apps/web/src/routes/RequireRole.tsx:35-37` |

### Existing module (registration) — unaffected check
Student's enrollment history returned identical historical rows (same
IDs, statuses, timestamps) as would be expected pre-seed — confirms Batch
1's seed and migrations had zero side effects on `enrollments` /
`enrollment_history` / `course_classes` data.

---

## Limitations

- **No literal browser/screenshot testing was performed** — this
  environment has no browser-automation tool available. UI-level claims
  (loading/empty/error state, route redirect) are verified by: (a) the
  exact API responses the components consume, and (b) direct code trace
  of `StaffPrograms.tsx`, `StaffProgramDetail.tsx`, and `RequireRole.tsx`
  against those responses — not by visually rendering the page in a
  browser.
- **No CRUD write path was tested via UI or API in this session** — per
  the granted scope, only `GET` requests were issued against
  `/api/staff/programs`, `/api/staff/cohorts`, `/api/staff/program-courses`,
  `/api/student/semesters`, `/api/student/enrollments/history`, and the
  three PostgREST `GET` endpoints. `POST`/`PATCH`/`DELETE` behavior for
  programs/cohorts/program_courses (create/edit forms visible in
  `StaffPrograms.tsx`) remains unverified against Cloud.
- `StaffProgramDetail.tsx` was read at the code level as part of the
  route-guard check but its live data-fetch behavior was not separately
  curl-tested (only the list-level `/api/staff/*` endpoints were).

---

## Cloud changes made in this session

The **only** permanent state change made in this session was running
`supabase/seed.sql`, which added exactly:
- 1 row to `public.programs` (`CS-MASTER`)
- 1 row to `public.cohorts` (`K2026`)
- 4 rows to `public.program_courses`

No other insert, update, or delete was issued against Cloud. (Migrations
0015-0017 themselves were applied in a prior, separate session — not part
of this one.)

---

## Part D — Staff write-path (CRUD) test, 2026-08-02

Executed as a follow-up session, still against Supabase Cloud (project
`beukhtbkvlghozjhhloi`). Scope: exercise `POST`/`PATCH` on
`/api/staff/programs`, `/api/staff/cohorts`, `/api/staff/program-courses`
using QA-only data, plus negative cases (duplicate code, invalid payload)
and RBAC (student attempting staff writes). No migration/seed/db-push was
run. No existing `semesters`/`courses`/`classes`/`enrollments`/`history`
row was touched.

### Preflight

| Check | Result |
|---|---|
| `QA-GSMS-2026-01` not present in `GET /api/staff/programs` before test | PASS — only `CS-MASTER` existed |
| API started locally (`apps/api`) against Cloud DB; a prior local instance was already listening on `:4000` from an earlier session — reused it instead of starting a duplicate | OK |
| Staff demo login via Supabase password grant (`DEMO_STAFF_EMAIL`/`DEMO_STAFF_PASSWORD` from `apps/api/.env`) | PASS — no credential/token printed, only token length echoed |
| Student demo login via Supabase password grant (`DEMO_STUDENT1_EMAIL`/`DEMO_STUDENT1_PASSWORD`) | PASS — same, no secret printed |

### Staff API write cases

| Case | HTTP | Result |
|---|---|---|
| `POST /api/staff/programs` — create `QA-GSMS-2026-01` | 201 | PASS |
| `GET /api/staff/programs/:id` after create | 200 | PASS — fields match insert |
| `PATCH /api/staff/programs/:id` — rename to "QA Test Program (Renamed)" | 200 | PASS |
| `GET /api/staff/programs/:id` after rename | 200 | PASS — `name` persisted as renamed |
| `POST /api/staff/cohorts` — create `QA-K2026-01` under QA program | 201 | PASS |
| `PATCH /api/staff/cohorts/:id` — rename to "QA Cohort 2026-01 (Renamed)" | 200 | PASS |
| `GET /api/staff/cohorts?programId=` after rename | 200 | PASS — `name` persisted |
| `GET /api/staff/courses` (read-only, to pick a demo course) | 200 | PASS — used existing `CS601` (`Advanced Algorithms`) |
| `POST /api/staff/program-courses` — map `CS601` to QA program as `REQUIRED` | 201 | PASS |
| `PATCH /api/staff/program-courses/:id` — `REQUIRED` → `ELECTIVE` | 200 | PASS |
| `GET /api/staff/program-courses?programId=` after ELECTIVE | 200 | PASS — persisted as `ELECTIVE` |
| `PATCH /api/staff/program-courses/:id` — `ELECTIVE` → `REQUIRED` | 200 | PASS |
| `GET /api/staff/program-courses?programId=` after final REQUIRED | 200 | PASS — persisted as `REQUIRED` |
| `POST /api/staff/programs` with duplicate `code: QA-GSMS-2026-01` | 409 | PASS — `PROGRAM_CODE_EXISTS`, no row created |
| `POST /api/staff/programs` with invalid payload (empty strings, negative/oversized numbers, wrong type) | 400 | PASS — `VALIDATION_ERROR` with per-field messages, no row created |
| `GET /api/staff/programs` after both negative cases | 200 | PASS — still exactly 2 programs (`CS-MASTER`, `QA-GSMS-2026-01`), no extra/partial row |

### RBAC (student demo vs. staff endpoints)

| Case | HTTP | Result |
|---|---|---|
| Student `POST /api/staff/programs` | 403 | PASS — `FORBIDDEN` / "Requires role: TRAINING_STAFF" |
| Student `PATCH /api/staff/programs/:id` (QA program) | 403 | PASS |
| Student `POST /api/staff/cohorts` | 403 | PASS |
| Student `POST /api/staff/program-courses` | 403 | PASS |
| Verify QA program name unaffected after student attempts | — | PASS — still "QA Test Program (Renamed)", no student-authored row exists |

### UI

No browser-automation tool was available in this session. UI write paths
(`StaffPrograms.tsx` create/edit forms, `StaffProgramDetail.tsx` mapping
editor) were **not** exercised or visually verified this session — this
is an explicit gap, not a claimed pass.

### Existing-module unaffected check

| Check | Result |
|---|---|
| `GET /api/student/semesters` | 200, unchanged |
| `GET /api/student/enrollments/history` | 200, same historical records |
| `GET /api/staff/courses` | 200, still 4 courses (unchanged) |
| `GET /api/staff/course-classes` | 200, reachable/unchanged |

No write of any kind was issued against `semesters`, `courses`,
`course_classes`, `class_schedules`, `enrollments`, or
`enrollment_history` in this session.

### Final QA data (kept, not hard-deleted)

| Entity | Count | Final state |
|---|---|---|
| `programs` (`QA-GSMS-2026-01`) | 1 | name = "QA Test Program (Renamed)" |
| `cohorts` (`QA-K2026-01`) | 1 | name = "QA Cohort 2026-01 (Renamed)", under QA program |
| `program_courses` (QA program × `CS601`) | 1 | `requirement_type = REQUIRED` |

### Cloud changes made in this session

Exactly 3 permanent rows added (all QA artifacts, intentionally kept):
1 `programs` row, 1 `cohorts` row, 1 `program_courses` row. No update or
delete touched any pre-existing row in any table. No secret/token/DB URL
was printed at any point (only token byte-lengths were echoed for
confirmation).

### Servers stopped

Both the local API (`:4000`) and web/Vite (`:5173`) dev servers — found
already running from an earlier session, not started fresh in this one —
were stopped at the end of testing (`taskkill`), per scope. No
commit/push/deploy was performed.

---

## git status (end of session)

```
 M README.md
 M apps/api/package.json
 M apps/api/src/index.ts
 M apps/web/src/App.tsx
 M apps/web/src/components/StaffNav.tsx
 M apps/web/src/types/api.ts
 M package.json
 M supabase/seed.sql
?? apps/api/src/routes/academic.ts
?? apps/api/src/schemas/academic.test.ts
?? apps/api/src/schemas/academic.ts
?? apps/web/src/pages/staff/StaffProgramDetail.tsx
?? apps/web/src/pages/staff/StaffPrograms.tsx
?? docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md
?? docs/BATCH_1_MIGRATION_PRE_APPLY_REVIEW.md
?? supabase/migrations/0015_programs_and_cohorts.sql
?? supabase/migrations/0016_program_courses.sql
?? supabase/migrations/0017_rls_academic_catalog.sql
```

Identical to the pre-existing working-tree state from before this
session — nothing was staged, committed, or modified by seed/test
activity (this new file, `docs/BATCH_1_INTEGRATION_REPORT.md`, is
untracked and additive only). No commit, push, or deploy was performed.
