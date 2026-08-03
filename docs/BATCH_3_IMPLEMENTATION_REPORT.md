# Batch 3 Implementation Report — Quản lý điểm và tiến độ học tập

Triển khai theo `docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md` (bản chốt). Chỉ thay đổi working tree local; không seed, không `supabase db push`, không commit/push/deploy.

## 1. File đã tạo/thay đổi

**Migrations (mới, 0021–0027, không sửa 0000–0020):**
- `supabase/migrations/0021_enrollment_grades.sql`
- `supabase/migrations/0022_rls_enrollment_grades.sql`
- `supabase/migrations/0023_rpc_record_and_publish_grade.sql`
- `supabase/migrations/0024_rpc_staff_list_class_grades.sql`
- `supabase/migrations/0025_rpc_student_grades_and_progress.sql`
- `supabase/migrations/0026_rpc_cancel_course_class_block_if_graded.sql`
- `supabase/migrations/0027_rpc_cancel_own_enrollment_block_if_graded.sql`

**Backend (mới):**
- `apps/api/src/schemas/grades.ts`, `apps/api/src/schemas/grades.test.ts`
- `apps/api/src/routes/grades.ts`

**Backend (sửa):**
- `apps/api/src/index.ts` — mount `gradesRouter`

**Frontend (mới):**
- `apps/web/src/pages/staff/StaffCourseClassGrades.tsx` — trang nhập/công bố điểm theo lớp
- `apps/web/src/pages/student/StudentGrades.tsx` — trang "Kết quả học tập" + "Tiến độ tín chỉ" của student

**Frontend (sửa):**
- `apps/web/src/App.tsx` — route `/staff/course-classes/:id/grades`, `/student/grades`
- `apps/web/src/components/StudentNav.tsx` — thêm mục "Kết quả học tập"
- `apps/web/src/pages/staff/StaffCourseClassDetail.tsx` — link sang trang nhập điểm; disable nút "Hủy lớp học phần" + ghi chú khi lớp đã có điểm (BUS-36 UX layer)
- `apps/web/src/pages/staff/StaffStudentDetail.tsx` — thêm section "Tiến độ tín chỉ" và "Kết quả học tập" (DRAFT+PUBLISHED)
- `apps/web/src/pages/student/StudentHistory.tsx` — disable nút "Hủy" + ghi chú khi enrollment đã có điểm PUBLISHED (xem mục 4, giới hạn đã biết)
- `apps/web/src/types/api.ts` — types mới: `ClassGradeRow`, `GradeMutationResult`, `StudentGradeRow`, `StudentProgress`, `GradeStatus`, `ResultStatus`
- `apps/web/src/styles.css` — badge PASS/FAIL/DRAFT/PUBLISHED/none, progress bar, `.note-text`

## 2. Mapping BUS-27..37 / quyết định #1–6 → implementation

| Rule | Migration/RPC | API route | UI |
|---|---|---|---|
| BUS-27/29 (final_score bắt buộc, 0–10, tạo mới) | 0021 (NOT NULL check), 0023 `staff_create_draft_grade` | `POST /staff/enrollments/:id/grade` | `StaffCourseClassGrades.tsx` — ô điểm bắt buộc trước khi "Lưu nháp" |
| BUS-28 (1–1 UNIQUE) | 0021 `enrollment_id unique`, 0023 (chặn tạo trùng) | cùng trên | — |
| BUS-30 (DRAFT sửa tự do) | 0023 `staff_update_draft_grade` | `PATCH /staff/enrollments/:id/grade` | ô điểm editable khi chưa PUBLISHED |
| BUS-31 (khóa PUBLISHED ở DB) | 0021 trigger `enrollment_grades_block_update_when_published` | — (RPC tự trả lỗi trước khi chạm trigger) | ô điểm `disabled` khi PUBLISHED |
| BUS-32 (tự tính PASS/FAIL) | 0023 `staff_publish_grade` (so `final_score` với `programs.pass_score_min`) | `POST /staff/enrollments/:id/grade/publish` | dialog xác nhận công bố |
| Quyết định #2 (student chỉ xem PUBLISHED) | 0022 RLS `enrollment_grades_select_own_published`; 0025 `student_get_own_grades` lọc `PUBLISHED` (double defense) | `GET /student/grades` | `StudentGrades.tsx` |
| Quyết định #3 (staff_get_student_progress dùng chung logic) | 0025 helper `_student_progress` dùng chung bởi `student_get_own_progress` và `staff_get_student_progress` | `GET /student/progress`, `GET /staff/students/:id/progress` | `StudentGrades.tsx`, `StaffStudentDetail.tsx` |
| BUS-33/34/35 (tiến độ tín chỉ, dedup) | 0025 helper `_student_progress`/`_student_grades_rows` (`distinct on (course_id)`) | cùng trên | cột "Ghi chú"/"đã tính tín chỉ" |
| BUS-36 (chặn hủy lớp đã có điểm) | 0026 `cancel_course_class` (thêm check `exists` enrollment_grades) | `POST /staff/course-classes/:id/cancel` (route không đổi) | nút "Hủy lớp học phần" disable + ghi chú |
| BUS-37 (chặn tự hủy enrollment đã có điểm) | 0027 `cancel_own_enrollment` (thêm check) | `POST /student/enrollments/:id/cancel` (route không đổi) | nút "Hủy" disable (chỉ khi biết PUBLISHED) + ghi chú; RPC là lớp bảo vệ chính |
| Quyết định #5 (không có khung điểm rỗng) | 0021 NOT NULL, 0023 validate trước khi insert | schema `finalScoreSchema` Zod | ô điểm bắt buộc client-side |
| Quyết định #1 (`pass_score_min` dùng trực tiếp) | 0023 `staff_publish_grade` join `programs.pass_score_min` | — | — |

