# Batch 2 — Integration Report (demo sync + student profile assignment)

Date: 2026-08-02. Scope: sync the 3 existing demo accounts via
`seedDemoUsers.ts` and assign the 2 demo students' academic profile
(`student_code`, `program`, `cohort`, `academic_status`) via the live Batch 2
API, against the Cloud project (`beukhtbkvlghozjhhloi` /
graduate-course-registration-system). No Auth user created/deleted, no
`supabase/seed.sql` run, no enrollment/class/history/QA/program/cohort data
touched, nothing committed/pushed/deployed. No password/token/key/DB URL was
printed at any point.

---

## 1. Preflight (read-only)

| Check | Result |
|---|---|
| Program `CS-MASTER` exists | **PASS** — `id=55555555-5555-5555-5555-555555555551` |
| Cohort `K2026` exists and belongs to `CS-MASTER` | **PASS** — `id=66666666-6666-6666-6666-666666666661`, `program_id` matches |
| Both demo `STUDENT` rows have `program_id`/`cohort_id`/`student_code` NULL before seeding | **PASS** |
| `HV-DEMO-001` / `HV-DEMO-002` not already in use | **PASS** — 0 rows found |

---

## 2. Seed (`npm run seed:demo-users --workspace apps/api`)

```
[password-synced] staff.demo@example.local already exists (a28e4daa-...)
[synced] staff.demo@example.local -> role=TRAINING_STAFF academic_status=null
[password-synced] student1.demo@example.local already exists (b87addfe-...)
[synced] student1.demo@example.local -> role=STUDENT academic_status=STUDYING
[password-synced] student2.demo@example.local already exists (707f2317-...)
[synced] student2.demo@example.local -> role=STUDENT academic_status=STUDYING
Demo users seeded successfully.
```

All 3 accounts **already existed** (same user IDs as preflight) — no Auth
user was created. **Result: PASS.**

**Note on password — RESOLVED (local-only, not yet deployed):** at the time
this integration test ran, the script's (idempotent) design called
`auth.admin.updateUserById(userId, { password: account.password })` for any
account that already existed, resetting the password to the value already
configured in `apps/api/.env` on every run — the same value it was already
set to, not a new/different credential, but a silent reset nonetheless. This
has since been fixed locally in
`apps/api/src/scripts/seedDemoUsers.ts`: an existing account is now only
ever re-synced (`role`/`student_status`/`academic_status`), never
password-reset, unless the caller explicitly opts in with
`SEED_RESET_DEMO_PASSWORDS=true`. See
[docs/BATCH_2_HARDENING_PRE_APPLY_REVIEW.md](BATCH_2_HARDENING_PRE_APPLY_REVIEW.md)
for the fix details, the extracted `decideAccountAction` pure function, and
its unit tests. This code change is **local-only** — not committed, not
pushed, not deployed — so it does not retroactively change what happened
during this integration run (recorded above for the record).

### Post-seed verification

| Check | Result |
|---|---|
| Staff: `role=TRAINING_STAFF`, `academic_status=NULL` | **PASS** |
| Student 1 & 2: `role=STUDENT`, `academic_status=STUDYING` | **PASS** |
| Student 1 & 2: `student_status=ACTIVE` | **PASS** |
| Same 3 profile IDs as before seeding (no new/duplicate rows) | **PASS** |

---

## 3. API / RBAC test (local API, current Batch 2 code, demo JWTs)

The API was already running locally (port 4000) with the current working-tree
code, including the untracked Batch 2 routes
(`apps/api/src/routes/students.ts`). Confirmed reachable and serving
`/api/staff/students` before use. Demo JWTs were obtained via
`supabase.auth.signInWithPassword` (publishable key) for all 3 demo accounts;
tokens/emails were never printed. `CS-MASTER`/`K2026` IDs from preflight were
used directly as request payload values.

| # | Case | Result |
|---|---|---|
| 1 | `GET /api/staff/students` (staff JWT) → `200` | **PASS** |
| 2 | `PATCH /api/staff/students/:id` for student 1 — `student_code=HV-DEMO-001`, `full_name=Demo Student One`, `programId=CS-MASTER`, `cohortId=K2026`, `academicStatus=STUDYING` → `200 {success:true}` | **PASS** |
| 3 | `PATCH /api/staff/students/:id` for student 2 — `student_code=HV-DEMO-002`, `full_name=Demo Student Two`, same program/cohort/status → `200 {success:true}` | **PASS** |
| 4 | First-time program/cohort assignment succeeded despite existing enrollment history (both demo students have prior `enrollments` rows) | **PASS** — matches the `profiles_academic_guard` "first assignment always allowed" rule from Batch 2's migration; no lock error was raised |
| 5 | `GET /api/staff/students/:id` (detail) for both students after PATCH: `student_code`, `full_name`, `program_id`, `cohort_id`, `academic_status` all persisted as set | **PASS** |
| 6 | `GET /api/student/profile` as student 1 → own row only, own email, `student_code=HV-DEMO-001`, `CS-MASTER`/`K2026`, `STUDYING` | **PASS** |
| 7 | `GET /api/student/profile` as student 2 → own row only, own email, `student_code=HV-DEMO-002`, `CS-MASTER`/`K2026`, `STUDYING` | **PASS** |
| 8 | `GET /api/staff/students` called with a **student** JWT → `403 FORBIDDEN` | **PASS** |
| 9 | Student 1 attempting to read another student's profile (no `student_id` parameter exists on `/api/student/profile`; passing an extraneous `studentId` query param is ignored) → still returns only student 1's own row | **PASS** — confirms no arbitrary-ID lookup path is exposed |

