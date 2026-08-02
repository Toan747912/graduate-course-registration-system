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

## Part E — Commit, push, production deploy verification, 2026-08-02

### Pre-commit checks

| Check | Result |
|---|---|
| `git diff --check` | PASS — no conflict markers/whitespace errors (only CRLF-normalization notices, expected on this Windows checkout) |
| `npm run typecheck` (api + web) | PASS |
| `npm run lint` (api + web) | PASS — 0 errors, 1 pre-existing unrelated warning (`AuthContext.tsx` react-refresh) |
| `npm run build` (api + web) | PASS |
| `npm run test` (api + web) | PASS — 11/11 api tests, 3/3 web tests |
| Secret/`.env`/DB-URL scan of staged diff | PASS — no match (only a comment in `seed.sql` warning against using the service_role key) |
| Cloud migration state (`supabase migration list --linked`) | PASS — remote has `0000`-`0017` applied, identical to local; no pending migration |

### Commit

- Staged exactly the 19 Batch 1 files listed in scope (verified via `git status` before commit — no `.env`, `dist`, `node_modules`, or unrelated file staged).
- Commit hash: **`860c6e0`**
- Message: `feat: add academic program catalog management`

### Push

`git push origin main` → `d4d08ce..860c6e0  main -> main` (success).

### Post-push state

```
git status: On branch main, up to date with 'origin/main', nothing to commit, working tree clean
git log -1 --oneline: 860c6e0 feat: add academic program catalog management
git branch -vv: * main 860c6e0 [origin/main] feat: add academic program catalog management
```

### Deploy trigger confirmation

Checked via `gh api repos/.../deployments` (GitHub Deployments API, read-only):
- A `vercel[bot]` Production deployment was created for `sha=860c6e0` (exact match to the pushed commit) at `2026-08-02T03:36:15Z`, status **`success`** ("Deployment has completed").
- No equivalent GitHub Deployments entry exists for Render (Render does not register GitHub Deployments); Render deploy-on-push was inferred from the health-check response below (cold-start latency consistent with a fresh instance) — not confirmed via a Render dashboard/API call, since no Render API token is available in this session.

### Production read-only checks

| Check | Result |
|---|---|
| `GET https://gcrs-api.onrender.com/api/health` | **200**, `{"ok":true,"data":{"status":"ok","service":"gcrs-api"}}` (~22s response time — consistent with Render free-tier cold start after a fresh deploy) |
| Vercel production domain `https://graduate-course-registration-system.vercel.app/` | **200**, serves the SPA `index.html` |
| Vercel production `/staff/programs` | **200** (no 404 — client-side route rewrite working) |
| Note | The deployment's own `environment_url`/`target_url` (`https://graduate-course-registration-system-dqzuso6u1.vercel.app`) is protected by Vercel's SSO/Deployment Protection and redirects to a Vercel login — this is expected for the per-deployment URL, not a failure; the alias domain above is the one actually reachable and was used for verification |

No `POST`/`PATCH`/`DELETE` request was made against production in this step — only `GET`.

### UI limitation

No browser-automation tool is available in this session. The 200 status
on `/staff/programs` confirms the server returns the SPA shell for that
route (no 404), but **actual rendering of the QA program list in a
browser, and any create/edit form interaction, was not visually
verified**. This is an explicit gap — the user should confirm this
manually.

### What the user should test directly on production

Staff → Chương trình đào tạo → tạo/sửa program, cohort, program-course
(the actual UI create/edit flows) — not exercised in this or the prior
session against the production deployment; only the local API (Batch 1
Part D) and now the production static-route reachability have been
verified.

### Secret/credential confirmation

No secret, API key, password, or DB URL appears anywhere in this report
or in the commands run in this session — only public URLs, HTTP status
codes, commit hashes, and byte-length confirmations of local env values
were used/recorded.

---

## Part F — Production UI E2E CRUD test (Batch 1), 2026-08-02

Executed against the live Vercel production URL
`https://graduate-course-registration-system.vercel.app`, all writes done
through the actual rendered UI (form fill + button click), no direct
`POST`/`PATCH` calls. No code was modified. No commit/push/deploy was
performed.

### Browser tool used

No MCP browser-automation tool was available in this session. Per the
task's explicit fallback rule, **Playwright (Chromium) was installed
temporarily outside the repository**, in the session scratchpad directory
only (`…/scratchpad/e2e`, a temp-npm project with its own
`package.json`/`node_modules`). The project's own `package.json`,
`package-lock.json`, and `node_modules` were never touched. The temporary
scratchpad npm project and Playwright script files were the only things
created for this test; the repo itself has zero diff from this work.