## 3. Test đã chạy thực sự

Chạy tại root, cả 4 lệnh **PASS**:

```
npm run typecheck   → PASS (apps/api + apps/web, 0 lỗi)
npm run lint        → PASS (0 error, 1 warning không liên quan Batch 3 — pre-existing trong AuthContext.tsx)
npm run build        → PASS (tsc api + tsc/vite build web)
npm run test         → PASS (27/27 API test, 12/12 web test)
```

Test mới thêm: `apps/api/src/schemas/grades.test.ts` — validate `finalScoreSchema` (biên 0/10, ngoài khoảng -0.1/10.1/10.5, quá 1 chữ số thập phân, thiếu/null/không phải số), `createDraftGradeBodySchema`/`updateDraftGradeBodySchema` (bắt buộc `finalScore`), và 3 params schema (UUID bắt buộc). Đây là các test đơn vị thuần Zod, chạy thật (node:test), không cần DB/mạng.

**Phần chỉ là review tĩnh, không chạy được (không có DB thật):** toàn bộ K.1 (DB constraints: UNIQUE, FK, check ràng buộc `grade_status`/`result_status`, trigger chặn UPDATE khi PUBLISHED), K.2 (RLS/RBAC hai JWT khác nhau), K.5/K.6 (transaction test cho tiến độ tín chỉ, học lại, dedup credit, regression `cancel_course_class`/`cancel_own_enrollment`). Các migration đã được đọc kỹ, đối chiếu logic với design doc và với các RPC/RLS tương tự đã áp dụng ở Batch 1/2 (cùng convention `search_path`, `revoke/grant`, `jsonb {success, reason}`), nhưng **không có Postgres/Supabase thật để execute** theo đúng ràng buộc của nhiệm vụ này.

## 4. Giới hạn/mâu thuẫn phát hiện và quyết định đã dùng

- **J.3 (StudentHistory disable nút Hủy) vs Quyết định #2 (DRAFT không được lộ dưới bất kỳ hình thức nào):** design doc yêu cầu disable nút "Hủy" khi enrollment đã có điểm DRAFT *hoặc* PUBLISHED, nhưng RPC `student_get_own_grades` (theo đúng quyết định #2, tuyệt đối) chỉ trả về PUBLISHED — không có API nào lộ sự tồn tại của một dòng DRAFT cho student. Vì vậy `StudentHistory.tsx` chỉ disable nút "Hủy" cho các enrollment có điểm **PUBLISHED** (đã hiển thị công khai ở trang Kết quả học tập nên không phải thông tin mới). Với enrollment có điểm **DRAFT**, nút vẫn hiển thị enabled ở UI, nhưng nếu học viên bấm "Hủy", RPC `cancel_own_enrollment` (migration 0027, BUS-37) vẫn từ chối đúng như thiết kế — vì RPC là lớp bảo vệ chính, UI chỉ là lớp hỗ trợ (design doc J.3 tự nói rõ điều này). Đây là cách duy nhất để tuân thủ đồng thời cả quyết định #2 (tuyệt đối, không thỏa hiệp) và BUS-37 (thực thi ở DB/RPC), chấp nhận một khoảng UX nhỏ hơn thiết kế mô tả.
- **Endpoint `POST /student/enrollments/:id/cancel` trả 200 (không phải 400) khi bị RPC từ chối:** giữ nguyên convention đã có từ MVP (route hiện tại luôn `sendSuccess(res, data)` với `data.success` có thể `false` kèm `reason` tiếng Việt, ví dụ nhánh "Đăng ký không ở trạng thái có thể hủy" đã tồn tại từ trước). Design doc K.3 mô tả "400 + reason", nhưng đổi sang 400 sẽ phá vỡ tính nhất quán với các nhánh lỗi nghiệp vụ khác cùng RPC (đã 200 từ MVP). Đã ưu tiên nhất quán với Batch 1/2 thay vì đổi HTTP status code của một route hiện có — không phải 500 (đáp ứng yêu cầu cốt lõi của K.3), chỉ khác mã 200 vs 400.
- `GET /staff/students/:id/progress` và `GET /student/progress` trả `null` khi RPC không có dòng nào (trường hợp lý thuyết); UI đã xử lý `program_id === null` như empty state đúng theo J.4.

