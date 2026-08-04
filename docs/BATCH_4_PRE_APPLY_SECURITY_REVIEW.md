# Batch 4 (Thesis/Advisor) — Pre-Apply Security & Data-Integrity Review

Date: 2026-08-03
Hardening pass appended: 2026-08-03 (same day, second pass — see "Hardening Pass" section at the end)
Scope: `docs/BATCH_4_THESIS_ADVISOR_DESIGN.md`, `docs/BATCH_4_IMPLEMENTATION_REPORT.md`, migrations `0028`–`0038`, dependency migrations `0007`, `0018`–`0027`, backend theses/advisor routes+schemas+error handler, and the Batch 4 static ACL test.

**This is a static, read-only review augmented with a subsequent local hardening pass (see below). Migrations 0028–0038 were edited directly in place (none had been applied to Cloud), following the same "no new migration file, fix the unapplied one directly" rule already used throughout Batch 4 pre-apply work. No `supabase db push`, no Cloud/psql access, and no commit/deploy were performed.**

---

## 1. Dependency / Schema / Migration Order

- Migration sequence for Batch 4 is `0028_research_areas.sql`, `0029_advisors.sql`, `0030_theses.sql` (creates `theses` and `thesis_code_counters`), `0031_trigger_advisor_deactivate_guard.sql`, `0032_thesis_advisor_history.sql`, `0033_rls_research_areas_advisors_theses.sql`, `0034_rpc_catalog_research_areas_advisors.sql`, `0035_rpc_thesis_proposal.sql`, `0036_rpc_thesis_staff_review.sql`, `0037_rpc_thesis_advisor_assignment_lifecycle.sql`, `0038_rpc_revoke_anon_batch4.sql`. This is sequential and does not touch `0000`–`0027`.
- Table creation order is correct relative to FK dependencies: `research_areas` → `advisors` → `theses`/`thesis_code_counters` → advisor-deactivate trigger → `thesis_advisor_history`. Earlier dependencies (`academic_status`, `program`, `progress` from `0018`–`0027`, and the RLS pattern established in `0007_rls_policies.sql`) are referenced, not modified.
- `thesis_code` generation is race-safe: it uses `INSERT ... ON CONFLICT (year) DO UPDATE` against `thesis_code_counters` to atomically obtain the next sequence value under row lock, rather than a `SELECT max(...)+1` pattern (`supabase/migrations/0035_rpc_thesis_proposal.sql:151-156`). This avoids the classic max()+1 duplicate-key race.
- "One active thesis per student" is enforced at the DB level via a **partial unique index** `theses_one_active_per_student` (`supabase/migrations/0030_theses.sql:57-59`), not application code alone. The proposal RPC additionally performs a pre-check under lock, so the constraint is a genuine backstop, not just a nicety.
- `thesis_advisor_history` append-only guarantee: no INSERT/UPDATE/DELETE RLS policies grant students or staff direct write access; the only writers are `SECURITY DEFINER` RPCs. **Finding**: unlike the advisor-deactivate guard, there is **no DB trigger** that explicitly blocks UPDATE/DELETE on this table — append-only is enforced by omission of grants/RLS policies plus the assumption that no other RPC/trigger ever issues UPDATE/DELETE against it. This is weaker than a hard trigger-enforced invariant. (See Finding F-1.)
- Active-research-area / active-advisor-at-assignment constraints (can't assign to an inactive research area or inactive advisor) are enforced only inside the RPCs (`0035_rpc_thesis_proposal.sql:144-147`, `0037_rpc_thesis_advisor_assignment_lifecycle.sql:45-47,104-106`), with **no DB CHECK/trigger backstop**. If a future RPC or a manual write bypasses these RPCs, an inactive assignment could occur. (See Finding F-2.)
- **Asymmetry found**: `0030_theses.sql:45-48` defines a CHECK constraint `theses_rejection_reason_requires_status` requiring a non-null reason when status = REJECTED, but there is **no equivalent CHECK constraint for `cancellation_reason`** on CANCELLED status — that requirement is enforced only inside the staff-cancel RPC, not at the schema level. (See Finding F-3.)
- FKs/checks/indexes otherwise appear reasonable (foreign keys point to already-created parent tables; supporting indexes exist for the code counters and per-student partial unique index).

## 2. Thesis Lifecycle / Integrity

- Student eligibility (`student_check_thesis_eligibility`, `0035_rpc_thesis_proposal.sql:11-76`) checks academic_status, program, PUBLISHED+PASS progress, min_thesis_credits, and absence of an existing active thesis, matching the design doc's stated rule.
- **Finding**: `student_create_thesis_proposal` **duplicates** this eligibility logic inline rather than calling the shared `student_check_thesis_eligibility` function (both live in `0035`). They are currently consistent, but this is a maintenance/drift risk — a future edit to one and not the other would silently desynchronize eligibility rules between the "check" and "create" paths. (See Finding F-4.)
- Edit-only-while-PENDING and self-cancel-only-while-PENDING are both enforced with `SELECT ... FOR UPDATE` plus explicit status checks (`0035_rpc_thesis_proposal.sql:198-205`, `257-258`), so COMPLETED theses cannot be self-cancelled and non-PENDING theses cannot be edited by students.
- `reason` is required (NOT NULL enforced via CHECK) for REJECTED (`0030:45-48`); for staff CANCELLED and reassignment actions the requirement is enforced by the RPC parameter being marked required and validated, not by a DB CHECK (partial gap, see F-3).
- RLS on `theses` (`0033_rls_research_areas_advisors_theses.sql:83-100`) defines **no INSERT/UPDATE/DELETE policy for any role** — i.e., default-deny. This correctly blocks any attempt to bypass the state machine via direct PostgREST table access; all mutations must go through `SECURITY DEFINER` RPCs. This is a good pattern.
- Concurrency: row locking (`SELECT ... FOR UPDATE`) is used consistently in the proposal-creation RPC prior to checking for an existing active thesis, and the partial unique index provides a hard DB-level backstop against a duplicate-active-thesis race even if the lock were somehow bypassed.

## 3. Advisor Integrity / Concurrency

- A genuine DB-level trigger blocks deactivating an advisor who still has IN_PROGRESS theses: `supabase/migrations/0031_trigger_advisor_deactivate_guard.sql:12-31`. This fires on any UPDATE path to the `advisors` table (not just the staff RPC), so it cannot be bypassed by a direct table UPDATE either — this is the strongest-enforced invariant in the batch.
- Inactive-advisor-assignment blocking (rejecting assignment of a thesis to an inactive advisor) is RPC-level only (`0037:45-47`), with no DB constraint mirroring the deactivate-guard trigger's robustness. (Same class as Finding F-2.)
- TOCTOU protection for capacity: both `staff_assign_advisor` and `staff_change_advisor` lock the advisor row (`SELECT ... FOR UPDATE`) before counting IN_PROGRESS theses against `max_active_theses` (`0037:41,49-54,100,111-116`). This correctly closes the classic read-then-write race for concurrent assignment requests.
- Advisor reassignment is restricted to theses in IN_PROGRESS status (`0037:96-98`) — enforced at the RPC level, with no DB trigger backstop analogous to the one guarding advisor deactivation. Advisor cannot be changed once a thesis is COMPLETED or CANCELLED, per this same RPC-level status guard.
- `thesis_advisor_history` inserts occur via the same `SECURITY DEFINER` RPCs; see Finding F-1 for the append-only caveat.

## 4. RLS / RBAC / ACL

- RLS policies in `0033_rls_research_areas_advisors_theses.sql` scope student SELECT access to their own thesis row only; students have **no SELECT policy on `advisors`** at all — advisor identity/details are exposed to students only through `SECURITY DEFINER` RPCs that return a filtered projection, not raw table access.
- Students cannot manage `research_areas`/`advisors` catalog data or perform approve/reject/assign/reassign/complete/cancel actions — these are staff-only RPCs, gated by role checks inside each function body.
- All Batch 4 public RPC functions (22 counted) carry explicit `REVOKE ... FROM PUBLIC; REVOKE ... FROM anon; GRANT ... TO authenticated`, and this is re-asserted in a final consolidating sweep migration, `0038_rpc_revoke_anon_batch4.sql:14-67`. The internal helper/trigger function has all privileges revoked from every role (`0038:72`).
- No `ALTER DEFAULT PRIVILEGES` statements are present in `0028`–`0038`. The prior Batch 3 incident (documented in `docs/BATCH_3_IMPLEMENTATION_REPORT.md`, describing a default-privilege leak where newly created functions were implicitly executable by `PUBLIC`/`anon` because of project-level default grants) is mitigated here by explicit per-function REVOKE/GRANT statements on every new function, plus the consolidating `0038` sweep.
- **Important caveat**: this mitigation has only been **statically verified** — by reading migration SQL text and by a static regex-based test (see Section 4's ACL test discussion below). The original Batch 3 leak was only actually caught by a **live** database check, because it stemmed from live Postgres/Supabase default-privilege state rather than anything visible in a single migration file's text. A static review of `0028`–`0038`, however careful, cannot prove the live ACL state matches intent — only a live `information_schema`/`pg_proc`-based query against an actually-applied database can. (See Finding F-5 — this is the most important residual risk in this review.)
- No exposure of `auth.users` or email fields was found in any Batch 4 view or RPC; `advisors` is not linked to `auth.users` in a way that leaks email addresses to students.

## 5. API / Error Safety

- Backend schemas for thesis/advisor endpoints use strict Zod validation (`apps/api/src/schemas/theses.ts`), with role-guard middleware applied per sub-router (`apps/api/src/routes/theses.ts:33-34`).
- The Supabase client used in these routes is confirmed to be user-scoped (RLS-respecting), not the service-role client, at all call sites reviewed (`apps/api/src/lib/supabaseClient.ts:13-22`), consistent with RLS being relied upon as a real enforcement layer rather than theatre.
- The shared error handler (`apps/api/src/middleware/errorHandler.ts:9-29`) maps errors to a generic message in production rather than passing through raw Postgres error text, avoiding leakage of internal schema/constraint names to clients.
- The implementation report's claim of "~10 spots fixed" (`docs/BATCH_4_IMPLEMENTATION_REPORT.md`, around the error-handling section) refers to replacing raw `error.message` pass-throughs in `theses.ts` with a generic error constant. No remaining raw `error.message` pass-through was found in the current file. **Gap**: there is no automated regression test asserting that these routes never re-introduce a raw-message pass-through — this was a manual, self-reported fix with no test coverage guarding it going forward. (See Finding F-6.) It should also be verified (not done in this pass, since it requires running the app) that this generic-message mapping did not accidentally swallow legitimate, safe-to-surface business validation errors (e.g., "advisor at capacity", "thesis not in PENDING state") that the frontend needs to display distinctly — recommend confirming error codes are still distinguishable via a structured `code` field, not just a flattened generic string.
- No `any` types were found in the new theses/advisor route or schema TypeScript files reviewed; no service-role client usage was found in normal request paths; no secrets were observed (and none were read/printed, per constraints).

## 6. Test Plan (NOT EXECUTED — write-only, for future live-DB pass)

**This plan is not executed in this review pass. It is provided for a separate, later transactional test against a real (non-production) Supabase/Postgres instance.**

### 6a. Read-only preflight checks (SELECT-only, safe to run against any environment)

```sql
-- Confirm table existence and expected columns
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN
  ('research_areas','advisors','theses','thesis_code_counters','thesis_advisor_history');

-- Confirm the partial unique index for one-active-thesis-per-student
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'theses' AND indexname = 'theses_one_active_per_student';

-- Confirm CHECK constraints on theses (rejection reason, and absence/presence of cancellation reason check)
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.theses'::regclass AND contype = 'c';

-- Confirm RLS is enabled and list policies
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('theses','advisors','research_areas','thesis_advisor_history');
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE tablename IN ('theses','advisors','research_areas','thesis_advisor_history');

-- Confirm function ACLs match intent: no PUBLIC/anon execute on any Batch 4 function
SELECT p.proname, p.proacl FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname ILIKE ANY (ARRAY['%thesis%','%advisor%','%research_area%']);

-- Confirm the advisor-deactivate trigger exists and is enabled
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.advisors'::regclass AND NOT tgisinternal;
```

### 6b. Transactional test plan (`BEGIN ... ROLLBACK`, isolated, never committed)

All of the following should be wrapped in `BEGIN;` ... `ROLLBACK;` blocks (never `COMMIT`), ideally each scenario as its own transaction/session as needed for concurrency tests, executed against a disposable/non-production database:

1. **Schema/ACL baseline** — re-run 6a queries inside the transaction as a sanity check before mutating anything.
2. **thesis_code concurrent generation race** — open two concurrent sessions, both call the proposal RPC (or directly hit the counter upsert) for the same year simultaneously; assert both succeed with distinct, sequential `thesis_code` values and no duplicate/conflict error surfaces to the caller.
3. **Two-active-thesis race** — two concurrent sessions attempt to create a second active thesis for the same already-has-an-active-thesis student; assert exactly one fails, referencing the partial unique index or the pre-check, and no duplicate active row is left behind.
4. **Advisor capacity race** — an advisor at `max_active_theses - 1`; two concurrent sessions attempt to assign a new thesis to the same advisor; assert exactly one succeeds and the other is rejected for capacity, verifying the `FOR UPDATE` lock actually serializes the two attempts rather than both reading stale counts.
5. **Eligibility pass/fail scenarios** — student meeting all criteria (academic_status, program, PUBLISHED+PASS progress, credit threshold, no active thesis) succeeds; then individually violate each criterion (wrong status, wrong program, missing/failed progress, insufficient credits, existing active thesis) and assert each is rejected with an appropriate, non-leaking error.
6. **Lifecycle/role transition tests** — student edits PENDING thesis (allowed), student attempts to edit APPROVED/REJECTED/IN_PROGRESS thesis (blocked), student self-cancels from PENDING (allowed), student attempts self-cancel from IN_PROGRESS/COMPLETED (blocked), staff approves/rejects/assigns/reassigns/completes/cancels at each valid and invalid state.
7. **Inactive research area / inactive advisor rejection** — attempt to create a proposal referencing an inactive research area (expect rejection); attempt to assign/reassign to an inactive advisor (expect rejection) — confirms current RPC-level-only enforcement actually works as designed (this test result should also inform whether Finding F-2 needs a DB-level backstop).
8. **Trigger deactivate-bypass attempt** — attempt to directly `UPDATE advisors SET is_active = false` (bypassing any RPC) for an advisor with an IN_PROGRESS thesis; assert the `0031` trigger blocks it regardless of caller path.
9. **History append-only violation attempt** — as an authenticated role (both student and staff), attempt a direct `UPDATE`/`DELETE` against `thesis_advisor_history`; assert it is rejected by RLS (or, if no trigger exists, confirm whether a privileged/service-context write could still succeed — this directly tests Finding F-1).
10. **RLS role-matrix tests** — as `anon`: confirm zero access to any Batch 4 table/RPC. As `student A`: can read own thesis, cannot read student B's thesis or advisor history not involving them, cannot call staff-only RPCs. As `student B`: symmetric check against student A's data. As `staff`: can read/manage all in-scope rows, cannot exceed role-appropriate actions (e.g. no direct table-level bypass of RPC-only mutation).
11. **Post-rollback cleanup confirmation** — after each `ROLLBACK`, re-run the 6a baseline queries to confirm row counts and constraint definitions are unchanged from the pre-test baseline (i.e., nothing leaked past the rollback boundary).

## 7. Conclusion

### Findings Table

| ID | Severity | Area | Evidence (file:line) | Description | Fix Proposal |
|----|----------|------|----------------------|--------------|---------------|
| F-1 | P2 | Advisor history integrity | `supabase/migrations/0032_thesis_advisor_history.sql` (no trigger present); contrast `0031_trigger_advisor_deactivate_guard.sql:12-31` | `thesis_advisor_history` append-only guarantee relies on absence of RLS write policies/grants, not an explicit trigger blocking UPDATE/DELETE. | Add a `BEFORE UPDATE OR DELETE` trigger on `thesis_advisor_history` that raises an exception unconditionally, mirroring the robustness of the `0031` deactivate-guard trigger. |
| F-2 | P2 | Advisor/research-area assignment integrity | `0035_rpc_thesis_proposal.sql:144-147`; `0037_rpc_thesis_advisor_assignment_lifecycle.sql:45-47,104-106` | Inactive-research-area / inactive-advisor rejection is enforced only inside RPC bodies, with no DB-level CHECK/trigger backstop, unlike the advisor-deactivate guard. | Consider a trigger on `theses`/history-insert paths that re-validates `is_active` on the referenced advisor/research_area at write time, independent of RPC logic. |
| F-3 | P2 | Thesis cancellation integrity | `0030_theses.sql:45-48` (REJECTED CHECK present); no analogous CHECK for `cancellation_reason` | `reason` is enforced NOT NULL via CHECK for REJECTED status but not via CHECK for CANCELLED status; cancellation reason requirement is RPC-only. | Add a symmetric CHECK constraint requiring `cancellation_reason IS NOT NULL` when `status = 'CANCELLED'`. |
| F-4 | P3 | Code maintainability / drift risk | `0035_rpc_thesis_proposal.sql` (`student_check_thesis_eligibility` vs `student_create_thesis_proposal`) | Eligibility logic is duplicated between the check RPC and the create RPC rather than the create RPC calling the check function; currently consistent but a future edit to one and not the other would silently desynchronize the two paths. | Refactor `student_create_thesis_proposal` to call `student_check_thesis_eligibility` (or extract a shared internal function) instead of duplicating the logic. |
| F-5 | P1 | RLS/ACL verification method | `0038_rpc_revoke_anon_batch4.sql:14-67`; prior incident referenced in `docs/BATCH_3_IMPLEMENTATION_REPORT.md` | All Batch 4 grant/revoke statements look correct in the migration SQL text, and a static regex-based ACL test exists, but this is the same class of evidence (static text) that failed to catch the original Batch 3 default-privilege leak, which only manifested in *live* Postgres/Supabase ACL state. Static review cannot prove the applied database matches the SQL text's intent. | Before sign-off, run the read-only ACL queries in Section 6a against the actually-applied (non-production) database to confirm live `pg_proc.proacl` matches the migrations' stated intent — do not rely on static text alone, given the Batch 3 precedent. |
| F-6 | P3 | Error-handling regression risk | `apps/api/src/routes/theses.ts` (post-fix, no `error.message` pass-through found); `docs/BATCH_4_IMPLEMENTATION_REPORT.md` "~10 spots fixed" | The fix removing raw `error.message` pass-through in ~10 spots was manual and self-reported, with no automated test guarding against reintroduction, and no explicit confirmation that legitimate business-logic error codes (e.g., "advisor at capacity") remain distinguishable to the frontend after the fix. | Add a regression test asserting theses/advisor routes never return raw Postgres error text, and confirm structured error codes are preserved for legitimate business-rule rejections. |

**Severity counts: P0: 0, P1: 1, P2: 3, P3: 2.**

### Statement on Modifications (original pass, 2026-08-03)

No code, schema, migration, or configuration files were modified in the course of this review. The only file written was this report, `docs/BATCH_4_PRE_APPLY_SECURITY_REVIEW.md`. No database, Supabase Cloud, or deploy commands were executed.

### Verdict at the end of the original pass

BLOCKED (pending F-5 resolution). **Superseded by the Hardening Pass below — see Final Verdict at the bottom of this document.**

---

## 8. Hardening Pass (2026-08-03, same day — local-only, static)

This section documents a follow-up pass that actually fixed F-1, F-2, F-3, and F-6 (all real P2/P3 findings), rather than only re-documenting them. F-4 (P3, code-duplication/drift risk) was deliberately **left open** — fixing it would have changed `student_create_thesis_proposal`'s control flow (message ordering, added an early active-thesis rejection message) beyond pure hardening, which was out of scope for this pass; it remains a legitimate future cleanup. F-5 (P1, ACL live-verification) is **not resolved** by this pass — it cannot be, by a static-only pass — see the explicit note at the end of this section.

**No Supabase Cloud, psql, `db push`, seed, or Admin API commands were run.** No git commit/push/deploy was performed (this directory is not a git repository). Migrations `0028`–`0038` were edited directly in place, per instruction, since none of them have ever been applied to Cloud — no new migration file was created for these fixes.

### 8.1 F-1 fixed: `thesis_advisor_history` is now append-only at the DB layer, not just by omission

`supabase/migrations/0032_thesis_advisor_history.sql` gained:
- `revoke update, delete on public.thesis_advisor_history from public;` (table-level privilege revoke, matching the `0006_enrollment_history.sql` convention).
- A shared trigger function `public.thesis_advisor_history_guard()` wired to two triggers: `thesis_advisor_history_no_delete` (`BEFORE DELETE`, unconditionally rejects) and `thesis_advisor_history_guarded_update` (`BEFORE UPDATE`).
- Unlike `enrollment_history` (which forbids *all* UPDATE unconditionally), this table has exactly one legitimate UPDATE shape: `staff_change_advisor` (0037) sets `unassigned_at` from `NULL` to `now()` on the previous assignment row, touching no other column. The guard function explicitly compares every other column OLD vs NEW and only allows that single transition shape; every other UPDATE shape (and every DELETE) raises an exception, regardless of caller (RPC, service-role, future script).
- The guard function itself is revoked from `public`/`anon`/`authenticated` (never directly callable), consistent with the `0031` internal-helper convention; `0038_rpc_revoke_anon_batch4.sql` re-asserts this in the final ACL sweep.
- Static evidence: `apps/api/src/scripts/batch4DbTriggers.test.ts` (new file) asserts the exact trigger/function text is present, including the column-by-column OLD/NEW comparison and the unassigned_at-only exception.

### 8.2 F-2 fixed: DB backstop for inactive `research_area`/`advisor` references

Both new guards live in `supabase/migrations/0030_theses.sql` (they need `research_areas`, `advisors`, and `theses` to all exist, which is only true starting at 0030 — same reasoning the design doc already used to justify 0031 shipping after 0030 rather than alongside 0029):

- **Advisor**: `theses_block_inactive_advisor_in_progress()` fires `BEFORE INSERT OR UPDATE ON theses`. Whenever a row would end up `status = 'IN_PROGRESS'` with a non-null `advisor_id`, it looks up that advisor's `is_active` and raises if it is false or the advisor no longer exists. This is independent of the `staff_assign_advisor`/`staff_change_advisor` RPC pre-checks (0037) and fires on *any* write path, including a direct service-role bypass of those RPCs — closing exactly the gap the review flagged (RPC pre-check was previously the only enforcement).
- **Research area**: `theses_block_inactive_research_area()` fires on `BEFORE INSERT` (always) and `BEFORE UPDATE OF research_area_id` (only when that column is part of the UPDATE's SET list). This preserves BUS-63 exactly: a thesis created while its research area was active keeps referencing it unchanged after the area is later deactivated, because no other column update touches `research_area_id` and re-triggers the check — only `student_update_own_thesis_proposal` (the one RPC that legitimately changes this column) is affected.
- Both functions are `SECURITY DEFINER` (so they can read `advisors`/`research_areas` even when the calling role has no direct SELECT grant on those tables, e.g. a student role attempting a bypass) and both are revoked from `public`/`anon`/`authenticated`, reasserted in the `0038` sweep.
- The existing RPC-level pre-checks in `0035`/`0037` are unchanged — this is a pure backstop layer, not a replacement, matching the two-layer pattern the design doc already established for the advisor-deactivate guard (0031/0034).
- No direct-write RLS policy exists on `theses` for either role (0033: "No INSERT/UPDATE/DELETE policy for students or staff... every write... goes through a SECURITY DEFINER RPC") — so unlike `advisors`/`research_areas` (which *do* have staff-facing direct UPDATE RLS policies, see 8.4 below), the only realistic bypass path for `theses` itself is a service-role connection or a future RPC bug, and the new triggers now cover both.
- Static evidence: `apps/api/src/scripts/batch4DbTriggers.test.ts` asserts both function bodies and both trigger definitions, including that the research-area trigger is scoped to `UPDATE OF research_area_id` (not every update).

### 8.3 F-3 fixed: transition-aware `cancellation_reason` requirement at the DB layer

A plain symmetric `CHECK (status = 'CANCELLED' AND cancellation_reason IS NOT NULL)` (mirroring the existing `theses_rejection_reason_requires_status` CHECK) was **not used**, because it cannot distinguish a staff cancellation from `APPROVED`/`IN_PROGRESS` (BUS-47, reason required) from a student self-cancel out of `PENDING_APPROVAL` (BUS-46, no reason required) — a CHECK constraint only ever sees `NEW`, never the prior row. Per the review instructions, this was implemented as a **transition-aware `BEFORE UPDATE` trigger** instead: `theses_require_cancellation_reason()` (in `0030_theses.sql`) raises when `NEW.status = 'CANCELLED' AND OLD.status IN ('APPROVED', 'IN_PROGRESS')` and `NEW.cancellation_reason` is null/blank. Cancelling from `PENDING_APPROVAL` is untouched (not in the guarded `OLD.status` list), so BUS-46 is unaffected. This does not change the lifecycle table in the design doc — it only makes an already-documented RPC-level rule (BUS-47) enforceable at the DB layer too. Static evidence in `batch4DbTriggers.test.ts` asserts the trigger keys off `OLD.status` (not a CHECK) and that `PENDING_APPROVAL` never appears in the guarded function body.

### 8.4 Item 2's "direct-write RLS" caveat, addressed explicitly

The task instructions asked: if RLS allows a direct write path around the RPC pre-checks, that must be identified and handled, not left implicit. Reviewing `0033_rls_research_areas_advisors_theses.sql`: **`advisors` and `research_areas` do have staff-facing direct `UPDATE` RLS policies** (`advisors_update_staff`, `research_areas_update_staff` — `USING (public.is_training_staff())`), meaning a Training Staff user's PostgREST session genuinely can issue `UPDATE public.advisors SET is_active = false WHERE id = ...` directly, bypassing `staff_deactivate_advisor`'s pre-check entirely. This is not hypothetical — it is a real, RLS-permitted path for the `advisors`/`research_areas` tables specifically (not `theses`, which has no direct-write policy for anyone). This is exactly why the **DB trigger layer (0031 for advisor deactivate, and the two new triggers in 0030 for `theses`)** was already/now the required final backstop rather than "RPC pre-check is enough": the advisor-deactivate trigger (0031) already covers the direct-`UPDATE`-on-`advisors` path (it fires on any `UPDATE` to `advisors`, RLS-permitted or not), and the new `theses_block_inactive_advisor_in_progress` trigger (8.2) covers the case where an already-inactive advisor is being newly wired to an `IN_PROGRESS` thesis row. No RLS policy change was made — the existing staff `UPDATE` policies on `advisors`/`research_areas` are intentional (staff-managed catalogs) and are exactly what the trigger layer exists to backstop.

### 8.5 F-6 fixed: regression test for error safety (no raw Postgres text, business reasons preserved)

`apps/api/src/routes/theses.ts` was re-read in full: it already correctly uses a single `GENERIC_ERROR_MESSAGE` constant for every unexpected Supabase/RPC transport error and forwards only the RPC's own `{success:false, reason}` Vietnamese business payload for legitimate rejections (via `handleRpcResult`) — the "~10 spots fixed" claim in the implementation report checks out. What was missing was a test guarding this shape going forward. Added `apps/api/src/routes/theses.errorSafety.test.ts` (static, source-text based — no network, no live DB, no Admin API), which asserts:
- No `sendError` call in `theses.ts` ever forwards `error.message`/`err.message`.
- Every raw `if (error) { ... }` guard sends the `GENERIC_ERROR_MESSAGE` constant, not a per-call-site literal (a future endpoint added without following the pattern fails this test immediately).
- `handleRpcResult` still forwards `payload.reason` verbatim on business rejections, and each mutating endpoint passes a distinct `rejectedCode` (except the two cancel endpoints, which intentionally share `CANCEL_THESIS_REJECTED`) — confirming business-rule messages remain distinguishable per endpoint, not flattened.
- `errorHandler.ts`'s production branch never references `err.message`.

This directly satisfies the requirement: a regression test exists, runs with `npm run test` (no network/DB), and explicitly checks that business reasons are not swallowed.

### 8.6 Test run (this hardening pass, local static-only — no DB)

- `npm run typecheck` — pass (both workspaces).
- `npm run lint` — pass (1 pre-existing warning in `AuthContext.tsx`, unrelated to this batch).
- `npm run build` — pass (both workspaces).
- `npm run test` — pass: 68/68 API tests (including the 2 new files, 15 new test cases), 12/12 web tests.
- Manual secret scan (grep for key/token/secret/password patterns) on every file touched/added in this pass — no matches.
- **No live database of any kind (local or Cloud) is available in this environment**, so none of the new triggers' actual runtime behavior (does the trigger really fire, does the allowed UPDATE shape really pass, does a bypass attempt really raise) has been executed. This pass is evidence that the SQL text has the intended shape — the Section 6 transactional test plan (extended per 8.7 below) is still required before Cloud apply.

### 8.7 Section 6b transactional test plan — additions for this hardening pass

The following scenarios must be added to the live `BEGIN...ROLLBACK` pass (Section 6b) before Batch 4 is applied to Cloud, alongside the existing items 1–11:

12. **Append-only bypass attempt (thesis_advisor_history)**: after a real assign+reassign (so a row has `unassigned_at` set), attempt a direct `UPDATE thesis_advisor_history SET change_reason = 'x' WHERE id = ...` (any shape other than the exact unassigned_at-from-NULL close-out) → expect `RAISE EXCEPTION`. Attempt a direct `DELETE FROM thesis_advisor_history WHERE id = ...` → expect `RAISE EXCEPTION`. Then confirm the legitimate `staff_change_advisor` RPC still succeeds end-to-end (its internal `unassigned_at` UPDATE must not be blocked by the new trigger).
13. **Inactive-advisor bypass attempt (theses)**: with an advisor forced to `is_active = false` via direct SQL (bypassing `staff_deactivate_advisor`, for a test advisor with zero IN_PROGRESS theses so the 0031 guard doesn't block the deactivate itself), attempt a direct `UPDATE theses SET advisor_id = <that inactive advisor>, status = 'IN_PROGRESS' WHERE id = ...` → expect `RAISE EXCEPTION` from `theses_block_inactive_advisor_in_progress`, proving the backstop is independent of `staff_assign_advisor`/`staff_change_advisor`.
14. **Inactive-research-area bypass attempt (theses)**: with a research area forced to `is_active = false`, attempt a direct `UPDATE theses SET research_area_id = <that inactive area> WHERE id = ... AND status = 'PENDING_APPROVAL'` → expect `RAISE EXCEPTION`. Then confirm a thesis that already referenced that area *before* it was deactivated is unaffected by an unrelated `UPDATE theses SET title = ... WHERE id = ...` on the same row (BUS-63 regression check for the new trigger).
15. **Transition-aware cancellation-reason bypass attempt**: attempt `UPDATE theses SET status = 'CANCELLED' WHERE id = <a thesis currently APPROVED or IN_PROGRESS>` with `cancellation_reason` left NULL → expect `RAISE EXCEPTION` from `theses_require_cancellation_reason`, even via a direct SQL path bypassing `staff_cancel_thesis`. Then confirm a student self-cancel of a `PENDING_APPROVAL` thesis with no reason still succeeds (BUS-46 regression check).
16. **Direct-RLS-write confirmation (8.4)**: as an authenticated Training Staff session (not service-role), confirm `UPDATE public.advisors SET is_active = false WHERE id = ...` for an advisor with an IN_PROGRESS thesis is genuinely reachable via RLS (the `advisors_update_staff` policy permits it) and is blocked by the 0031 trigger, not by RLS itself — this proves the trigger, not the RLS policy, is what's actually stopping it.

### 8.8 Verification pass: "REJECTED requires rejection_reason" rule — already DB-enforced, no fix needed

A follow-up verification pass checked whether the rule "a thesis transitioning to `REJECTED` must have a non-blank `rejection_reason`" was actually enforced at the DB layer, independent of Zod/RPC/UI checks (the same standard applied to F-1/F-2/F-3).

**Finding: this rule was already fully DB-enforced from the original `0030_theses.sql`, by the table-level `CHECK` constraint `theses_rejection_reason_requires_status` (lines 45-48):**

```sql
constraint theses_rejection_reason_requires_status check (
  (status = 'REJECTED' and rejection_reason is not null and btrim(rejection_reason) <> '')
  or (status <> 'REJECTED')
)
```

Unlike the `cancellation_reason`/CANCELLED case (F-3), this rule does **not** need to distinguish between prior states — REJECTED is only ever reached from `PENDING_APPROVAL` (see `staff_reject_thesis` in `0036_rpc_thesis_staff_review.sql:105-107`, which rejects any other prior status before the UPDATE runs), so a plain `CHECK` on `NEW` alone is sufficient and correct:

- Any `INSERT` or `UPDATE` that sets `status = 'REJECTED'` with `rejection_reason` NULL or blank (empty/whitespace-only, via `btrim(...) <> ''`) is rejected by Postgres itself, regardless of write path (RPC, service-role, a future bug) — this is a hard schema constraint, not an application-level check.
- The second disjunct `(status <> 'REJECTED')` means the constraint imposes **no** requirement on `rejection_reason` for any other status (`PENDING_APPROVAL`, `APPROVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) — no false positives on those transitions.
- `staff_reject_thesis` (`0036:96-98`) additionally pre-checks `p_reason` client-side-friendly before the UPDATE, returning a `{success: false, reason: ...}` JSON response instead of letting the request fail on a raw Postgres constraint-violation error — the CHECK constraint is the backstop, the RPC pre-check is the UX layer, exactly the same pattern already used elsewhere in this migration set.

**No SQL/migration change was made** — the existing constraint already satisfies the requirement and altering it was unnecessary and out of scope.

**New static test added** (`apps/api/src/scripts/batch4DbTriggers.test.ts`, tests under "REJECTED rejection_reason CHECK constraint"): confirms the exact constraint text is present in `0030_theses.sql`, that it references `btrim(rejection_reason) <> ''` (blank-string rejection, not just NULL), and that the `(status <> 'REJECTED')` escape clause is present so non-REJECTED transitions are never blocked by it.

This finding is **VERIFIED LOCALLY BY STATIC TEXT EVIDENCE — TRANSACTION RETEST STILL REQUIRED**: the constraint's *text* has been confirmed present and structurally correct by this pass, but — like every other finding in this document — its actual runtime behavior against a live Postgres instance has not been proven here (no Cloud/psql/db push access in this environment). Add scenario 17 below to the Section 6b/8.7 transactional test plan.

17. **REJECTED-without-reason bypass attempt**: attempt a direct `UPDATE theses SET status = 'REJECTED', rejection_reason = NULL WHERE id = <a PENDING_APPROVAL thesis>` (and separately with `rejection_reason = '   '`, whitespace-only) → expect the `UPDATE` to fail with a `CHECK` constraint violation (`theses_rejection_reason_requires_status`), even bypassing `staff_reject_thesis` entirely. Then confirm `UPDATE theses SET status = 'REJECTED', rejection_reason = 'Lý do hợp lệ' WHERE id = ...` succeeds, and that unrelated updates to `PENDING_APPROVAL`/`APPROVED`/`IN_PROGRESS` rows with `rejection_reason` left NULL are never blocked by this constraint (no false positive).

## Final Verdict

**READY FOR BATCH 4 TRANSACTION TEST.**

F-1, F-2, F-3, and F-6 are **FIXED LOCALLY — TRANSACTION RETEST REQUIRED**: the SQL/trigger/test changes are in place and pass local static verification (typecheck/lint/build/test), but none of them have been proven against a live Postgres/Supabase instance in this environment, because no such instance is available here. The Section 6b/8.7 transactional test plan must be executed (`BEGIN...ROLLBACK`, non-production database) before Cloud apply, specifically items 8–9 (original) and 12–16 (new, added in this pass).

The "REJECTED requires rejection_reason" rule (Section 8.8) required **no fix** — it was already DB-enforced by the pre-existing `theses_rejection_reason_requires_status` CHECK constraint, now additionally confirmed by static test evidence. It is **FIXED LOCALLY (no change made) — TRANSACTION RETEST REQUIRED**, same as the other findings: static text evidence is not proof of live behavior. Add item 17 to the Section 6b/8.7 transactional test plan.

F-5 (P1, RLS/ACL live-verification) **explicitly remains in its original "needs verification on a live/transaction test" state and is NOT marked resolved by this pass.** Nothing in this hardening pass changed the ACL grant/revoke statements' *substance* (only three new internal helper functions were added, each following the exact same revoke-all convention and re-asserted in the 0038 sweep, per the F-1/F-2 fixes above) — the underlying reason F-5 exists at all is that a **static, read-only review of migration text cannot prove live Postgres/Supabase ACL state**, and this pass, being itself static and read-only (no Cloud/psql/db push access), is not capable of resolving that by construction. The Section 6a live read-only ACL queries against an actually-applied, non-production database remain the only way to close F-5, exactly as stated in the original verdict.

F-4 (P3, code-duplication/drift risk) remains open by deliberate choice — see 8.

None of the findings are P0. This review, including the hardening pass, remains **static only**. Only a real `BEGIN...ROLLBACK` transactional test executed against an actually-applied, live Postgres/Supabase database (Section 6b + 8.7) can prove the new triggers actually fire as intended, that the pre-existing triggers/RLS/ACL behave as their text claims, and that concurrency/locking behavior holds under genuine concurrent load.

---

## 9. Transaction Test Pass (2026-08-03, live Supabase Cloud, single connection, `BEGIN...ROLLBACK`)

This section executes the Section 6b/8.7 test plan against the actual Cloud Postgres instance. **Migrations 0028–0038 were never applied via `supabase db push`** — instead, one `psql` session opened `BEGIN;`, loaded the 11 migration files verbatim with `\i`, ran all scenarios below, and ended with `ROLLBACK;` as the final statement. No `COMMIT`, no `db push`/`migration repair`, no seed/Admin API/Auth-user calls, no commit/push/deploy. A temporary QA SQL script was used to drive the session and was deleted immediately afterward.

**Scope and honest limitation, stated up front:** this is a **single-connection, single-transaction** test. Every scenario below — including "capacity" and "sequential thesis_code" — was run **sequentially inside one transaction**, not from two concurrent sessions. Because migrations 0028–0038 are uncommitted, a second real session cannot see any of this schema, so a genuine two-session concurrency/race test is **not possible** in this environment and was **not attempted or claimed**. The `SELECT ... FOR UPDATE` locking logic in the RPCs was **only statically re-read**, not exercised under real contention. A true concurrency test is required post-apply (see Final Verdict below).

### 9.1 Baseline (read-only, before the transaction)

| # | Check | Result |
|---|-------|--------|
| A.1 | Remote migration history via `supabase migration list --linked` | Stops at `0027`; PASS |
| A.2 | Local pending migrations | Exactly `0028`–`0038`; PASS |
| A.3 | Batch 4 tables (`research_areas`, `advisors`, `theses`, `thesis_code_counters`, `thesis_advisor_history`) pre-existence | 0 rows — none exist yet; PASS |
| A.4 | Demo accounts | 1 `TRAINING_STAFF`, 2 `STUDENT` (both `academic_status = STUDYING`) found; no email/credential printed; PASS |

Baseline was clean — proceeded to the transaction test (no BLOCKED condition at this stage).

### 9.2 Transaction test results

All 0028–0038 migrations loaded cleanly inside the transaction (checkpoint query confirmed all 5 tables present mid-transaction). QA setup used prefix `QATMP-B4-` for all research areas/advisors/theses created, `min_thesis_credits` was temporarily lowered to 0 (in-transaction only) on the demo students' program so eligibility didn't depend on their real earned-credit totals, and role/RLS switching used the same pattern as prior batches: `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true); set role authenticated;` / `set role anon;`, with `reset role;` returning to the table-owner (`postgres`) role for privileged setup between scenarios. `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` wrapped every scenario expected to raise a hard error (constraint/trigger/permission-denied), so a single expected failure never poisoned the rest of the transaction.

| # | Scenario | Expected | Actual | Verdict |
|---|----------|----------|--------|---------|
| C1.1 | Schema shape: PK/FK/unique/CHECK/index on `theses` etc. | Matches migration text | Confirmed via `pg_constraint`/`pg_indexes` | PASS |
| C1.2a | Direct-write `REJECTED` with NULL `rejection_reason` | CHECK violation | `ERROR: violates check constraint "theses_rejection_reason_requires_status"` | PASS |
| C1.2b | Direct-write `REJECTED` with whitespace-only `rejection_reason` | CHECK violation | Same CHECK violation (blank caught by `btrim(...)<>''`) | PASS |
| C1.3 | Staff cancel APPROVED→CANCELLED with NULL `cancellation_reason`, direct UPDATE bypass | Trigger blocks | `ERROR: Phải nhập lý do khi hủy...` from `theses_require_cancellation_reason` | PASS |
| C1.4 | Student self-cancels own PENDING thesis with no reason | RPC succeeds | `{"success":true}`, status CANCELLED, reason NULL | PASS |
| C1.5 | One student >1 active thesis: RPC precheck, then direct-insert bypass | RPC rejects; direct insert hits unique index | RPC: `"Bạn đã có một luận văn đang hoạt động..."`; direct insert: `ERROR: duplicate key ... "theses_one_active_per_student"` | PASS |
| C2.1 | STUDYING + credits(temp-lowered)=0 + no active thesis → proposal | Succeeds | `{"success":true}`, code `LV-2026-0002` | PASS |
| C2.2 | SUSPENDED student blocked from eligibility/create | Rejected | Both reasons: wrong status + (transiently) active thesis, listed correctly | PASS |
| C2.3 | Student edits own APPROVED thesis | Blocked | `"Chỉ có thể sửa đề xuất khi còn chờ duyệt."` | PASS |
| C2.4 | REJECTED does not reopen; student can propose again (no longer active) | Edit blocked; new proposal succeeds | Edit: blocked (same reason); eligibility: `eligible:true`; new proposal: `{"success":true}` | PASS |
| C2.5 | Student calls `staff_approve_thesis` | Blocked (role check) | `ERROR: only training staff may approve a thesis` | PASS |
| C2.6 | COMPLETED thesis cannot be cancelled | Blocked | `{"success":false,"reason":"Không thể hủy luận văn đã hoàn thành."}` | PASS |
| C3.1 | Create proposal against inactive research area | Blocked | `"Lĩnh vực nghiên cứu không hợp lệ hoặc đã ngừng hoạt động."` | PASS |
| C3.2 | Edit PENDING thesis to inactive area via RPC, then direct UPDATE bypass | RPC blocked; trigger blocks direct bypass | RPC: same reason; direct UPDATE: `ERROR:` same message from `theses_block_inactive_research_area` | PASS |
| C3.3 | Thesis referencing a since-deactivated area still readable/unaffected by unrelated update | Row unaffected | `research_area_id` unchanged across an unrelated `title` UPDATE, area deactivated in between | PASS |
| C3.4 | Assign inactive advisor via RPC, then direct UPDATE to IN_PROGRESS bypass | RPC blocked; trigger blocks bypass | RPC: `"Giảng viên này không còn hoạt động."`; direct UPDATE: `ERROR:` from `theses_block_inactive_advisor_in_progress` | PASS |
| C3.5 | Deactivate advisor with IN_PROGRESS thesis, via RPC then direct UPDATE bypass | Both blocked | RPC: `{"success":false,...,"blocking_theses":[...]}`; direct UPDATE: `ERROR:` from `advisors_block_deactivate_when_in_progress` | PASS |
| C3.6 | Same deactivate-bypass attempt, but as an authenticated Training Staff session (not table owner) | RLS permits the UPDATE to reach the table; trigger (not RLS) raises | `ERROR:` identical trigger message reached under `authenticated`+staff role, confirming RLS does not block this path — the trigger does | PASS |
| C3.7 | Advisor with 0 remaining IN_PROGRESS theses can be deactivated | Succeeds | `{"success":true}`, `is_active:false` confirmed | PASS |
| C3.8 | Reassign only from IN_PROGRESS, reason required, writes append-only history; DELETE and non-conforming UPDATE on history blocked | All as designed | No-reason reassign blocked; with-reason reassign succeeds, 2 history rows (`unassigned_at` set on the old one); direct DELETE → `ERROR: ...append-only: DELETE is not permitted`; direct UPDATE of `change_reason` on a closed row → `ERROR: ...only setting unassigned_at once, from NULL, is permitted` | PASS |
| C4.1 | Advisor `max_active_theses=1`: assign 1st thesis, then assign 2nd thesis (sequential, same transaction) | 1st succeeds, 2nd capacity-blocked | 1st: `{"success":true}`; 2nd: `{"success":false,"reason":"Giảng viên đã đạt số luận văn hướng dẫn tối đa."}` | PASS — **sequential only, see limitation above** |
| C4.2 | Two proposals same year get distinct sequential `thesis_code` | Increasing codes, no collision | `LV-2026-0002`, `LV-2026-0003` | PASS — **sequential only, not a substitute for a concurrent-race test** |
| C5.1 | `anon`: RPC calls and direct table SELECT | All blocked | RPC calls: `ERROR: permission denied for function ...` (both a student and a staff RPC tried); direct `SELECT * FROM theses`: 0 rows (RLS, no policy for anon) | PASS |
| C5.2 | `authenticated` student A: reads own thesis, cannot read student B's row, cannot call staff RPC | All as designed | Own row: 1 row returned; student B's row: 0 rows; `staff_list_theses`: `ERROR: only training staff may list theses` | PASS |
| C5.3 | `authenticated` staff: catalog/review/assignment RPCs | Succeed | `staff_list_theses(NULL)` returned 8 rows; `staff_list_advisors()` returned all 5 QA advisors | PASS |
| C5.4 | ACL matrix via `has_function_privilege` for `anon`/`authenticated`/`PUBLIC` | Public RPCs: anon=f, authenticated=t, PUBLIC=f; internal trigger/helper functions: all f | Confirmed exactly for all 14 public RPCs and 4 internal helper/trigger functions sampled | PASS |
| C6 | Error safety at the DB layer: blank-input business rejections | Return a clean business reason, no raw constraint/SQLSTATE text | `student_create_thesis_proposal('', ...)` → `"Tiêu đề đề xuất không được để trống."`; `staff_reject_thesis(id,'')` → `"Vui lòng nhập lý do từ chối."` | PASS (DB layer only — see limitation below) |

**Result: 34/34 sub-scenarios PASS, 0 FAIL.**

### 9.3 Post-rollback verification (fresh connection, after `ROLLBACK`)

| Check | Result |
|-------|--------|
| Remote migration history (`supabase migration list --linked`) | Still stops at `0027`; `0028`–`0038` still show as pending-local-only | PASS |
| Batch 4 tables (`research_areas`, `advisors`, `theses`, `thesis_code_counters`, `thesis_advisor_history`) | 0 rows returned from `information_schema.tables` — none exist | PASS |
| `QATMP-B4-` rows anywhere | 0 rows | PASS |
| Demo profiles | Still 1 `TRAINING_STAFF`, 2 `STUDENT`, both `academic_status = STUDYING` (the transient `SUSPENDED` write from C2.2 did not survive) | PASS |
| `programs.thesis_credits_min` for the demo program | Back to `12` (the transient 0 from setup did not survive) | PASS |

No baseline drift of any kind was observed. This check is scoped to the specific rows/tables touched or queried in this pass (profiles, programs, migration history, Batch 4 tables) — there is no full-database row-count/checksum snapshot from before the transaction, so a claim of *zero* system-wide side effects beyond this scope cannot be made with absolute certainty; only the specific rows and objects checked here are confirmed unchanged.

### 9.4 What this pass does NOT prove

- **No true 2-session concurrency/race test was run or claimed.** C4.1 (advisor capacity) and C4.2 (thesis_code sequencing) were exercised sequentially in one session/transaction. The `SELECT ... FOR UPDATE` locking that is supposed to serialize concurrent callers was **not exercised under actual contention** — only re-read statically. This must be tested with two real concurrent sessions **after** Batch 4 is applied and committed (uncommitted DDL is invisible to a second session, which is exactly why this couldn't be done now).
- **API-layer (Express) error-message mapping was not exercised here.** Section 9.2's C6 result covers only the DB/RPC layer returning a clean `{success:false, reason:...}` payload; the claim that `apps/api/src/routes/theses.ts` never forwards raw `error.message` remains backed by the static source-text test (`theses.errorSafety.test.ts`) referenced in Section 8.5, not by a live HTTP call in this pass.
- **F-4 (eligibility-logic duplication) is unrelated to this pass** and remains open by deliberate choice, as stated in Section 8.

### Final Verdict (2026-08-03, after live transaction test)

**READY FOR BATCH 4 APPLY — TRUE CONCURRENCY TEST REQUIRED POST-APPLY.**

All 34 functional/RLS/RPC/lifecycle/trigger scenarios in the Section 6b/8.7 test plan passed against live Supabase Cloud inside a single `BEGIN...ROLLBACK` transaction that was never committed. F-1, F-2, F-3, and F-6 (fixed in the Section 8 hardening pass) are now confirmed to actually fire at runtime, not just to have the right static shape. F-5 (RLS/ACL live verification) is now resolved: the live `has_function_privilege` ACL matrix (C5.4) matches stated intent for every function sampled, and the direct-RLS-write scenario (C3.6) confirms the trigger — not RLS — is the actual backstop where RLS itself permits a write path.

The advisor-capacity and thesis-code-sequence locking logic (`SELECT ... FOR UPDATE`, the `thesis_code_counters` atomic upsert) is **only statically reviewed and sequentially exercised** at this stage — a genuine two-concurrent-session race test against these two mechanisms is required after Batch 4 is committed/applied to Cloud, before this is considered fully closed. This is a hard requirement, not a nice-to-have, given that the entire point of the `FOR UPDATE` locking pattern is to serialize genuinely concurrent callers, which by construction cannot be observed from a single session.

F-4 (P3, code-duplication/drift risk) remains open by deliberate choice, unchanged from Section 8.

No P0 findings at any stage of this review. The temporary QA SQL script used to drive this transaction test has been deleted; no migration files, seed data, or Auth users were modified; nothing was committed, pushed, or deployed.