### Login

Logged in via the real `/login` form using `DEMO_STAFF_EMAIL` /
`DEMO_STAFF_PASSWORD` sourced from `apps/api/.env` (values never printed —
only used to `page.fill()` the form fields in-process). Redirected to
`/staff` on success.

### Test cases

| # | Case | Result |
|---|---|---|
| 1 | Open production URL | PASS |
| 2 | Login as staff demo | PASS |
| 3 | Navigate to `/staff/programs` via nav link | PASS |
| 4 | Pre-check: `QA-UI-2026-01` not already present (no duplicate risk) | PASS |
| 5 | Create program via UI form (code `QA-UI-2026-01`, name `QA UI Program`, required credits 20, elective credits 6, passing score 5, min credits before thesis 12) | PASS |
| 6 | New row appears in the programs table after create | PASS |
| 7 | Click "Quản lý" for the new program row → opens detail page | PASS |
| 8 | Rename program to `QA UI Program (Updated)` via detail-page form, submit | PASS |
| 9 | Persistence check: navigate away (programs list) and back to detail via UI → name still `QA UI Program (Updated)` | PASS |
| 10 | Create cohort via UI form (code `QA-UI-K2026-01`, name `QA UI Cohort 2026`) | PASS |
| 11 | Persistence check: navigate away and back → cohort row present, no duplicate | PASS |
| 12 | Assign `CS602` to the program as `REQUIRED` via the "Gán môn học" form | PASS |
| 13 | Persistence check: navigate away and back → `CS602` present in program-courses table | PASS |
| 14 | Toggle `REQUIRED → ELECTIVE` (click "Đổi thành Tự chọn"), verify via badge (not button label) after navigating away and back | PASS |
| 15 | Toggle `ELECTIVE → REQUIRED` (click "Đổi thành Bắt buộc"), verify via badge after navigating away and back | PASS |
| 16 | Final refresh-equivalent (navigate away and back) shows: `QA UI Program (Updated)`, `QA-UI-K2026-01` / `QA UI Cohort 2026`, `CS602` = `Bắt buộc` (REQUIRED) | PASS |
| 17 | Exactly 1 QA-UI program row, 1 QA-UI cohort row, 1 `CS602` mapping row (no double-submit duplicates) | PASS |
| 18 | Console/network errors during the final verification run | PASS — none (`[]`) |

### Screenshot

Final production screenshot (state after all steps) is at
`…/scratchpad/e2e/shots/62_final_state.png` (session-scratchpad only, not
committed to the repo). It shows the program card titled
`QA-UI-2026-01 — QA UI Program (Updated)`, the cohort table with
`QA-UI-K2026-01 / QA UI Cohort 2026`, and the program-courses table with
`CS602 / Distributed Systems / 3 / Bắt buộc`.

### Self-correction during testing (documented for transparency)

Two issues surfaced during the test were both bugs in the **test script**,
not the application, confirmed by direct inspection of API request/response
bodies:
1. An early run used `page.reload()` (hard F5) on a nested detail route
   (`/staff/programs/:id`) to check persistence; this app redirects a hard
   refresh on that route back to `/staff` (a real, observed SPA
   deep-link/hard-refresh limitation — see below), which made a
   successfully-saved rename look like a failure. Fixed by verifying
   persistence via in-app navigation (click list → click "Quản lý" again)
   instead of a hard reload.
2. A CS602 state-check helper matched `/Bắt buộc/` against the *entire
   table row* text, which also matched the toggle button's own label
   ("Đổi thành **Bắt buộc**") even when the actual badge showed "Tự chọn".
   This produced a false PASS reading. Fixed by reading only the
   `span.badge` text, and reconfirmed against the raw API response body
   (`requirement_type: "ELECTIVE"` then `"REQUIRED"`) that the backend
   state was correct throughout — the underlying CRUD action always
   worked; only the test's own assertion was briefly wrong.

### Limitation found (application behavior, not a script bug) — **RESOLVED, see Part G**

- **Hard refresh (F5) on a nested detail route
  (`/staff/programs/:id`) redirects to `/staff`** instead of reloading the
  same detail page. Confirmed via network trace: the page issues a fresh
  `POST /api/auth/session/verify` (succeeds) but never re-requests
  `GET /api/staff/programs/:id`, and the router lands on `/staff`. This
  looks like the detail route depends on client-side navigation
  state (e.g. React Router `location.state`) rather than being fully
  derivable from the URL alone, so a direct/hard load of that URL doesn't
  restore it. Not fixed in this session per scope ("Không sửa code") —
  reported here for the team to evaluate. All persistence checks in this
  test were therefore done via in-app navigation instead, which is not
  affected by this issue.
