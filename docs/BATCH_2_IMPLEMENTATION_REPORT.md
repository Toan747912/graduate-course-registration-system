# Batch 2 Implementation Report — Hồ sơ học viên mở rộng

Phạm vi: quản lý hồ sơ học viên cao học (mã học viên, họ tên, email từ Supabase Auth,
chương trình, khóa, trạng thái học tập). Local-only: **không** apply Supabase Cloud,
không db push, không seed Cloud, không commit/push/deploy.

## 1. Schema hiện có đã dùng (không sửa migration 0000–0017)

- `public.profiles` (0001): `id`, `full_name`, `role`, `student_status`, không có cột
  academic. Đây là bảng duy nhất được mở rộng — không tạo bảng `students` riêng.
- `public.programs`, `public.cohorts` (0015): dùng làm FK target cho `profiles.program_id`/`cohort_id`.
- `public.enrollments` (0005): dùng để kiểm tra "đã có lịch sử đăng ký" trong rule khóa gán lại.
- `public.is_training_staff()` (0007): tái sử dụng trong mọi RPC mới, không viết lại.
- Quy ước RPC-only cho write trên `profiles` (0007's comment: "no insert/update/delete
  policy... adjusted only via service-role seed script") được giữ nguyên: Batch 2
  **không thêm RLS UPDATE policy** cho `profiles`, chỉ thêm RPC SECURITY DEFINER.

## 2. Migration mới

### 0018_profiles_academic_extension.sql
- Thêm cột `student_code` (nullable, unique qua partial index), `program_id`,
  `cohort_id` (cả hai nullable — xem lý do lệch so với dự thảo gốc trong
  `ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md` mục C.4), `academic_status` (enum
  `STUDYING`/`SUSPENDED`/`GRADUATED`/`WITHDRAWN`, NOT NULL cho học viên).
- Backfill `academic_status` từ `student_status` cho toàn bộ học viên hiện có
  (`ACTIVE`→`STUDYING`, `INACTIVE`→`SUSPENDED`) **trước khi** thêm constraint bắt buộc.
- Check constraints: enum hợp lệ, bắt buộc có/không có theo role (giống pattern
  `profiles_student_status_required_for_students` sẵn có), `student_code`/`program_id`/
  `cohort_id` chỉ được set cho `role='STUDENT'`, cohort không thể set nếu chưa có program.
- Trigger `profiles_academic_guard` (BEFORE INSERT OR UPDATE), gộp 3 việc:
  1. Cohort phải thuộc đúng `program_id`.
  2. Chặn đổi `program_id`/`cohort_id` nếu đã từng gán (`old.program_id is not null`)
     **và** học viên đã có bất kỳ `enrollments` nào. Lần gán đầu tiên (`old.program_id
     is null`) luôn được phép, kể cả khi đã có enrollment cũ, đúng quyết định #8.
     Điểm mở rộng cho batch sau: đã ghi comment rõ chỗ cần thêm điều kiện
     `enrollment_grades`/`theses` khi các bảng đó tồn tại.
  3. Sync một chiều `academic_status` → `student_status` (không có chiều ngược).
- Re-create `handle_new_auth_user()` (giống cách 0014 re-create để đổi search_path,
  không sửa file 0001) để seed `academic_status='STUDYING'` cho user mới — bắt buộc,
  nếu không sẽ vi phạm constraint NOT NULL ngay khi có signup mới.

### 0019_rpc_student_profiles.sql
Bốn RPC SECURITY DEFINER, `search_path` khóa `pg_catalog, public`, revoke public/grant
authenticated, không mở quyền đọc `auth.users` trực tiếp cho client:
- `staff_list_students(p_program_id, p_cohort_id, p_academic_status, p_search)` — kiểm
  tra `is_training_staff()`, trả `id, student_code, full_name, email, program_id,
  cohort_id, academic_status, created_at, updated_at`.
- `staff_get_student(p_student_id)` — chi tiết 1 học viên, cùng shape.
- `staff_update_student(p_student_id, p_student_code, p_full_name, p_program_id,
  p_cohort_id, p_academic_status)` — chỉ sửa các field học thuật đã chốt; không nhận
  `role`/`student_status` từ client. Lỗi nghiệp vụ (mã trùng, cohort không thuộc
  program, assignment đã khóa, không tìm thấy học viên) trả về
  `jsonb {success:false, reason}` bằng tiếng Việt; lỗi không xác thực/không đủ quyền
  vẫn `raise exception` (chặn từ tầng route trước khi tới đây).
- `student_get_own_profile()` — chỉ trả đúng hồ sơ + email của chính người gọi
  (`p.id = auth.uid()`).

## 3. Backend

- `apps/api/src/schemas/students.ts`: Zod strict, `academicStatusEnum`,
  `listStudentsQuerySchema`, `studentIdParamsSchema`, `updateStudentSchema`.
- `apps/api/src/routes/students.ts`: mounted tại `/api`, scoped `/staff` và `/student`
  giống pattern `academic.ts`/`student.ts`. Toàn bộ route dùng
  `createUserScopedClient` (user-scoped, JWT của caller) — **không** dùng service-role
  key ở runtime.
  - `GET /staff/students` — list + filter/search.
  - `GET /staff/students/:id` — chi tiết.
  - `PATCH /staff/students/:id` — cập nhật; trả 409 `UPDATE_REJECTED` với message tiếng
    Việt khi RPC trả `success:false`.
  - `GET /student/profile` — hồ sơ của chính học viên đang đăng nhập, gồm email.
- Đăng ký router mới trong `apps/api/src/index.ts`.

## 4. Frontend

- `apps/web/src/types/api.ts`: thêm `AcademicStatus`, `StudentProfile`,
  `UpdateStudentResult`.
- Staff: `StaffStudents.tsx` (`/staff/students`, list + filter theo chương
  trình/khóa/trạng thái/tìm kiếm, loading/error/empty/ready state), `StaffStudentDetail.tsx`
  (`/staff/students/:id`, sửa mã/họ tên/gán chương trình-khóa/đổi trạng thái, load
  cohorts theo program đã chọn). Mục nav "Học viên" thêm vào `StaffNav.tsx`.
- Student: `StudentProfile.tsx` (`/student/profile`, read-only). Mục nav "Hồ sơ học
  tập" thêm vào `StudentNav.tsx`.
- `styles.css`: thêm `.detail-list` (responsive 1 cột → 2 cột ở ≥640px) cho trang hồ
  sơ học viên; tái sử dụng toàn bộ class sẵn có (`card`, `form`, `table-scroll`,
  `classes-table`, `badge-*`, `banner-error`) — không tạo hệ thống style mới.
- Không đụng route/trang của Batch 1 hay module đăng ký học phần MVP.

## 5. Rule được enforce ở đâu

| Rule | Enforce tại |
|---|---|
| Mã học viên unique | `profiles_student_code_unique` (partial unique index, DB) |
| Email chỉ ở Supabase Auth, không copy sang `profiles` | Thiết kế schema — cột `email` không tồn tại trên `profiles`; RPC join `auth.users` runtime |
| Staff đọc email an toàn | 4 RPC SECURITY DEFINER, `is_training_staff()`/`auth.uid()` check, revoke public |
| `academic_status` enum hợp lệ | CHECK constraint DB + Zod `academicStatusEnum` (API) |
| Backfill không NULL | Migration 0018 backfill trước khi thêm CHECK bắt buộc |
| Sync một chiều status | Trigger `profiles_academic_guard`, DB-level, không thể bypass qua client |
| Gán lần đầu luôn được phép | Trigger chỉ khóa khi `old.program_id is not null` |
| Khóa đổi assignment sau khi có enrollment | Trigger kiểm tra `exists (select 1 from enrollments where student_id = old.id)` |
| Cohort phải thuộc đúng program | Trigger (không thể biểu diễn bằng FK đơn thuần) |
| Student chỉ xem hồ sơ mình | `student_get_own_profile()` lọc `p.id = auth.uid()`; route `requireRole('STUDENT')` |
| Staff toàn quyền quản lý học viên | Route `requireRole('TRAINING_STAFF')` + RPC `is_training_staff()` (2 lớp, giống pattern MVP) |
| Staff không tự ghi `student_status`/`role` | `staff_update_student` không nhận 2 field này làm tham số |

## 6. Test

- `apps/api/src/schemas/students.test.ts` (mới, `node:test`): xác nhận
  `listStudentsQuerySchema` chỉ nhận `academicStatus` hợp lệ, `studentIdParamsSchema`
  yêu cầu UUID, `updateStudentSchema` yêu cầu `fullName` không rỗng, chỉ nhận 4 giá trị
  enum, cho phép `programId`/`cohortId`/`studentCode` null (học viên chưa gán).
- Chưa chạy `npm run test`/`typecheck`/`lint`/`build` tại thời điểm viết báo cáo này —
  xem mục 7 để biết kết quả thực tế sau khi chạy.

## 7. Kết quả chạy lệnh

- `npm run typecheck` (apps/api + apps/web): **PASS**, không lỗi.
- `npm run lint` (apps/api + apps/web): **PASS**, 0 lỗi. 1 warning không liên quan tới
  Batch 2 (`AuthContext.tsx`, `react-refresh/only-export-components`, đã tồn tại từ
  trước).
- `npm run test` (apps/api + apps/web): **PASS** — 17/17 test `apps/api` (11 cũ +
  6 mới trong `students.test.ts`), 12/12 test `apps/web` (không đổi). Tổng 29/29 pass.
- `npm run build` (apps/api + apps/web): **PASS**, build ra `dist/` cho cả hai
  workspace không lỗi.
- Secret scan: không có `gitleaks`/`trufflehog` cài sẵn trong môi trường; đã grep thủ
  công toàn bộ file mới/sửa trong batch này theo pattern `secret|password|api[_-]?key|
  service[_-]?role|token=|DemoStaff` — chỉ khớp các dòng mô tả nghiệp vụ ("service-role
  seed script", "không dùng service-role") trong báo cáo, không có giá trị bí mật thật
  nào bị lộ.

## 8. Phần chưa test được do không có local Supabase

Giống hạn chế đã ghi nhận ở Batch 1 (`ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md` J.5):
- Trigger `profiles_academic_guard` (cohort-program mismatch, khóa gán lại sau khi có
  enrollment, sync một chiều academic_status→student_status) — chỉ được xác minh bằng
  đọc lại SQL, chưa chạy được trên DB thật.
- Backfill migration 0018 — chưa chạy trên dữ liệu thật để xác nhận không còn học viên
  nào `academic_status IS NULL`.
- 4 RPC mới (`staff_list_students`, `staff_get_student`, `staff_update_student`,
  `student_get_own_profile`) — logic SQL bên trong (join `auth.users`, filter, jsonb
  error shape) chưa được gọi thực tế.
- RLS/permission thực tế trên `profiles` (không có policy UPDATE cho client, RPC-only)
  — chưa test bằng JWT thật của cả hai role.
- UI (`StaffStudents.tsx`, `StaffStudentDetail.tsx`, `StudentProfile.tsx`) — chưa chạy
  dev server/browser để xác nhận luồng thực tế (API backend cần Supabase để trả dữ
  liệu thật).

## 9. Cloud actions cần xác nhận riêng (không tự thực hiện)

- Áp migration 0018–0019 lên Supabase Cloud (`supabase db push` hoặc tương đương).
- Chạy backfill xác nhận trên dữ liệu Cloud thật (không phải dữ liệu demo local).
- Seed/gán `student_code`/`program_id`/`cohort_id`/`academic_status` cho các tài khoản
  demo hiện có trong `apps/api/src/scripts/seedDemoUsers.ts` nếu muốn demo Batch 2 có
  dữ liệu sẵn (script hiện tại chưa set các field này).
- Xác nhận với chủ dự án về việc mở rộng `student_code` ngoài phạm vi 3-cột trong dự
  thảo gốc — đã cập nhật tài liệu thiết kế, nhưng đây là thay đổi so với bản dự thảo
  đã có trước đó nên cần review riêng.
