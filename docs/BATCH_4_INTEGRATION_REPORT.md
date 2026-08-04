# Batch 4 QA Integration Test Report

Date: 2026-08-04
Scope: `graduate-course-registration-system` (apps/api + apps/web) against the real Supabase Cloud project referenced by `apps/api/.env` / `apps/web/.env`. All QA data uses the reserved prefix `QATMP-B4-INT-`.

## Methodology note

This test ran across multiple resumed agent sessions after an earlier session crashed on a session/output limit mid-run. Because of that, part of Phase C was re-run defensively by a later session that didn't realize an earlier resumed session had already completed Phase C and Phase D successfully. This caused two unintended side effects, disclosed in full below. The numbers and statuses in this report were re-verified directly against the live Cloud DB via a read-only service-role query (not taken from any agent's self-report) as of 2026-08-04 ~02:00 UTC, so this document reflects ground truth, not narrative.

1. Phase B (QA baseline) was created once, successfully, in the first crashed session — never recreated.
2. A leftover QA-student credential file from that crashed session was reused to obtain a real student JWT; the existing `DEMO_STAFF_EMAIL`/`DEMO_STAFF_PASSWORD` account was reused as staff (not new QA data).
3. Phase C was run to completion. A later, overlapping session re-ran part of Phase C defensively (in case the first hadn't finished) and, due to a bug in its own re-run script, caused two live side effects via real API calls (not direct DB writes):
   - Created a 4th, duplicate PENDING thesis, immediately self-cancelled via the real cancel endpoint.
   - Deactivated advisor #1 via the real staff deactivate endpoint (permitted at that moment because advisor #1 was no longer the assigned advisor — it had already been reassigned to advisor #2). **There is no reactivate endpoint in this API**, so this cannot be undone without a direct, out-of-spec DB write.
4. Phase D (Playwright UI) was run once, successfully, against the final state (screenshots confirm all 4 theses in their correct terminal statuses).

## Verified final QA data (read live via service-role, read-only)

| Table | Count | Notes |
|---|---|---|
| `auth.users` (QA student) | 1 | unchanged from Phase B |
| `profiles` | 1 | role STUDENT, student_status ACTIVE, program/cohort/student_code assigned |
| `programs` | 1 | `QATMP-B4-INT-PROG-7upa7x`, `min_thesis_credits = 0` |
| `cohorts` | 1 | `QATMP-B4-INT-COHORT-7upa7x` |
| `research_areas` | 1 | `QATMP-B4-INT-Area 7upa7x`, `is_active = true` |
| `advisors` | 2 | `QATMP-B4-INT-ADV1-7upa7x` — **is_active = false** (deviation, see below); `QATMP-B4-INT-ADV2-7upa7x` — is_active = true |
| `theses` | **4** (spec cap: 3) | all 4 terminal — see below |
| `thesis_advisor_history` | 2 | both rows belong to thesis #1 (`LV-2026-0006`): assign → advisor #1 (no reason), reassign → advisor #2 (`change_reason = "QATMP-B4-INT-reassign reason"`); ordering/timestamps correct (row 1's `unassigned_at` = row 2's `assigned_at`) |

Final thesis statuses (verified live):
- `LV-2026-0006` "...Thesis1-edited..." — **COMPLETED** (required #1) ✓
- `LV-2026-0007` "...Thesis2..." — **CANCELLED**, self-cancel (required #2) ✓
- `LV-2026-0008` "...Thesis3..." — **REJECTED**, staff reason (required #3) ✓
- `LV-2026-0009` "...Thesis1" (no suffix) — **CANCELLED** — extra duplicate from the harness bug, cleaned up to terminal state

No QA thesis is left `PENDING_APPROVAL` / `APPROVED` / `IN_PROGRESS`.

## Phase C: API test results

| ID | Case | Result |
|---|---|---|
| C1 | Student eligibility check reports eligible | PASS |
| C2 | Create thesis #1 PENDING, `thesis_code` matches `LV-YYYY-NNNN` | PASS (`LV-2026-0006`) |
| C3 | Edit title/description/area while PENDING succeeds | PASS |
| C4 | Staff approves thesis #1 | PASS |
| C5 | Student edit after APPROVED blocked (4xx) | PASS (`UPDATE_THESIS_REJECTED`) |
| C6 | Assign advisor #1 → IN_PROGRESS | PASS |
| C7 | Reassign to advisor #2 with reason succeeds; history has correct 2 rows/IDs/reason/ordering | PASS (verified directly against DB rows above) |
| C8 | Staff marks thesis #1 COMPLETED | PASS |
| C9 | Reassign/cancel after COMPLETED blocked (4xx) | PASS (both 400) |
| C10 | Thesis #2 create → self-cancel, no reason → CANCELLED | PASS |
| C11 | Thesis #3 create → staff reject with reason → REJECTED | PASS |
| C12a | Student blocked from staff-only endpoints (advisors/research-areas/approve) | PASS (403 on all three) |
| C12b | Staff cannot deactivate an advisor currently IN_PROGRESS on an active thesis (migration 0031 guard) | PASS — confirmed live (400 `DEACTIVATE_ADVISOR_REJECTED` while advisor #1 was still IN_PROGRESS, before reassignment) |
| C12c | Cross-student thesis read blocked | LIMITATION, not exercised — scope caps the environment at exactly 1 QA student |
| C13 | Exactly 3 QA theses, all terminal, none non-terminal | **PARTIAL** — all 4 are terminal (none PENDING/APPROVED/IN_PROGRESS), but count is 4, not 3, due to the harness bug described above |

## Phase D: Playwright UI tests

Ran headless Chromium via a temporary Playwright install (OS-temp scratch dir, not added to the repo) against the local API + web dev servers pointed at Cloud.

| ID | Case | Result |
|---|---|---|
| D1/D2 | Login as QA student, "Luận văn của tôi" shows no active thesis and a history table with correct Vietnamese status labels for all 4 terminal theses | PASS — confirmed by direct screenshot review: `LV-2026-0009` "Đã hủy", `LV-2026-0008` "Đã từ chối", `LV-2026-0007` "Đã hủy", `LV-2026-0006` "Hoàn thành" |
| D3 | Login as staff, QA research area and both QA advisors visible; QA theses visible in staff list reflecting Phase C outcomes | PASS |
| D4 | UI never exposed another student's thesis to the QA student | PASS |
| D5 | No unexpected 4xx/5xx or console errors during positive-path navigation | PASS |

Screenshots (scratchpad, not in repo): `D2-student-thesis.png`, `D3a-staff-research-areas.png`, `D3b-staff-advisors.png`, `D3c-staff-theses-list.png` at
`C:\Users\ngoqu\AppData\Local\Temp\claude\e--Users-ngoqu-LapTrinh-web-DAPV\ed2a4279-299a-488d-af63-9e43ea0f12a5\scratchpad\batch4-integration-screenshots\`.
Manually spot-checked `D2-student-thesis.png`: matches the verified DB state exactly.

## Negative / RBAC summary

- Student → staff-only endpoints: 403 confirmed (advisors list, research-areas list, thesis approve).
- Edits blocked once a thesis leaves PENDING (APPROVED) and once COMPLETED (reassign + cancel both blocked).
- Advisor deactivation blocked while IN_PROGRESS on an active thesis (guard confirmed live).
- Cross-student read: not testable in-scope (limitation, not a failure — only 1 QA student exists by design).

## Confirmation of permanent Cloud data

No hard delete was performed anywhere. All QA rows are real, permanent Cloud rows: 1 QA auth user/profile, 1 program, 1 cohort, 1 research area, 2 advisors (1 active, 1 now inactive — see deviation), 4 theses (all terminal), 2 advisor-history rows. `docs/BATCH_4_CONCURRENCY_TEST_REPORT.md` referenced in the original task instructions does not exist in this repo (only `docs/DB_CONCURRENCY_TEST_PLAN.md` and `docs/BATCH_4_IMPLEMENTATION_REPORT.md` do); the `QATMP-B4-CONC-` prefixed concurrency-test data that does exist (e.g. `QATMP-B4-CONC- Research Area`) was spot-checked and confirmed unmodified.

## Deviations from spec

1. **Thesis count = 4, not 3.** One duplicate PENDING thesis was accidentally created by a re-run harness bug in an overlapping session and immediately self-cancelled via the real API. Net effect is harmless (all 4 terminal, correct statuses on the 3 required theses) but exceeds the stated row cap by one CANCELLED row.
2. **Advisor #1 left permanently `is_active = false`.** Deactivated via the real staff API by the same overlapping-session bug, at a moment when it was legitimately allowed (already reassigned off the thesis). There is no reactivate endpoint anywhere in this system's API/schema.
3. **C12c** (cross-student thesis read) not exercised — by design, scope caps the environment at exactly 1 QA student.

## Human decision (2026-08-04)

A human reviewer reviewed the two deviations above and made the following decision:

- **Accepted: 4 QA theses instead of 3.** The extra thesis is a harmless, terminal `CANCELLED` row created via the real cancel API (not a direct DB write). It is kept as-is and treated as part of the QA audit trail for this batch, not as a defect to clean up.
- **Accepted: Advisor #1 remains `is_active = false`.** This is a valid, real state reached entirely through the real staff API after a legitimate reassignment — not a corrupted or inconsistent state. It additionally serves as live evidence that the advisor-deactivate-while-IN_PROGRESS guard (migration 0031) correctly blocks deactivation before reassignment (C12b) and correctly permits it after (this row). It is kept as-is.
- **No direct `UPDATE` was run to reactivate advisor #1.** There is no reactivate endpoint in this API by design; running a raw `UPDATE advisors SET is_active = true ...` would bypass that business rule and was judged unnecessary — the inactive state is itself valid QA evidence, not an error condition needing correction.

Both deviations are confirmed to be **test-harness/test-data artifacts from an overlapping agent re-run**, not defects in the API, UI, business rules, RBAC, or lifecycle guards under test — every one of those passed per the evidence in Phases C and D above. Neither deviation touched or affected any QA data outside the scope of this Batch 4 report (the separate `QATMP-B4-CONC-` concurrency-test data was spot-checked and confirmed unmodified — see "Confirmation of permanent Cloud data" above), nor any non-QA business data.

## Final QA data inventory (post-decision)

- 1 QA Auth student / profile (STUDENT role, ACTIVE status)
- 1 QA program, 1 QA cohort
- 1 QA research area (active)
- 2 QA advisors — advisor #1 `is_active = false` (accepted, see decision above), advisor #2 `is_active = true`
- 4 QA theses, all terminal: 1 COMPLETED, 2 CANCELLED, 1 REJECTED
- 2 `thesis_advisor_history` rows (assign + reassign on thesis #1), ordering/timestamps verified correct

## Verdict

**READY FOR BATCH 4 COMMIT AND DEPLOY**

Every observed application behavior passed: RBAC, all lifecycle guards (including the advisor-deactivate-while-IN_PROGRESS guard, confirmed live both blocked and permitted at the correct moments), thesis_code generation, advisor history correctness, and UI display all worked exactly as specified. The two deviations from the original spec numbers (4 theses instead of 3; advisor #1 inactive instead of both active) are test-harness/test-data artifacts from an overlapping agent re-run, reviewed and accepted by a human reviewer as harmless and, in the advisor #1 case, additionally useful as guard-behavior evidence. No commit, push, or deploy was performed as part of producing this report.
