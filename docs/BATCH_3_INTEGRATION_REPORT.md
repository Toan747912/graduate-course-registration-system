# Batch 3 — Integration Report (grades & progress, retest)

Date: 2026-08-03. Scope: live API/RPC + UI integration retest of Batch 3
(`enrollment_grades`, migrations 0021–0027, already permanently applied to
Cloud) against the Cloud project, using the local API (working-tree code,
port 4000) and the local web dev server (port 5173) against that same Cloud
project. Real Supabase `signInWithPassword` JWTs for the 3 existing demo
accounts (`staff.demo`, `student1.demo`, `student2.demo`) were used
throughout — no Admin API, no magic links, no new Auth user, no
`seed.sql`/seed script run, no git commit/push/deploy. No
password/token/key/DB URL was printed at any point; temporary files holding
credentials/tokens were deleted from the scratchpad directory before this
report was written.

## 0. Prior incident (acknowledged, not repeated)

The previous attempt (superseded by this file) was correct on business
logic (21/21 API PASS) but was ruled **BLOCKED** for scope violations:

1. It reused the two pre-existing demo-student (`student1.demo` /
   `HV-DEMO-001`) `CONFIRMED` enrollments (`CS601-01`, `CS602-01`) instead of
   an isolated QA class/enrollment.
2. It produced 2 permanent `enrollment_grades` rows instead of 1.
3. It used the Supabase Admin API (`admin.auth.admin.generateLink` +
   `verifyOtp`) to mint student JWTs because `apps/api/.env` had no student
   password credentials.

Those two rows still exist exactly as left: `HV-DEMO-001` /
`CS601` → `PUBLISHED`, `final_score=7.5`, `PASS`, and `HV-DEMO-001` /
`CS602` → `PUBLISHED`, `final_score=3.0`, `FAIL`. This retest did **not**
touch, re-read for mutation, or otherwise modify either row — they were only
read (SELECT) during preflight/post-check to confirm they were unaffected
(see §5 below). They are pre-existing demo/QA data, not part of this
retest's own result set.

Since the last attempt, `apps/api/.env` was updated to add
`DEMO_STUDENT1_PASSWORD`/`DEMO_STUDENT2_PASSWORD` alongside the existing
`DEMO_STAFF_PASSWORD`, which resolves blocker #3.

## 1. Preflight (read-only)

