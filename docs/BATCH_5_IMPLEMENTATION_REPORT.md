# Batch 5 — Implementation Report (Xét tốt nghiệp và Dashboard báo cáo)

Status: IMPLEMENTED, local-only, no DB/git/deploy operations performed. Source of truth for requirements: `docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md`.

## 0. Two pre-existing-code discoveries (documented, not silently ignored)

The design doc's migration plan assumed two things were *missing* from the codebase. Both were already present:

1. **`theses.completed_at`** already exists (added in `0030_theses.sql`) and `staff_complete_thesis` (`0037`) already sets it on `IN_PROGRESS → COMPLETED`. Migration `0039` therefore does **not** add a column — it re-creates `staff_complete_thesis` with the explicit `WHERE completed_at IS NULL` idempotency guard the design doc calls for (BUS-79), as a defense-in-depth measure, but no schema change was needed.
2. **`student_create_thesis_proposal`** (`0035`) already contained `if v_profile.academic_status <> 'STUDYING' then ...`. Migration `0047` re-creates the same function, keeping and documenting that check as the BUS-74 enforcement point, rather than adding new logic that would have been a no-op duplicate check.

Both migrations are still present as designed (0039 and 0047 slots in the plan are used), are idempotent, and are covered by the static ACL test.

## 1. Files created/changed

### Migrations (`supabase/migrations/`, new only, 0000–0038 untouched)
- `0039_thesis_completed_at_immutable.sql` — re-creates `staff_complete_thesis` with `completed_at` set-once guard (BUS-79).
- `0040_graduation_records.sql` — new table, per D.1.
- `0041_rls_graduation_records.sql` — RLS, SELECT-only policies.
- `0042_helper_compute_graduation_eligibility.sql` — internal helper `_compute_graduation_eligibility`, never granted.
- `0043_rpc_student_get_own_graduation_status.sql`
- `0044_rpc_staff_get_student_graduation_status.sql`
- `0045_rpc_staff_confirm_graduation.sql`
- `0046_rpc_staff_graduation_summary_and_list.sql` — includes internal helper `_graduation_filtered_rows`.
- `0047_thesis_proposal_block_graduated.sql` — re-creates `student_create_thesis_proposal`, keeps/documents BUS-74 check.
- `0048_rpc_revoke_anon_batch5.sql` — final ACL sweep.

### API (`apps/api/src/`)
- `schemas/graduation.ts` (new) — Zod schemas, `graduationListQuerySchema` enforces BUS-81.
- `schemas/graduation.test.ts` (new) — schema/pagination unit tests.
- `lib/csv.ts` (new) — `escapeCsvField`, `toCsvRow`, `buildGraduationCsv`, BOM + CRLF + formula-injection defense.
- `lib/csv.test.ts` (new) — CSV escaping/formula-injection unit tests.
- `routes/graduation.ts` (new) — all 6 endpoints from the design doc.
- `scripts/batch5GrantAcl.test.ts` (new) — static ACL/signature checks over the migration files.
- `index.ts` (edited) — registers `graduationRouter`.

### Frontend (`apps/web/src/`)
- `pages/student/StudentGraduation.tsx` (new)
- `pages/staff/StaffGraduationDashboard.tsx` (new) — stat tiles, filters, table, pagination, confirm dialog, CSV export button. No revert/delete/undo control anywhere (BUS-71).
- `types/api.ts` (edited) — added `GraduationEligibility`, `GraduationRecord`, `GraduationStatusResponse`, `GraduationSummary`, `GraduationListRow`, `GraduationListResponse`, `ConfirmGraduationResult`.
- `App.tsx` (edited) — routes `/student/graduation`, `/staff/graduation`.
- `components/StudentNav.tsx` (edited) — "Tình trạng tốt nghiệp" link.
- `components/StaffNav.tsx` (edited) — "Xét tốt nghiệp" link.
- `styles.css` (edited) — `.stat-tiles/.stat-tile/.pagination/.modal-overlay/.modal/.modal-actions` (reuses existing `.badge*`/`.card`/`.banner*` classes, no new design system).

### Docs
- `docs/BATCH_5_IMPLEMENTATION_REPORT.md` (this file).