- **Update 2026-08-02 (Part G):** root-caused and fixed in
  `apps/web/src/routes/RequireRole.tsx` — see Part G below. The actual
  cause was the frontend route guard, not the detail page or its data
  fetch: `RequireRole` redirected to `/login` whenever `profile` was
  `null`, without checking whether the profile-verify call was still
  in flight. Marked **Resolved** after local Playwright verification
  confirmed the deep route survives a hard refresh with the fix applied
  and reproduced the original failure with the fix reverted.

### Cloud changes confirmed

Exactly the QA UI dataset specified in scope, no more, no less:
- 1 `programs` row: `QA-UI-2026-01`, name `QA UI Program (Updated)`
- 1 `cohorts` row: `QA-UI-K2026-01`, name `QA UI Cohort 2026`, under the QA-UI program
- 1 `program_courses` row: QA-UI program × `CS602`, `requirement_type = REQUIRED`

No other row was created, edited, or deleted. Pre-existing data
(`CS-MASTER`, `K2026`, the Batch-1-Part-D `QA-GSMS-2026-01` artifacts, and
any other prior QA rows) was left untouched — confirmed by screenshots
and DOM dumps showing those rows still present and unchanged alongside
the new ones.

### Cleanup

The headless Chromium instance and Node process used for this test were
closed/exited at the end of each script run (no long-lived process was
left running). The temporary Playwright scratchpad project was left in
the session scratchpad directory only (outside the repo); nothing was
added to the project's `package.json`, `package-lock.json`, or
`node_modules`.

---

## Part G — Fix: hard refresh / direct load of `/staff/programs/:id` redirects to `/staff`, 2026-08-02

Follow-up session. Scope: frontend auth/route-guard code, tests, and this
doc only. No Supabase migration/RLS/RPC/API change. No Cloud data
created/edited/deleted. No commit/push/deploy.

### Root cause

Read `AuthContext.tsx`, `RequireRole.tsx`, `App.tsx`, `StaffProgramDetail.tsx`,
and `Login.tsx`. `AuthContext` exposes two independent flags: `loading`
(true only while the initial `supabase.auth.getSession()` call resolves)
and `profileStatus` (`'idle' | 'loading' | 'ready' | 'error'`, tracking the
async `POST /auth/session/verify` call that runs *after* a session is
found). The old `RequireRole` only checked `loading` and `!profile`:

```tsx
if (loading) return <p>Loading...</p>;
if (!session) return <Navigate to="/login" replace />;
if (!profile) return <Navigate to="/login" replace />;   // <-- bug
```

On a hard refresh of `/staff/programs/:id`:
1. `getSession()` resolves quickly (session restored from local storage) →
   `loading` becomes `false`.
2. `profileStatus` is still `'loading'` (the `/auth/session/verify` POST
   is in flight) → `profile` is still `null`.
3. `RequireRole` re-renders with `loading=false`, `session` truthy,
   `profile=null` → hits `if (!profile)` → `<Navigate to="/login" replace />`,
   **discarding the `/staff/programs/:id` path**.
4. `Login.tsx` mounts, session already exists, so the login form is
   disabled ("Đang xử lý…") while it waits on the same profile-verify
   call.
5. Once `profileStatus` becomes `'ready'`, `Login.tsx`'s effect fires
   `navigate(profile.role === 'STUDENT' ? '/student/classes' : '/staff', { replace: true })`
   — landing on the **role home page** (`/staff`), never back on
   `/staff/programs/:id`.

This was confirmed with evidence, not guessed: a Playwright network trace
against the local dev server (`apps/web` + `apps/api`, pointed at the same
Supabase Cloud project, read/verify-only) showed, on hard refresh of the
QA program detail page:
- `POST /api/auth/session/verify` → 200 (session is valid)
- **no** `GET /api/staff/programs/:id` request is ever issued
- final URL: `http://localhost:5173/staff` (not the original detail URL)

Reverting only the fix (`git stash` on `RequireRole.tsx`) reproduced this
exact behavior; re-applying it fixed it — isolating the bug to
`RequireRole.tsx`'s decision logic, not `StaffProgramDetail.tsx`, `App.tsx`,
or the API.

### Fix