| Check | Result |
|---|---|
| `supabase migration list --linked`: local == remote through `0027`, no drift | **PASS** |
| `apps/api/.env` has `DEMO_STAFF_EMAIL/PASSWORD`, `DEMO_STUDENT1_EMAIL/PASSWORD`, `DEMO_STUDENT2_EMAIL/PASSWORD` (existence only checked, values never printed) | **PASS** |
| Real `signInWithPassword` login for all 3 accounts (staff, student1, student2) | **PASS** — all 3 returned a valid session/access token |
| QA student selection: `student2.demo` (`HV-DEMO-002`), `academic_status=STUDYING`, `student_status=ACTIVE`, program `CS-MASTER` (`pass_score_min=5`), cohort `K2026`, **0 existing enrollments** (no collision risk, cleanest isolation) | **PASS** |
| Candidate course: `CS603` (REQUIRED, 4 credits, in `CS-MASTER`'s `program_courses`), no existing class/schedule collision for student2 (0 confirmed classes), not one of the two courses (`CS601`/`CS602`) already carrying old published grades | **PASS** |
| Open registration period: semester `2026-1`, `opens_at`..`closes_at` window currently open, `max_credits=18` | **PASS** |
| Class code `QA-GRADE-B3-RETEST1`: no existing `course_classes` row with that code before creation | **PASS** |

No blocking condition found → preflight passed, proceeded to writes.

## 2. Local servers

- `npm run dev:api` (port 4000) — `GET /api/health` → `{"ok":true,...}` before
  testing; stopped (killed by PID) at the end.
- `npm run dev:web` (Vite dev server, port 5173) — used for the Playwright UI
  pass, pointed at the same Cloud project via the working-tree `.env`;
  stopped (killed by PID) at the end. Both confirmed unreachable
  (connection refused) after teardown.

## 3. API test matrix (real JWTs, live Cloud RPCs)

QA class: `QA-GRADE-B3-RETEST1`, course `CS603` (Applied Machine Learning, 4
credits, REQUIRED), 1 schedule slot. QA student: `student2.demo`
(`HV-DEMO-002`). QA enrollment: 1, `CONFIRMED`. QA grade: 1,
`final_score=8.5` (≥ `pass_score_min=5`).

| # | Case | Result |
|---|---|---|
| 1 | `POST /staff/course-classes` — create `QA-GRADE-B3-RETEST1` (CS603, 1 schedule, non-colliding slot) | **PASS** — `201`, `class_id` returned, `schedule_count=1` |
| 2 | `POST /student/enrollments` (student2, new class) → register | **PASS** — `200 CONFIRMED` directly (no waitlist needed, seats available) |
| 3 | `GET /staff/course-classes/:id/enrollments` — roster | **PASS** — exactly 1 row, student2, `CONFIRMED` |
| 4 | `GET /staff/course-classes/:id/grades` before grading | **PASS** — 1 row, `grade_status=null` |
| 5 | `POST /staff/enrollments/:id/grade` (`finalScore=8.5`) | **PASS** — `201`, `grade_status=DRAFT` |
| 6 | `GET /student/grades` (student2) before publish | **PASS** — `[]`, DRAFT not leaked |
| 7 | `GET /student/progress` (student2) before publish | **PASS** — `required_credits_earned=0` |
| 8 | `POST /staff/enrollments/:id/grade/publish` | **PASS** — `200`, `grade_status=PUBLISHED`, `result_status=PASS` (8.5 ≥ 5, BUS-32) |
| 9 | `GET /student/grades` (student2) after publish | **PASS** — exactly 1 row: CS603, `8.5`, `PASS`, `counts_towards_progress=true` |
| 10 | `GET /student/progress` (student2) after publish | **PASS** — `required_credits_earned=4` (CS603's 4 credits, REQUIRED bucket), `elective_credits_earned=0` |
| 11 | `GET /staff/students/:id/progress` vs student's own `/student/progress` | **PASS** — identical payload |
| 12 | `GET /staff/students/:id/grades` vs student's own `/student/grades` | **PASS** — identical (1 row, PUBLISHED/PASS) |
| 13 | Negative: `POST /staff/enrollments/:id/grade` called with student2 JWT | **PASS** — `403 FORBIDDEN`, no row created |
| 14 | Negative: `PATCH /staff/enrollments/:id/grade` on the now-PUBLISHED grade (staff) | **PASS** — `400 UPDATE_GRADE_REJECTED` (BUS-31 lock), row unchanged |
| 15 | Negative: `POST /student/enrollments/:id/cancel` (student2, self-cancel graded enrollment) | **PASS** — `200 {success:false, reason:"Lượt đăng ký đã có điểm, không thể tự hủy"}` (BUS-37), enrollment still `CONFIRMED` |
| 16 | Negative: `POST /staff/course-classes/:id/cancel` on the QA class (now graded) | **PASS** — `200 {success:false, reason:"Lớp học phần đã có điểm, không thể hủy"}` (BUS-36), class still `ACTIVE` |
| 17 | Negative: `GET /student/grades` with no `Authorization` header | **PASS** — `401` |

**17/17 API cases PASS.**

## 4. UI Playwright pass

Script run from the scratchpad directory (outside the repo, not committed),
against local API (4000) + local web (5173) pointed at Cloud, using real
`signInWithPassword` sessions for staff and student2 driven through the
actual login form.

| # | Case | Result |
|---|---|---|
| 1 | Staff login via UI form → redirected off `/login` to `/staff` | **PASS** |
| 2 | Staff → `/staff/course-classes/:id/grades` → roster shows student2 (`HV-DEMO-002`) | **PASS** |
| 3 | Staff grade page shows "Đã công bố" (PUBLISHED) badge | **PASS** |
| 4 | Staff grade page shows "Đạt" (PASS) result | **PASS** |
| 5 | Staff grade page shows "Đã khóa" (locked) instead of edit buttons | **PASS** |
| 6 | Staff score `<input>` is `disabled` (published → locked) | **PASS** |
| 7 | Staff page: 0 browser console errors | **PASS** |
| 8 | Staff page: 0 unexpected 4xx/5xx network responses | **PASS** |
| 9 | Student login via UI form → redirected off `/login` to `/student/classes` | **PASS** |
| 10 | Student "Kết quả học tập" (`/student/grades`) shows CS603 row | **PASS** |
| 11 | Student "Kết quả học tập" shows "Đạt" (PASS) | **PASS** |
| 12 | Student "Kết quả học tập" contains no "Nháp" (DRAFT) label anywhere | **PASS** |
| 13 | Student progress ("Tiến độ tín chỉ" section, same page) shows `Tín chỉ bắt buộc: 4/20` | **PASS** |
| 14 | Student "Lịch sử đăng ký" (`/student/history`) shows the QA (CS603) enrollment | **PASS** |
| 15 | Student history: QA enrollment's "Hủy" (cancel) button is disabled (graded) — not clicked | **PASS** |
| 16 | Student page: 0 browser console errors | **PASS** |
| 17 | Student page: 0 unexpected 4xx/5xx network responses | **PASS** |

**17/17 UI cases PASS.** Screenshots saved to the scratchpad directory
(`staff-grades.png`, `student-grades.png`, `student-history.png`) — not
committed to the repo. Note: this app has no separate "Tiến độ học tập"
route; credit progress is rendered as a card on the same `/student/grades`
("Kết quả học tập") page, verified above.

## 5. Post-check (read-only, Cloud)

| Check | Result |
|---|---|
| `course_classes` rows with `class_code like 'QA-GRADE-B3-%'` | **PASS** — exactly 1 (`QA-GRADE-B3-RETEST1`, `status=ACTIVE`) |
| `class_schedules` rows for that class | **PASS** — exactly 1 |
| New enrollment(s) for that class | **PASS** — exactly 1 (student2, `CONFIRMED`) |
| `enrollment_grades` total row count | **PASS** — exactly 3: the 2 pre-existing rows (`CS601` PUBLISHED/7.5/PASS, `CS602` PUBLISHED/3.0/FAIL, both still on `HV-DEMO-001`, values unchanged) + exactly 1 new row (`CS603` PUBLISHED/8.5/PASS, on `HV-DEMO-002`) |
| No second/duplicate QA grade row | **PASS** |
| Pre-existing `HV-DEMO-001` grades unmodified | **PASS** — re-read, identical to values recorded in the prior (superseded) report |
| No other program/cohort/course/semester/Auth-user row created or modified | **PASS** |

## 6. Deviations from the original plan

- QA student is `student2.demo` (`HV-DEMO-002`), not `student1.demo` — chosen
  specifically because it had zero pre-existing enrollments, giving the
  cleanest possible isolation (zero schedule-collision risk) and avoiding
  any proximity to the two pre-existing published grades, which live on
  `student1.demo`.
- Only 1 QA class/enrollment/grade was created end-to-end (as required); no
  second FAIL-path grade was created this time — BUS-32's FAIL branch
  (`result_status=FAIL` when `final_score < pass_score_min`) was already
  proven in the prior attempt's case 11 and did not need a second real
  permanent row to re-prove, given the hard 1-row constraint for this retest.

## 7. Cloud data changes now permanently in place

- **`public.course_classes`**: 1 new row, `class_code=QA-GRADE-B3-RETEST1`,
  course `CS603`, `status=ACTIVE`. No delete path exists for course classes
  (only cancel, which was deliberately rejected in test case 16 because the
  class now has a grade) — this row is permanent.
- **`public.class_schedules`**: 1 new row for the class above.
- **`public.enrollments`**: 1 new row, student2 (`HV-DEMO-002`) ×
  `QA-GRADE-B3-RETEST1`, `status=CONFIRMED`. No delete/cancel path succeeded
  against it (BUS-37 correctly blocked cancellation) — permanent.
- **`public.enrollment_grades`**: 1 new row, `PUBLISHED`, `final_score=8.5`,
  `result_status=PASS`, non-reversible by design (BUS-31, no unpublish
  path) — permanent.
- **`public.enrollment_history`**: whatever rows the system auto-generated
  as a side effect of the registration above (not separately counted here,
  per the allowed side-effect clause).
- The 2 pre-existing `HV-DEMO-001` published grades (`CS601`/`CS602`) remain
  exactly as they were — untouched by this retest.

No production frontend was used; no commit/push/deploy was performed; no
secret value was printed at any point in this run.

---

## Verdict

**READY FOR BATCH 3 COMMIT AND DEPLOY**

All in-scope preflight, API-level, and UI-level checks passed (17/17 + 17/17
= 34/34), the write footprint matches the allowed set exactly (1 QA class, 1
schedule, 1 enrollment, 1 grade, PUBLISHED), and none of the pre-existing
demo/QA data — including the two grades left over from the prior blocked
attempt — was modified.