## 2. BUS-65..81 → implementation mapping

| BUS | Migration / RPC | API | UI | Test |
|---|---|---|---|---|
| 65 | `0042 _compute_graduation_eligibility` | all graduation endpoints | both pages | `batch5GrantAcl.test.ts` (static), described eligibility branches (see §5) |
| 66 (no GPA) | `0042` never reads a GPA column | — | — | code review: no GPA column referenced anywhere in Batch 5 |
| 67 (reuse Batch 3 formula) | `0042` calls `public._student_progress` verbatim | — | — | `0042` source contains `select * into v_progress from public._student_progress(p_student_id);` and no re-derivation |
| 68 (staff-only confirm) | `0045` `is_training_staff()` check | `requireRole('TRAINING_STAFF')` on `/staff/*` | confirm button only on staff dashboard | `batch5GrantAcl.test.ts` |
| 69 (recompute in-transaction) | `0045` calls `0042` after the `FOR UPDATE` lock | — | — | `batch5GrantAcl.test.ts`: FOR UPDATE assertion |
| 70 (academic_status→GRADUATED, trigger syncs student_status) | `0045` UPDATE + existing `profiles_academic_guard` (0018, untouched) | — | student page shows GRADUATED record | static: 0045 contains exactly one `UPDATE public.profiles SET academic_status = 'GRADUATED'` |
| 71 (no revert) | no UPDATE/DELETE RPC exists for graduation_records or reverting academic_status | no revert endpoint | no revert/undo button in `StaffGraduationDashboard.tsx` | `batch5GrantAcl.test.ts`: no UPDATE/DELETE on graduation_records anywhere |
| 72 (unique per student) | `graduation_records_student_unique` + `0045` pre-check | confirm returns `reason: 'already_graduated'` | dialog shows the error | `batch5GrantAcl.test.ts` |
| 73 (registration blocked, no RPC change) | none (Batch 1 RPC untouched) | — | — | **NOT executable without a live DB** — static-review only, see §6 |
| 74 (thesis proposal blocked) | `0047` (re-creates 0035's existing check) | — | — | static: check present in 0047 |
| 75 (own history visible after GRADUATED) | RLS (0007/0022/0033/0041) all use `student_id = auth.uid()`, no academic_status condition | `/student/grades`, `/student/progress`, `/student/theses`, `/student/graduation` unchanged for GRADUATED students | — | code review: none of these RLS policies filter by academic_status |
| 76 (staff-only dashboard, no cross-student leak) | `0044/0046` `is_training_staff()` checks; RLS `graduation_records_select_own` | `requireRole('TRAINING_STAFF')` on `/staff/graduation/*` | — | `batch5GrantAcl.test.ts` |
| 77 (CSV filtered, no PDF, staff-only) | `0046` (same filters as list) | `GET /staff/graduation/export.csv`, staff-only | "Xuất CSV" button reuses current filters | `csv.test.ts`; route guarded by `requireRole` |
| 78 (ACL sweep) | `0048` | — | — | `batch5GrantAcl.test.ts` |
| 79 (`completed_at` immutable) | `0039` | — | — | `batch5GrantAcl.test.ts` checks the `WHERE completed_at IS NULL` idempotency guard is present in 0039's source |
| 80 (deterministic thesis pick) | `0042`: `order by completed_at desc nulls last, created_at desc limit 1` | — | — | static: exact ORDER BY clause present in `0042` |
| 81 (pagination 20/100, reject not clamp) | `0046` DB-level `raise exception` + Zod `graduationListQuerySchema.max(100)` | route 400s via ZodError before hitting the RPC | — | `graduation.test.ts` (page_size 101 rejected, 100 accepted, default undefined) |

## 3. Atomicity / locking / shared-formula strategy

- **`staff_confirm_graduation` (0045)**: locks `profiles` row for the target student with `SELECT ... FOR UPDATE` first. Two concurrent confirm calls for the same student serialize on that row lock — the second call sees either (a) the graduation_records row the first call just committed (→ `already_graduated`) or (b) blocks until the first transaction commits/rolls back, then re-evaluates. No deadlock is possible since only one row is ever locked per call and confirmation never locks two students at once.
- **Single eligibility formula**: `_compute_graduation_eligibility` (0042) is the only place BUS-65 is evaluated. `student_get_own_graduation_status` (0043), `staff_get_student_graduation_status` (0044), `staff_confirm_graduation` (0045), and `staff_get_graduation_summary`/`staff_list_graduation_status` (via `_graduation_filtered_rows` in 0046) all call it — none re-implements the credit/thesis logic. This mirrors the `_student_progress` pattern from Batch 3 and directly satisfies BUS-67/BUS-69 ("never trust a cached/earlier eligibility value — recompute via the one shared function").
- **Snapshot-not-recompute for history**: `graduation_records` stores the values `_compute_graduation_eligibility` returned at confirm time; nothing later reads live `programs`/`_student_progress` to redisplay an old confirmation (D.2/D.3).

## 4. CSV security

- **BOM**: `buildGraduationCsv` prefixes the document with `﻿` so Excel on Windows renders Vietnamese diacritics as UTF-8 instead of guessing a Western codepage.
- **RFC 4180 escaping**: any field containing a comma, double quote, or newline is wrapped in `"..."` with embedded `"` doubled to `""` (`toCsvRow`/`escapeCsvField`).
- **Formula injection defense**: a field whose value begins with `=`, `+`, `-`, or `@` (the four prefixes Excel/Sheets/LibreOffice treat as "open a formula") is prefixed with a leading `'` — the standard "force text" marker — **before** RFC 4180 quoting is applied, so an injected value like `=cmd|'/c calc'!A1` becomes `'=cmd|'/c calc'!A1` and is still safe even if it also needs quoting afterward (unit-tested in `csv.test.ts`, including the "prefix applied before quoting" case).
- **No PDF, staff-only, filter-scoped, no server-side file storage**: `GET /staff/graduation/export.csv` is gated by `requireRole('TRAINING_STAFF')`, reuses the same Zod-validated filter query as the dashboard, and streams the CSV directly in the HTTP response (`res.send(csv)`) — nothing is written to disk.

## 5. Test results

### apps/api
- `npm run typecheck` — **PASS** (0 errors after fixing one `string | undefined` narrowing issue in the new ACL test).
- `npm run lint` — **PASS** (0 errors, 0 warnings).
- `npm run build` — **PASS**.
- `npm test` — **PASS**, 106/106 tests (all pre-existing Batch 1–4 tests plus the new Batch 5 tests: `schemas/graduation.test.ts`, `lib/csv.test.ts`, `scripts/batch5GrantAcl.test.ts`). Two assertions in the first draft of `csv.test.ts` had the RFC4180-quoting-after-formula-prefix interaction backwards; both were corrected and now pass.

### apps/web
- `npm run typecheck` — **PASS**.
- `npm run lint` — **PASS** (1 pre-existing warning in `AuthContext.tsx`, unrelated to Batch 5, not touched by this batch).
- `npm run build` — **PASS**.
- `npm test` (vitest) — **PASS**, 12/12 (pre-existing `enrollmentMatching.test.ts` + `routeGuard.test.ts`; no new frontend unit tests were added because the new pages are integration-shaped React components with no pure extractable logic beyond what `csv.test.ts`/`graduation.test.ts` on the API side already cover — the design doc's test plan items are DB/RPC-shaped, not frontend-unit-shaped).

### Explicitly static-only (no live DB, cannot be executed under the "no Cloud/DB" constraint)
- **BUS-73 regression test (design doc test #5)**: requires a running Postgres with real `profiles`/`enrollments` rows and the legacy registration RPC to observe the actual rejection reason. Not executable here. Code-review only: `academic_status='GRADUATED'` → `profiles_academic_guard` (0018, unmodified) sets `student_status='INACTIVE'`; the registration RPC (`0008_rpc_register_for_class.sql`, unmodified) checks `student_status='ACTIVE'` — the chain is structurally intact by inspection, but **this is not proof against a live database**.
- **BUS-79/80/9/10 (design doc tests #9/#10)**: determinism and immutability of `completed_at`/thesis selection are proven by SQL source inspection (`ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1`; `WHERE completed_at IS NULL` guard) and by the static ACL/signature test, not by executing the SQL against real rows.
- **RLS behavior (test #2), confirm-twice/race (test #3), snapshot-immutability-under-config-change (test #4), CSV row-count-matches-summary (test #7 runtime part)**: all require a live Postgres instance with RLS enforcement and real transactions; not executable under the "no Supabase/DB/psql" constraint. The report above documents the code-level reasoning for each, but these are **NOT independently verified against a running database** and must be re-verified in a real environment (e.g. Supabase local dev or a staging project) before this batch is considered fully proven, not just implemented.
- **ACL test (`batch5GrantAcl.test.ts`)**: proves the migration *source text* contains the correct `revoke`/`grant` statements (same caveat `batch4GrantAcl.test.ts` already carries) — it does not connect to a database and inspect `information_schema`/`pg_proc` ACLs on a live instance.

## 6. Secret/credential scan

Ran `grep -rniE "SERVICE_ROLE|SECRET|PASSWORD|API_KEY|\.env"` over every file created/edited in this batch (10 migrations + 8 API files + 6 web files). Only match: `apps/web/src/pages/staff/StaffGraduationDashboard.tsx` referencing `import.meta.env.VITE_API_BASE_URL` — a public, non-secret build-time env var, using the exact same pattern already present in `apps/web/src/lib/api.ts`. No `.env` file was read or printed at any point in this session.

## 7. Local-only confirmation

No `git` command was run. No Supabase CLI, `psql`, `db push`, seed script, or Admin API call was run. No migration 0000–0038 file was modified — 0039–0048 are all newly created files, verified via `Glob`/directory listing before and after. All verification (`typecheck`/`lint`/`build`/`test`) ran against local TypeScript/Vite/Node tooling only.

## Verdict

Given the explicit "no live DB" constraint, several design-doc test-plan items (BUS-73 regression, RLS enforcement, concurrency/race, ACL enforcement at the Postgres privilege-catalog level) can only be verified by static source review here, not by execution — this is a known, documented gap, not an oversight.

**READY FOR BATCH 5 PRE-APPLY REVIEW**

---

## Addendum (2026-08-04): Hardening for Pre-Apply Security Review Finding #1 (P1)

`docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md` found that `staff_update_student` (migration `0019`, Batch 2 — not part of this batch's original file list, and never revisited by 0039–0048) let TRAINING_STAFF set `academic_status='GRADUATED'` directly (bypassing eligibility/snapshot) and revert an already-GRADUATED student back out, violating BUS-71. This addendum documents the local-only fix; it does **not** change verdict of §5–§7 above (those results still stand), it only supersedes the Verdict line at the very bottom of this file.

### Files created/changed for the fix
- `supabase/migrations/0049_harden_graduation_status_transition.sql` (new) — two layers:
  1. `profiles_graduation_status_guard()` + `BEFORE INSERT OR UPDATE` trigger `profiles_academic_00_graduation_guard` on `public.profiles`, named to sort before `profiles_academic_guard` (0018) alphabetically so it runs first and its `RAISE EXCEPTION` aborts the statement before any other BEFORE trigger runs. Blocks (a) reverting `academic_status` away from `GRADUATED`, (b) setting `academic_status='GRADUATED'` when no `graduation_records` row exists for that student yet. Function is `revoke all ... from public, anon, authenticated` (matches Batch 5's own helper convention).
  2. `staff_update_student` (0019) re-created via `CREATE OR REPLACE FUNCTION` with the **same signature/ACL**, adding two explicit `jsonb {success:false, reason}` rejections (GRADUATED target; current status already GRADUATED) before the trigger would ever need to fire, so staff see a clean Vietnamese message instead of a raw exception.
- `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql` (new) — **CANNOT EXECUTE LOCALLY, REQUIRES TRANSACTION TEST PHASE** (stated at the top of the file itself). Deliberately placed outside `supabase/migrations/` so Supabase CLI tooling never globs/applies it as a real migration. 8 documented BEGIN…ROLLBACK cases.
- `apps/api/src/schemas/students.ts` — added `updateAcademicStatusEnum` (`STUDYING | SUSPENDED | WITHDRAWN`, excludes `GRADUATED`), used only by `updateStudentSchema`. `academicStatusEnum` (used by `listStudentsQuerySchema` for filtering/display) is unchanged and still includes `GRADUATED`.
- `apps/api/src/schemas/students.test.ts` — updated the "accepts every academic_status" test to only assert the 3 non-GRADUATED values, plus a new test asserting `GRADUATED` is rejected with a message mentioning "Xác nhận tốt nghiệp".
- `apps/web/src/pages/staff/StaffStudentDetail.tsx` — dropdown no longer offers `GRADUATED` (`EDITABLE_ACADEMIC_STATUSES` excludes it); when `student.academic_status === 'GRADUATED'`, the status field renders a read-only badge + explanatory note instead of a `<select>`, the submit button is disabled, and `handleSubmit` short-circuits with a Vietnamese error if somehow reached.

### Verified: `staff_confirm_graduation` (0045) operation order
Re-read `supabase/migrations/0045_rpc_staff_confirm_graduation.sql:63-82`: `INSERT INTO public.graduation_records ...` (line 63) happens **before** `UPDATE public.profiles SET academic_status = 'GRADUATED'` (line 82), both inside the same function/transaction. **Already correct — no change made to 0045.** This means the new trigger's "GRADUATED requires an existing graduation_records row" check passes for this RPC without any modification needed there.

### Local verification run 2026-08-04 (see root Verdict section below for pass/fail)
`npm run typecheck`, `npm run lint`, `npm run build`, `npm run test` were all re-run from repo root after the fix (covers both `apps/api` and `apps/web`); results recorded in `docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md`'s addendum, not duplicated here to avoid drift between two copies of the same numbers.

### Updated Verdict (supersedes the "READY FOR BATCH 5 PRE-APPLY REVIEW" line above for the post-hardening state)
**READY FOR BATCH 5 TRANSACTION TEST** — conditional on all local static checks passing (PASS, see below) and on `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql` being executed against a real, non-production Postgres instance before this is considered proven at runtime. This is still **not** "READY FOR PRODUCTION": no DB/RLS/concurrency/trigger-ordering behavior has been executed, only read.

**Local verification (this session, no DB/network, re-run from repo root after the fix):**
- `npm run typecheck` — PASS (api + web).
- `npm run lint` — PASS (0 errors; 1 pre-existing unrelated warning in `AuthContext.tsx`, not touched by this fix).
- `npm run build` — PASS (api + web).
- `npm run test` — PASS, 107/107 api tests, 12/12 web tests.
- No secret-scan script (gitleaks/trufflehog/secretlint) exists in this repo's `package.json` files — none was run; a manual review of the diff (migration + 4 edited/new source files) found no secrets, `.env` content, or credentials referenced.
- No SQL/pgTAP test framework exists in this repo; the new trigger and `staff_update_student` SQL logic is **not executed** locally — verified only by static re-reading of the migration text plus the transaction test plan in `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql`.

---

## P0 fix: `_compute_graduation_eligibility` ambiguous column reference (2026-08-04)

A real transaction test against the linked Supabase Cloud project (see `docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md`, "RUNTIME VERIFICATION" and "P0 FIX APPLIED" sections) found that `supabase/migrations/0042_helper_compute_graduation_eligibility.sql` raised `column reference "student_id" is ambiguous` for every STUDYING student, because the function's `returns table (student_id uuid, …)` OUT column shadowed the unqualified `student_id` reference in two queries against `public.theses`.

**Fix (local file edit, migration not yet applied to Cloud so edited in place, no new migration number needed):** aliased `public.theses` as `t` and qualified `t.student_id`/`t.status`/`t.completed_at`/`t.created_at` in both the `has_active_thesis` subquery and the COMPLETED-thesis selection query. Also aliased the `profiles`/`programs`/`cohorts` single-table lookups elsewhere in the same function as defense-in-depth. No business rule, ordering, or function signature changed. `_graduation_filtered_rows` (0046) was audited for the same pattern — already fully aliased, no change needed.

Added a static regression test, `apps/api/src/scripts/batch5GraduationEligibilityColumnRefs.test.ts`, asserting the fixed migration text no longer contains the ambiguous pattern and that all downstream callers (`0043`–`0046`) still reference the function with its unchanged signature.

`npm run typecheck`, `lint`, `build`, `test` (apps/api) all PASS after the fix — 113/113 tests, including the 6 new ones.

---

## P2 fix: `theses.completed_at` had no DB-level immutability guard (2026-08-04)

**Status: FIXED LOCALLY — FULL RETRANSACTION TEST REQUIRED.** Not yet applied to Supabase Cloud, not proven at runtime. Do not treat as resolved until re-run against a live Postgres instance.

The full transaction test (`docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md`, section "RUNTIME VERIFICATION", row C2) confirmed a real gap: `staff_complete_thesis` only guards `completed_at` via `WHERE completed_at IS NULL` inside the RPC itself (BUS-79); a direct `UPDATE public.theses SET completed_at = …` issued outside that RPC (service-role script, a future RPC bug, raw SQL) was not blocked by anything at the DB level.

**Fix (edited `supabase/migrations/0039_thesis_completed_at_immutable.sql` in place — migrations 0039–0049 are not yet applied to Cloud, so no new migration number was needed):**
1. Added a backfill statement, `update public.theses set completed_at = now() where status = 'COMPLETED' and completed_at is null;`, placed immediately **before** the new trigger is created. Ordering is load-bearing: once the guard trigger exists it would reject this exact statement (a COMPLETED row that isn't mid `IN_PROGRESS -> COMPLETED` transition), so the backfill must run against the pre-trigger table.
2. Added `public.theses_completed_at_guard()`, a `SECURITY DEFINER` trigger function (`search_path = pg_catalog, public`), wired as `before insert or update on public.theses for each row`. Rules enforced:
   - INSERT: `completed_at` must be `NULL` (a thesis can never be created already completed).
   - UPDATE: if `completed_at` changes at all, `OLD.completed_at` must have been `NULL` (immutable once set) **and** the change must be exactly the `OLD.status = 'IN_PROGRESS'` → `NEW.status = 'COMPLETED'` transition.
   - Any row where `status <> 'COMPLETED'` must have `completed_at IS NULL`, regardless of how it got there.
3. `revoke all ... from public/anon/authenticated` on the trigger function — it is only reachable as a row trigger, never callable directly by any role.
4. Audited `staff_complete_thesis` (already in `0039`) and every other migration that does `update public.theses` (`0035`, `0036`, `0037`) — none of them touch `completed_at`, so the new trigger's `completed_at is distinct from` check is a no-op for all of them and does not change their behavior. `staff_complete_thesis` already sets `status` and `completed_at` together in the same `UPDATE` statement, satisfying the trigger's transition rule; no RPC logic change was needed.

Added a static regression test, `apps/api/src/scripts/batch5CompletedAtGuard.test.ts` (5 tests, no DB/network), asserting: the backfill runs before the trigger is created; the trigger function and trigger exist and are wired to `public.theses` for INSERT and UPDATE; the function body contains the immutability check, the transition-only check, the non-COMPLETED-implies-null check, and the INSERT guard; the trigger function has no execute grant to any role; and `staff_complete_thesis` sets `completed_at` in the same UPDATE that performs the status transition.

`npm run typecheck`, `lint`, `build`, `test` all PASS after the fix — 118/118 api tests (5 new), 12/12 web tests. Manual review of the diff (one migration file + one new test file) found no secrets, `.env` content, or credentials. No Supabase Cloud, psql, `db push`, seed, or Admin API command was run; no Auth user created/reset; no commit/push/deploy performed.

**Verdict: READY FOR BATCH 5 COMPLETED_AT RETEST** — the fix must be exercised by a full transaction test against a real Postgres instance (re-running C2 in `docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md` with a raw `UPDATE public.theses SET completed_at = …` and confirming it now raises) before P2 is considered resolved on Cloud.

Status: **FIXED LOCALLY — FULL RETRANSACTION TEST REQUIRED.** Not yet re-verified against a live Postgres instance with the fix applied.