**No case failed.** (One assertion bug in the throwaway test harness script
mis-read the PATCH response shape and initially flagged false negatives on
cases 2/3 — corrected by inspecting the raw JSON, which showed
`{"success":true, ...}` in both cases; not an application defect.)

---

## 4. Post-check (read-only, Cloud)

| Check | Result |
|---|---|
| Exactly 2 `STUDENT` rows have `program_id IS NOT NULL` | **PASS** — count = 2 |
| Staff row `academic_status` still `NULL` (unaffected by student assignment) | **PASS** |
| `enrollments` row count unchanged (6, same as pre-existing) | **PASS** — no enrollment/class/history data touched |
| No other program/cohort/QA rows modified (only `CS-MASTER`/`K2026`, both pre-existing, were referenced — read-only lookups) | **PASS** |

Local API dev server (already running before this task, on port `:4000`) was
stopped after testing.

---

## 5. Cloud data changes now permanently in place

- **Auth**: no user created or deleted. Existing password values for the 3
  demo accounts were re-asserted to their already-configured `.env` value by
  `seedDemoUsers.ts` (see note in §2) — not changed to a new value.
- **`public.profiles`**:
  - Staff demo row: `full_name`, `role`, `student_status`, `academic_status`
    re-synced to `TRAINING_STAFF` / `NULL` / `NULL` (already in that state
    before this run).
  - Student 1 (`b87addfe-...`): `student_code=HV-DEMO-001`, `full_name=Demo
    Student One`, `program_id=CS-MASTER`, `cohort_id=K2026`,
    `academic_status=STUDYING` (new — previously all NULL/unassigned except
    `academic_status`, which was already `STUDYING`).
  - Student 2 (`707f2317-...`): `student_code=HV-DEMO-002`, `full_name=Demo
    Student Two`, `program_id=CS-MASTER`, `cohort_id=K2026`,
    `academic_status=STUDYING` (same as above).
- No other rows in `profiles`, `programs`, `cohorts`, `enrollments`, or any
  other table were created, modified, or deleted.

---

## 6. Limitations

- **Production/staging UI for Batch 2 was not tested.** All verification in
  this task went through direct HTTP calls to the local API
  (`localhost:4000`) using demo JWTs obtained via
  `signInWithPassword` — the staff "Học viên" list/detail/edit screens and
  the student profile screen (`apps/web/src/pages/staff/StaffStudents.tsx`,
  `StaffStudentDetail.tsx`, `apps/web/src/pages/student/StudentProfile.tsx`,
  all currently untracked/uncommitted) were not exercised in a browser. A
  follow-up manual/browser UI pass against these pages is still needed before
  considering Batch 2's frontend production-ready.
- The seed script's password-reset-on-every-run behavior (§2 note) is
  pre-existing and out of scope for this task; flagging it as something to
  revisit if "never touch existing credentials" becomes a hard requirement
  going forward (e.g. by skipping the password update when the account
  already exists).

---

## 7. Git status

No files were staged, committed, or pushed. Working tree state is unchanged
by this task (only Cloud DB rows changed, plus this new report file):

```
On branch main, up to date with origin/main.

Modified (pre-existing, not touched by this task):
  apps/api/src/index.ts
  apps/api/src/scripts/seedDemoUsers.ts
  apps/web/src/App.tsx
  apps/web/src/components/StaffNav.tsx
  apps/web/src/components/StudentNav.tsx
  apps/web/src/styles.css
  apps/web/src/types/api.ts
  docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md

Untracked (pre-existing, not touched by this task):
  apps/api/src/routes/students.ts
  apps/api/src/schemas/students.test.ts
  apps/api/src/schemas/students.ts
  apps/web/src/pages/staff/StaffStudentDetail.tsx
  apps/web/src/pages/staff/StaffStudents.tsx
  apps/web/src/pages/student/StudentProfile.tsx
  docs/BATCH_2_IMPLEMENTATION_REPORT.md
  docs/BATCH_2_PRE_APPLY_SECURITY_REVIEW.md
  supabase/migrations/0018_profiles_academic_extension.sql
  supabase/migrations/0019_rpc_student_profiles.sql

New (added by this task):
  docs/BATCH_2_INTEGRATION_REPORT.md
```

---

## Verdict

**PASS end-to-end.** Demo accounts synced correctly (no new Auth users, no
password value changes beyond re-asserting the existing configured value),
both demo students assigned `CS-MASTER`/`K2026`/`STUDYING`/their intended
`student_code` via the live staff API despite pre-existing enrollment
history (correctly allowed as a first assignment), self-service student
profile reads are correctly scoped to the caller's own row, and staff-only
RBAC correctly rejects student callers with `403`. Exactly 2 students show a
new assignment; no other data was affected. Nothing committed, pushed, or
deployed. Remaining gap: Batch 2 frontend UI has not been exercised in a
browser.