## 5. Xác nhận phạm vi

- Không chạy `supabase db push`, `migration repair`, `psql`, seed, hay bất kỳ ghi dữ liệu Cloud nào.
- Không commit, không push, không deploy — chỉ thay đổi working tree local (xác nhận qua `git status`).
- Không sửa migration 0000–0020.
- Đã quét diff tìm secret/token/DB URL — không phát hiện gì.

## Verdict (bản gốc, trước live test)

**READY FOR BATCH 3 TRANSACTION TEST**

Toàn bộ migration/RPC/RLS/API/UI đã triển khai đúng theo design doc, đối chiếu convention Batch 1/2. 4 lệnh `typecheck`/`lint`/`build`/`test` đều pass. Phần DB thật (constraints, RLS hai JWT, transaction, regression `cancel_*`) chưa được thực thi vì không có Postgres/Supabase Cloud khả dụng trong phạm vi cho phép — cần một phiên test giao dịch riêng (DB thật, không phải Cloud production) trước khi coi là xong hoàn toàn.

---

## Bổ sung — Fix P0 phát hiện bởi live transaction test (2026-08-03)

Live transaction test trên Supabase Cloud (2026-08-02, chi tiết `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` mục 8) phát hiện 1 lỗ hổng **P0**: hai hàm helper nội bộ `public._student_grades_rows(uuid)` và `public._student_progress(uuid)` (khai báo trong `0025_rpc_student_grades_and_progress.sql`) có thể được gọi trực tiếp bởi role `anon` chưa xác thực, với `p_student_id` tuỳ ý, trả về toàn bộ lịch sử điểm (bao gồm `DRAFT`) và tiến độ tín chỉ của bất kỳ sinh viên nào.

**Nguyên nhân gốc:** trên project Supabase này, `ALTER DEFAULT PRIVILEGES` cấp `EXECUTE` trực tiếp cho `anon`/`authenticated` tại thời điểm hàm được tạo, không thông qua pseudo-role `PUBLIC`. Do đó `revoke all on function ... from public` (convention Batch 1/2/3 cũ) **không thu hồi** quyền đã cấp trực tiếp cho `anon`/`authenticated`. Mọi RPC public-facing khác (0009–0027) vẫn an toàn trên thực tế chỉ vì mỗi hàm tự kiểm tra `auth.uid() is null`/`is_training_staff()` bên trong thân hàm — một lớp phòng thủ độc lập với GRANT. Hai helper `_student_grades_rows`/`_student_progress` là 2 hàm duy nhất trong Batch 3 **không có bất kỳ kiểm tra quyền nào bên trong thân hàm**, và dựa hoàn toàn vào "không được GRANT" làm cơ chế bảo vệ duy nhất — cơ chế đó đã bị chứng minh không có tác dụng trên project này.

**Fix đã áp dụng (sửa trực tiếp `0025_rpc_student_grades_and_progress.sql`, không tạo migration mới vì 0025 chưa apply Cloud):**
- Thêm `revoke all on function public._student_grades_rows(uuid) from anon;` và `... from authenticated;` (bên cạnh `from public` đã có).
- Thêm tương tự cho `public._student_progress(uuid)`.
- Không thêm `grant execute ... to anon/authenticated` nào cho 2 helper này — chúng chỉ được gọi nội bộ (qua `SECURITY DEFINER`) từ các RPC public đã có GRANT đúng (`student_get_own_grades`, `staff_get_student_grades`, `student_get_own_progress`, `staff_get_student_progress`).
- Rà soát toàn bộ 0021–0027: không có helper/hàm phụ nào khác thiếu auth guard hoặc thiếu revoke tương tự — 10 RPC public-facing còn lại (`staff_create_draft_grade`, `staff_update_draft_grade`, `staff_publish_grade`, `staff_list_class_grades`, `student_get_own_grades`, `staff_get_student_grades`, `student_get_own_progress`, `staff_get_student_progress`, `cancel_course_class`, `cancel_own_enrollment`) đều tự kiểm tra `auth.uid()`/`is_training_staff()`/ownership bên trong thân hàm, nên an toàn bất kể GRANT/default privileges của project.
- Không đổi logic filter PUBLISHED/DRAFT ở các RPC top-level — `student_get_own_grades`/`student_get_own_progress` vốn đã lọc đúng tại RPC (không dựa vào UI), giữ nguyên.