- `apps/web/src/routes/routeGuard.ts` (**new**): extracted the guard's
  decision logic into a pure, unit-testable function
  `resolveRouteGuardDecision({ authLoading, session, profileStatus, profile, allow })`
  returning `{ type: 'loading' } | { type: 'redirect'; to } | { type: 'allow' }`.
  It now treats `profileStatus === 'idle' | 'loading'` (session present,
  verify call pending) as `'loading'` — never a redirect. It only
  redirects to `/login` when there is truly no session, or when
  `profileStatus === 'error'` / a `'ready'` status still somehow has no
  profile (a genuinely failed/invalid session). Role mismatch still
  redirects to the role's home path, unchanged from before.
- `apps/web/src/routes/RequireRole.tsx` (**modified**): now a thin
  wrapper — reads `session`/`profile`/`profileStatus`/`loading` from
  `useAuth()`, calls `resolveRouteGuardDecision`, and renders
  loading/redirect/children accordingly. No business rule changed: same
  three outcomes (loading, redirect-to-login, redirect-to-role-home,
  allow) as before, just correctly sequenced.
- `apps/web/src/routes/routeGuard.test.ts` (**new**): 9 unit tests
  covering exactly the cases requested — profile loading with a session
  present must not redirect; a genuinely missing session redirects to
  `/login`; a failed verify redirects to `/login`; a role mismatch
  redirects to the correct home path (both directions); a matching role
  is allowed through. This is the regression test for the exact bug
  above (`profileStatus: 'loading'`/`'idle'` + session present → must
  resolve to `'loading'`, not a redirect).
- No change to `AuthContext.tsx`, `App.tsx`, `StaffProgramDetail.tsx`,
  `Login.tsx`, or any API/migration/RLS file.

### Test results

| Check | Result |
|---|---|
| `npm run typecheck` (api + web) | PASS |
| `npm run lint` (api + web) | PASS — 0 errors, same 1 pre-existing unrelated warning (`AuthContext.tsx` react-refresh) as before |
| `npm run build` (api + web) | PASS |
| `npm run test` (api + web) | PASS — 11/11 api tests, **12/12 web tests** (was 3/3 before this session; +9 new cases in `routeGuard.test.ts`, existing 3 in `enrollmentMatching.test.ts` untouched) |

### Playwright reproduction + verification (local dev, reusing existing session/data)

Ran against `apps/web` (`localhost:5173`) + `apps/api` (`localhost:4000`),
the latter pointed at the same Supabase Cloud project used throughout
Batch 1 — no new data created, only existing QA-UI-2026-01 program (from
the previous UI E2E session) and the demo staff/student accounts were
used; both dev servers were started fresh for this test and stopped again
at the end.

| Case | Result |
|---|---|
| Reproduce: hard refresh on `/staff/programs/:id` **with the old `RequireRole` restored via `git stash`** → lands on `/staff`, detail content absent | **Reproduced** (confirms root cause) |
| Fix re-applied (`git stash pop`) → same hard refresh stays on `/staff/programs/:id`, shows `QA UI Program (Updated)` detail content | PASS |
| Staff hard refresh on the deep program-detail route: no console/network errors | PASS — `[]` |
| Student login lands on `/student/classes`; hard refresh stays on `/student/classes` | PASS |
| Student hard-refresh case: no console/network errors | PASS — `[]` |
| Student navigating directly to `/staff/programs` is redirected to `/student/classes` (role guard still enforced, not bypassed by the fix) | PASS |
| Not logged in (fresh browser context), direct load of `/staff/programs` redirects to `/login` | PASS |

No console error, CORS error, or failed network request (4xx/5xx) was
observed in any of the above cases.

### Cloud changes confirmed

**None.** This fix touched only frontend route-guard code. The local dev
API used during Playwright verification only issued `GET`/`POST
/auth/session/verify` calls against the existing Cloud project — no
`programs`/`cohorts`/`program_courses`/`courses`/`class_schedules`/
`enrollments`/`enrollment_history` row was created, edited, or deleted.
The pre-existing QA-UI-2026-01 program used for the repro was read-only
throughout (only opened via `GET`, never submitted/edited).

### Cleanup

Both local dev servers (`apps/api` on `:4000`, `apps/web` on `:5173`),
started fresh for this verification, were force-stopped at the end
(`taskkill`) — no process left listening on either port. The Playwright
scripts used lived in the session scratchpad only, outside the repo.

### Files changed this session

```
 M apps/web/src/routes/RequireRole.tsx
?? apps/web/src/routes/routeGuard.ts
?? apps/web/src/routes/routeGuard.test.ts
 M docs/BATCH_1_INTEGRATION_REPORT.md
```

No commit, push, or deploy was performed.

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