**Test tĩnh bổ sung:** `apps/api/src/scripts/batch3GrantAcl.test.ts` — parse text 2 file migration liên quan, assert 2 helper nội bộ có đủ 3 dòng `revoke ... from public/anon/authenticated` và không có `grant execute` nào; assert 10 RPC public-facing có `revoke ... from public` + `grant execute ... to authenticated` và không có `grant ... to anon`. 29/29 test (`npm test` ở `apps/api`) pass sau fix.

**Chưa làm trong lượt này (đúng ràng buộc "chỉ sửa local"):** không apply lại lên Supabase Cloud, không re-run transaction test thật. Xem `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` để biết trạng thái verdict cập nhật.

---

## Bổ sung 2 — Fix P3 phát hiện sau retest ACL (2026-08-03): anon EXECUTE trên 10 RPC public-facing

Retest ACL sau lượt fix P0 ở trên phát hiện **P3**: cả 10 RPC public-facing của Batch 3 có `anon=true` trong ACL thực tế trên Supabase Cloud (cùng nguyên nhân gốc default privileges đã mô tả ở Bổ sung 1 — `ALTER DEFAULT PRIVILEGES` cấp `EXECUTE` trực tiếp cho `anon` ngoài pseudo-role `PUBLIC`, nên `revoke ... from public` không thu hồi được). Khác với P0 (2 helper không có auth check nào), cả 10 RPC này **đều** tự kiểm tra `auth.uid() is null`/`is_training_staff()`/ownership ngay đầu thân hàm, nên `anon` gọi được vào thân hàm nhưng luôn bị chặn ở nhánh `raise exception 'not authenticated'` trước khi chạm dữ liệu — không có đường lấy dữ liệu thật. Xếp P3 (defense-in-depth thiếu, không phải lỗ hổng khai thác được), nhưng vẫn cần vá để ACL phản ánh đúng chủ định "chỉ authenticated mới gọi được".

**Fix đã áp dụng (sửa trực tiếp `0023`/`0024`/`0025`/`0026`/`0027`, không tạo migration mới vì cả 5 file đều chưa apply Cloud):**
- Thêm `revoke all on function <signature> from anon;` tường minh ngay sau `revoke ... from public;` sẵn có, cho cả 10 RPC: `staff_create_draft_grade(uuid, numeric)`, `staff_update_draft_grade(uuid, numeric)`, `staff_publish_grade(uuid)` (`0023`); `staff_list_class_grades(uuid)` (`0024`); `student_get_own_grades()`, `staff_get_student_grades(uuid)`, `student_get_own_progress()`, `staff_get_student_progress(uuid)` (`0025`); `cancel_course_class(uuid, text)` (`0026`); `cancel_own_enrollment(uuid, text)` (`0027`).
- Không đổi `grant execute ... to authenticated;` — vẫn là GRANT duy nhất, không grant cho `public`/`anon`/`service_role`.
- Không đổi business logic/self-check `auth.uid()`/`is_training_staff()`/ownership trong body của bất kỳ hàm nào — các check này vẫn giữ nguyên làm lớp phòng thủ độc lập với ACL, đúng defense-in-depth.
- 2 helper nội bộ `_student_grades_rows`/`_student_progress` (vá ở Bổ sung 1) không đổi thêm — vẫn revoke cả public/anon/authenticated, không grant cho ai.
- Rà soát lại toàn bộ 0021–0027: mỗi tên hàm Batch 3 chỉ có đúng 1 signature (không có overload), không sót hàm public nào thiếu revoke `anon`.

**Test tĩnh cập nhật:** `apps/api/src/scripts/batch3GrantAcl.test.ts` — test `'Batch 3 top-level RPCs revoke from public+anon and grant execute only to authenticated'` giờ assert theo exact signature cho từng RPC trong 10 RPC: có `revoke ... from public;`, có `revoke ... from anon;` tường minh, không có `grant ... to anon`, có đúng `grant execute ... to authenticated;`, không có `grant ... to service_role`, và một regex khối liên tục xác nhận thứ tự revoke(public)→revoke(anon)→grant(authenticated) cho cùng một signature (chống match nhầm sang hàm khác trùng tên một phần). Test 2 helper nội bộ giữ nguyên. `npm run typecheck`/`lint`/`build`/`test` ở workspace root đều pass (29/29 test `apps/api`, 12/12 test `apps/web`) sau fix.

**Chưa làm trong lượt này:** không apply lên Supabase Cloud, không chạy lại transaction test/`has_function_privilege` thật — P3 này chỉ **FIXED LOCALLY**, cần **ACL RETEST** sau khi 0021–0027 được `db push` lên Cloud để xác nhận `anon` không còn `EXECUTE` trên cả 10 RPC. Xem addendum tương ứng trong `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md`.
