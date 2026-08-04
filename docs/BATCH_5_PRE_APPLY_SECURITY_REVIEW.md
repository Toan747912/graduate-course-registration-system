# Batch 5 Pre-Apply Security & Data-Integrity Review — Xét tốt nghiệp và Dashboard báo cáo

**Ngày:** 2026-08-04
**Phạm vi:** static review (chỉ đọc) toàn bộ Batch 5 — `docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md`, `docs/BATCH_5_IMPLEMENTATION_REPORT.md`, migration `supabase/migrations/0039`–`0048`, `apps/api/src/routes/graduation.ts`, `apps/api/src/schemas/graduation.ts`, `apps/api/src/lib/csv.ts`, `apps/api/src/middleware/errorHandler.ts`, `apps/api/src/middleware/requireRole.ts`, UI (`apps/web/src/pages/student/StudentGraduation.tsx`, `apps/web/src/pages/staff/StaffGraduationDashboard.tsx`, `apps/web/src/pages/staff/StaffStudentDetail.tsx`), cùng context nền 0018, 0021–0038, và `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md`.

**Tuyên bố quan trọng:** đây là **STATIC REVIEW** — đọc source code/migration/SQL và suy luận logic, **CHƯA chạy** bất kỳ DB/RLS/concurrency test thật nào (không Cloud CLI, không psql, không BEGIN/ROLLBACK thật). Mọi kết luận "PASS" dưới đây là kết luận dựa trên đọc mã nguồn, không phải bằng chứng runtime — cần chạy Test Plan ở mục 7 trên môi trường không phải production trước khi coi Batch 5 là đã được chứng minh an toàn.

---

## 1. Migration/dependency — **PASS**

- 0039–0048 tuần tự đúng, mỗi file một mối quan tâm, khớp bảng migration plan mục I của design doc. Không có gap số hiệu.
- Xác nhận qua `Glob`/liệt kê thư mục: không có migration nào ngoài 0039–0048 mới, 0000–0038 không bị sửa nội dung (báo cáo implementation tự xác nhận, review đọc lại 0018/0025/0030/0035/0037 khớp với những gì 0039/0047 tham chiếu).
- `theses.completed_at` **đã tồn tại từ 0030** (`supabase/migrations/0030_theses.sql:38`), không phải cột mới như design doc giả định — 0039 chỉ re-create `staff_complete_thesis` để thêm guard `where completed_at is null` (`0039_thesis_completed_at_immutable.sql:48-52`). Đã verify: 0037 (`0037_rpc_thesis_advisor_assignment_lifecycle.sql:206`) set `completed_at = now()` khi transition COMPLETED — không cần backfill vì cột đã có sẵn từ Batch 4, không có rủi ro NOT NULL-chưa-backfill (cột này vẫn nullable, đúng thiết kế).
- `graduation_records` (`0040_graduation_records.sql:8-28`): quan hệ 1:1 đúng qua `UNIQUE (student_id)` (dòng 27), FK tới `profiles/programs/cohorts/theses` không `ON DELETE CASCADE` (giữ lịch sử), đủ snapshot field theo D.1 (điểm, chương trình, khóa, luận văn, người xác nhận, thời điểm). Index `idx_graduation_records_program_id`, `idx_graduation_records_confirmed_at` có (dòng 34-35); `student_id` đã có index ngầm qua UNIQUE.
- **Bất biến ở tầng thiết kế, không phải trigger DB tường minh**: không có `BEFORE UPDATE`/`BEFORE DELETE` trigger nào trên `graduation_records`. Bất biến dựa vào **kết hợp 2 lớp**: (a) RLS chỉ có policy SELECT (`0041_rls_graduation_records.sql:11-24`, không có INSERT/UPDATE/DELETE policy nào ⇒ deny-by-default cho `authenticated`), (b) không có RPC nào trong toàn bộ codebase thực hiện UPDATE/DELETE trên bảng này (đã grep xác nhận). Đây là pattern **yếu hơn** Batch 3's `enrollment_grades` (nơi có thêm trigger `BEFORE UPDATE` độc lập với RLS — xem `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` mục 2(b)) — không có lớp phòng thủ độc lập với RLS/GRANT cho UPDATE/DELETE trên `graduation_records`. Ghi nhận **P2** (xem Findings #3) — tương tự P2 đã ghi nhận ở Batch 3 cho DELETE trên `enrollment_grades`, nhưng ở đây thiếu cả layer trigger cho UPDATE lẫn DELETE, không chỉ DELETE.
- Không có DROP/TRUNCATE nguy hiểm nào trong 0039–0048.

---

## 2. Eligibility/atomicity — **PASS** (với 1 lưu ý P1 ở ngoài phạm vi 0039–0048, xem Findings #1)

- Một nguồn logic duy nhất: `_compute_graduation_eligibility` (`0042_helper_compute_graduation_eligibility.sql:12-127`) được gọi bởi cả 0043, 0044, 0045, và `_graduation_filtered_rows` (0046) — không có bản sao logic thứ hai (khớp BUS-67/69).
- Gọi lại đúng `_student_progress` (Batch 3) verbatim (`0042:66`: `select * into v_progress from public._student_progress(p_student_id);`) — không định nghĩa lại công thức tiến độ.
- Chọn thesis khi có nhiều COMPLETED: `order by completed_at desc nulls last, created_at desc limit 1` (`0042:99-103`) — đúng BUS-80, deterministic.
- `staff_confirm_graduation` (`0045_rpc_staff_confirm_graduation.sql`):
  - Lock đúng: `select * into v_profile from public.profiles where id = p_student_id for update;` (dòng 32) trước khi kiểm tra tồn tại `graduation_records`.
  - Kiểm tra `already_graduated` trước (dòng 38-41), rồi mới `_compute_graduation_eligibility` **trong cùng transaction sau khi đã lock** (dòng 46) — đúng chống TOCTOU/BUS-69.
  - Validate đầy đủ snapshot field trước INSERT (dòng 58-61) — không tạo record thiếu field một phần; nếu `raise exception` thì toàn bộ transaction rollback (Postgres function body = 1 transaction).
  - Race 2 staff confirm đồng thời: do dùng `FOR UPDATE` trên đúng 1 dòng `profiles`, request thứ hai phải chờ request thứ nhất commit/rollback rồi mới đọc lại — về mặt logic đọc source, loại được race tạo 2 `graduation_records` (được `UNIQUE(student_id)` bảo vệ thêm ở tầng constraint nếu logic ứng dụng có sai sót). **Chưa verify runtime** (xem test plan #3).
  - Snapshot bất biến sau khi config chương trình đổi: `graduation_records` lưu giá trị cột trực tiếp (không FK-recompute), `programs.required_credits_min` có thể đổi sau nhưng record cũ giữ nguyên — đúng D.2/D.3, xác nhận qua đọc schema (không có trigger nào re-sync record cũ theo `programs` sau này).
- **BUS-65 nhất quán 3 nơi** (student status, staff detail, confirm): cả 3 đều gọi `_compute_graduation_eligibility` — không có công thức thứ hai bị lệch.

---

## 3. `completed_at` lifecycle — **PASS**

- Chỉ set tại `staff_complete_thesis` (0039, re-created), điều kiện `where completed_at is null` (`0039:48-52`) — idempotent, không ghi đè.
- Không tìm thấy RPC nào khác UPDATE cột này (đã grep `completed_at` toàn bộ `supabase/migrations/*.sql`: chỉ xuất hiện ở 0030 (định nghĩa cột), 0037 (bản gốc, bị 0039 thay thế), 0039, 0040/0042/0045/0046 (đọc/snapshot, không ghi)).
- Không dùng `updated_at` — xác nhận `0042:124` lấy `v_thesis.completed_at`, không phải `v_thesis.updated_at`.
- Backfill: không cần vì cột đã tồn tại từ 0030, không có migration nào đổi `NOT NULL` trên `theses.completed_at` (vẫn nullable) — không có rủi ro apply-fail.

**P2 update (2026-08-04) — FIXED LOCALLY — FULL RETRANSACTION TEST REQUIRED**: đã thêm DB-level trigger backstop
`public.theses_completed_at_guard` trong `0039_thesis_completed_at_immutable.sql`, đặt sau một câu `update ... where status = 'COMPLETED' and completed_at is null` backfill (chạy trước khi trigger tồn tại nên không tự chặn chính nó). Trigger `before insert or update on public.theses` chặn mọi write raw SQL/service-role vào `completed_at` ngoài đúng transition `IN_PROGRESS -> COMPLETED` do `staff_complete_thesis` thực hiện; một khi đã set thì bất biến; status khác `COMPLETED` bắt buộc `completed_at is null`. Không grant execute cho anon/authenticated/public. Xác minh tĩnh qua `apps/api/src/scripts/batch5CompletedAtGuard.test.ts` (118/118 API static test pass). Migration **chưa được apply lên Supabase Cloud** và chưa chạy full transaction test — mục 7.2/C2 dưới đây (được đánh dấu "CONFIRMED GAP" từ lần test trước) cần được chạy lại toàn bộ trên môi trường thật trước khi coi P2 là resolved.

---

## 4. RLS/RBAC/ACL — **PASS mạnh, đã tránh đúng lỗi Batch 3**

**Bài học Batch 3 (trích `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` mục 8.2):** helper nội bộ `_student_progress`/`_student_grades_rows` (migration 0025) chỉ có `revoke all on function ... from public;` mà **không** `grant ... to authenticated`, dựa vào giả định "không GRANT thì không ai gọi được". Test runtime thật đã phát hiện **P0**: dự án Supabase có `ALTER DEFAULT PRIVILEGES` cấp `EXECUTE` **trực tiếp** cho `anon`/`authenticated` tại thời điểm hàm được tạo — không qua `PUBLIC` — nên `revoke ... from public` không thu hồi được, và `set local role anon` (không JWT) gọi thẳng được `_student_progress('<uuid bất kỳ>')`, lộ toàn bộ tiến độ/điểm DRAFT của bất kỳ sinh viên nào.

**Batch 5 đã tránh đúng lỗi này**: cả 2 helper nội bộ đều revoke tường minh khỏi **cả `anon` LẪN `authenticated`**, không chỉ `public`:
- `_compute_graduation_eligibility`: `revoke all ... from public; revoke all ... from anon; revoke all ... from authenticated;` (`0042_helper_compute_graduation_eligibility.sql:133-135`).
- `_graduation_filtered_rows`: `revoke all on function public._graduation_filtered_rows(uuid, uuid, text, text) from public, anon, authenticated;` (`0046_rpc_staff_graduation_summary_and_list.sql:81`).
- `0048_rpc_revoke_anon_batch5.sql:33-35` tái khẳng định cả 2 helper revoke khỏi `public, anon, authenticated` — đây chính là điểm khác biệt cốt lõi so với lỗi Batch 3 (nơi helper chỉ revoke `from public`, không revoke tường minh khỏi `anon`/`authenticated`).

Đây là **PASS có bằng chứng cụ thể** — không chỉ là "giống pattern cũ" mà là sửa đúng lỗ hổng đã tìm thấy ở Batch 3. Tuy nhiên: **đây vẫn chỉ là static review** — kết luận "revoke tường minh khỏi anon/authenticated đủ để chặn default-privilege leak" **chưa được verify bằng runtime** trên chính project Supabase này (Batch 3 P0 chỉ lộ ra khi chạy transaction test thật với `set local role anon`); nếu default privilege ở schema này cấp lại quyền theo cách khác (ví dụ ai đó chạy lại `ALTER DEFAULT PRIVILEGES` sau khi các migration này apply), revoke tường minh vẫn đúng vì nó revoke sau cùng trong cùng migration — nhưng khuyến nghị mạnh: chạy lại đúng test RBAC-11 kiểu Batch 3 (`set local role anon; select * from public._compute_graduation_eligibility('<uuid>')`) trong test plan thật trước khi tin tưởng hoàn toàn (đã đưa vào mục 7 bên dưới).

Các RPC public-facing khác: mỗi RPC 0039/0043-0047 đều có `revoke all on function ... from public, anon;` theo sau `grant execute ... to authenticated;` — đúng convention 0020/0038, và 0048 tái khẳng định toàn bộ.

- **RLS**: `graduation_records_select_staff` (`0041:11-15`, `is_training_staff()`), `graduation_records_select_own` (`0041:17-21`, `student_id = auth.uid()`) — student chỉ SELECT được dòng của chính mình, không có cách nào đọc chéo (đúng BUS-76).
- **Role check trong RPC**: mọi RPC staff-only (`0044:18`, `0045:25`, `0046:45,105,156`) đều `if not public.is_training_staff() then raise exception`; RPC student-scoped (`0043`) dùng `auth.uid()` trực tiếp, không có tham số student_id có thể bị inject để đọc người khác.
- Không có policy `using (true)` trần trụi nào trên `graduation_records`.

**Kết luận nhóm 4: PASS**, ghi nhận khuyến nghị verify runtime (không phải blocker).

---

## 5. CSV export — **PASS**, 1 lưu ý P3

- **Cùng filter semantics với list**: `export.csv` (`apps/api/src/routes/graduation.ts:159-229`) parse cùng `graduationFilterQuerySchema`, gọi cùng RPC `staff_list_graduation_status` — không có endpoint export riêng biệt nào tính khác.
- **Chỉ staff**: route mount dưới `graduationRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'))` (`graduation.ts:23`).
- **CSV escaping RFC 4180 đúng**: `escapeCsvField` (`apps/api/src/lib/csv.ts:16-25`) quote khi có `,`/`"`/`\n`/`\r`, double embedded `"` → `""`.
- **BOM + CRLF**: `buildGraduationCsv` (`csv.ts:63-83`) prefix `﻿`, join bằng `\r\n`.
- **Content-Type/Content-Disposition an toàn**: `text/csv; charset=utf-8`, filename **cố định** `"graduation-export.csv"` (`graduation.ts:223-224`) — không có dữ liệu từ request/DB nào được nội suy vào header ⇒ không có đường header injection qua filename.
- **Formula injection**: field bắt đầu `=`, `+`, `-`, `@` được prefix `'` **trước khi** áp dụng quoting (`csv.ts:16-20`, comment dòng 13-14 xác nhận thứ tự) — đúng yêu cầu, và unit test `csv.test.ts` cover case này theo implementation report.
- **Không vượt quyền staff**: dữ liệu CSV đi qua đúng RPC `staff_list_graduation_status` có role check nội bộ.
- **Lưu ý P3 (không phải bug bảo mật)**: export gọi lặp `staff_list_graduation_status` theo trang 100 dòng/lần cho tới khi đủ `total` (`graduation.ts:196-219`) thay vì 1 lệnh không giới hạn — nếu có UPDATE/INSERT profile xen giữa các lần gọi (staff khác đang thao tác đồng thời), tập kết quả CSV có thể không hoàn toàn nhất quán tại một thời điểm duy nhất (không phải snapshot transaction) — rủi ro thấp, dữ liệu vẫn thuộc đúng phạm vi quyền staff, không lộ dữ liệu sai người.

---

## 6. API/error safety — **PASS**

- **Zod pagination**: `graduationListQuerySchema` (`apps/api/src/schemas/graduation.ts:24-32`) `page_size` `.max(100)` — từ chối (throw ZodError) chứ không âm thầm cắt, khớp BUS-81. RPC tầng DB cũng tự `raise exception` nếu `p_page_size > 100` (`0046:164-166`) — **2 lớp**, đúng defense-in-depth.
- **Không leak raw Postgres error**: mọi route Batch 5 dùng hằng số `GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại sau.'` khi `error` từ RPC call (`graduation.ts:33,44,78,110,127,142,187,210`) — **đã sửa đúng P3 mà Batch 3 ghi nhận** (`docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` mục 6: `error.message` bị truyền thẳng ra client ở `grades.ts`). Route comment tại `graduation.ts:30-33` trích dẫn rõ ràng lý do. `errorHandler.ts:22-27` (fallback toàn cục) cũng che message ở `NODE_ENV=production`.
- Không dùng service role key client-side: mọi route dùng `createUserScopedClient(req.authUser!.accessToken)` (`graduation.ts` — 8 lần).
- Không hardcode secret (đã tự grep theo implementation report mục 6, review không phát hiện thêm).
- **6 endpoint Batch 5 và auth+role check**:

| Endpoint | RPC | Auth/Role |
|---|---|---|
| `GET /api/student/graduation` | `student_get_own_graduation_status` | `requireAuth + requireRole('STUDENT')` (router-level, `graduation.ts:24`) |
| `GET /api/staff/graduation/summary` | `staff_get_graduation_summary` | `requireAuth + requireRole('TRAINING_STAFF')` (`graduation.ts:23`) + RPC-nội-bộ `is_training_staff()` |
| `GET /api/staff/graduation/students` | `staff_list_graduation_status` | như trên |
| `GET /api/staff/graduation/students/:studentId` | `staff_get_student_graduation_status` | như trên |
| `POST /api/staff/graduation/students/:studentId/confirm` | `staff_confirm_graduation` | như trên |
| `GET /api/staff/graduation/export.csv` | `staff_list_graduation_status` (lặp trang) | như trên |

Mỗi endpoint có **2 lớp role check** (Express middleware + RPC nội bộ `is_training_staff()`/`auth.uid()`), khớp nguyên tắc "RLS/role check không chỉ ở 1 tầng" đã dùng xuyên suốt hệ thống.

---

## 7. Test plan trước khi apply (KHÔNG chạy trong review này — chỉ liệt kê)

### 7.1 Baseline preflight (đọc, không ghi)
```sql
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='graduation_records' order by ordinal_position;

select conname, contype, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.graduation_records'::regclass;

select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy
where polrelid = 'public.graduation_records'::regclass;

-- Xác nhận không có trigger UPDATE/DELETE nào (đúng dự đoán ở mục 1 — chỉ có RLS+absence-of-RPC)
select tgname from pg_trigger where tgrelid = 'public.graduation_records'::regclass and not tgisinternal;

-- ACL toàn bộ RPC + 2 helper (kể cả anon/authenticated trực tiếp, không chỉ public)
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE')
from pg_proc p cross join (values ('public'),('authenticated'),('anon'),('service_role')) as x(rolname)
join pg_roles r on r.rolname = x.rolname
where p.pronamespace='public'::regnamespace
  and p.proname in ('staff_complete_thesis','student_get_own_graduation_status',
    'staff_get_student_graduation_status','staff_confirm_graduation',
    'staff_get_graduation_summary','staff_list_graduation_status',
    'student_create_thesis_proposal','_compute_graduation_eligibility',
    '_graduation_filtered_rows');
```

### 7.2 `completed_at` behavior
- Complete 1 thesis IN_PROGRESS→COMPLETED, xác nhận `completed_at` set đúng 1 lần; gọi lại `staff_complete_thesis` trên cùng thesis (đã COMPLETED) → `success:false`, `completed_at` không đổi.

### 7.3 Eligible/missing-each-condition (test riêng từng thiếu 1 điều kiện)
- Thiếu required credits; thiếu elective credits; không có thesis COMPLETED; có thesis active (từng trạng thái PENDING_APPROVAL/APPROVED/IN_PROGRESS); `academic_status` khác STUDYING; đủ tất cả → ELIGIBLE; tổ hợp thiếu nhiều điều kiện → `reasons` chứa đủ.

### 7.4 Confirm + snapshot correctness + double-confirm concurrency
- Confirm 1 lần thành công → `graduation_records` đủ field, `academic_status`→GRADUATED, `student_status`→INACTIVE (qua trigger 0018).
- Confirm lần 2 cùng student → `already_graduated`, không tạo dòng thứ 2.
- 2 request đồng thời (cùng thời điểm, `pg_sleep` mô phỏng hoặc 2 session song song) cho cùng student → chỉ 1 thành công, còn lại `already_graduated` hoặc chờ lock rồi nhận cùng kết quả — không deadlock, không tạo 2 dòng (verify bằng `count(*) where student_id=...` = 1).
- Sửa `programs.required_credits_min` sau confirm → đọc lại `graduation_records` cũ, xác nhận không đổi.

### 7.5 Student isolation + staff export
- Student A SELECT `graduation_records`/gọi `student_get_own_graduation_status` chỉ thấy của mình; set role `anon` (không JWT) gọi `student_get_own_graduation_status()` → raise exception (not authenticated).
- **Lặp lại đúng test RBAC-11 của Batch 3** (mục 4 ở trên): `set local role anon;` (không set JWT claim) rồi gọi trực tiếp `select * from public._compute_graduation_eligibility('<uuid bất kỳ>')` và `select * from public._graduation_filtered_rows(null,null,null,null)` → kỳ vọng **exception do thiếu EXECUTE privilege** (khác với Batch 3 nơi test này từng silently trả dữ liệu thật) — đây là test **bắt buộc**, không phải tùy chọn, vì đây chính là lớp phòng thủ mà Batch 5 tuyên bố đã sửa so với Batch 3.
- Staff export CSV với các filter khác nhau → verify chỉ TRAINING_STAFF gọi được; STUDENT/anon gọi `.../export.csv` → 401/403.

### 7.6 CSV formula injection value test
- Tạo 1 student có `full_name` (hoặc field khác đi vào CSV) bắt đầu bằng `=cmd|'/c calc'!A1`, `+1+1`, `-2+3`, `@SUM(A1:A2)` → mở file CSV output, xác nhận các field này có prefix `'` và không bị Excel/Sheets diễn giải thành công thức.

### 7.7 Regression: graduated student's registration/proposal flow
- Confirm graduation cho 1 student → gọi RPC đăng ký học phần hiện có (0008, không sửa) → từ chối, lý do `student_status != 'ACTIVE'` (không phải lỗi khác) — xác nhận đúng chain BUS-70→trigger 0018→RPC đăng ký (test #5 của design doc K, chưa từng chạy runtime theo implementation report §6).
- Gọi `student_create_thesis_proposal` cho student đã GRADUATED → từ chối do check `academic_status = 'STUDYING'` (0047).
- **Bổ sung bắt buộc (phát hiện mới ở review này, xem Finding #1)**: verify `staff_update_student` (0019, không sửa bởi Batch 5) khi được gọi với `p_academic_status` khác giá trị hiện tại trên một student đã có `graduation_records` — xác nhận hành vi thực tế (có set lại `academic_status` được không, có tạo ra trạng thái `academic_status='STUDYING'` với `graduation_records` vẫn tồn tại hay không) trước khi coi BUS-71 là "đã enforce" trên toàn hệ thống.

### 7.8 Post-rollback cleanup verification
```sql
select count(*) from public.graduation_records where student_id in (...); -- kỳ vọng 0 sau ROLLBACK
select academic_status, student_status from public.profiles where id in (...); -- kỳ vọng về đúng giá trị trước test
select version from supabase_migrations.schema_migrations order by version desc limit 10; -- 0039-0048 không xuất hiện nếu preflight chạy trước apply thật
```

**Ghi rõ: toàn bộ mục 7 KHÔNG được thực thi trong lượt review này — chỉ liệt kê kế hoạch.**

---

## Danh sách Findings

| # | Severity | Mô tả | Evidence | Đề xuất fix (không tự sửa code) |
|---|---|---|---|---|
| 1 | **P1** | RPC `staff_update_student` (Batch 2, migration 0019, **không được Batch 5 sửa hay revoke lại**) cho phép TRAINING_STAFF set `p_academic_status` trực tiếp thành bất kỳ giá trị nào trong `('STUDYING','SUSPENDED','GRADUATED','WITHDRAWN')` — bao gồm: (a) set `GRADUATED` **hoàn toàn bỏ qua** `_compute_graduation_eligibility`/`staff_confirm_graduation`, không tạo `graduation_records` nào, phá vỡ bất biến "GRADUATED ⟺ có graduation_records" mà `student_get_own_graduation_status`/dashboard dựa vào; (b) **revert một student đã GRADUATED về STUDYING/bất kỳ trạng thái nào khác**, vi phạm trực tiếp BUS-71 ("Không có RPC hoặc thao tác UI nào được phép chuyển academic_status từ GRADUATED về trạng thái khác"). Đường khai thác là UI thật đang tồn tại, không chỉ RPC gọi tay: `StaffStudentDetail.tsx` có `<select>` "Trạng thái học tập" liệt kê đủ 4 giá trị, submit qua `staff_update_student`. | `supabase/migrations/0019_rpc_student_profiles.sql:132-207` (đặc biệt dòng 160-183: không có check nào so `p_academic_status` với giá trị hiện tại hay với sự tồn tại của `graduation_records`); `apps/web/src/pages/staff/StaffStudentDetail.tsx:216-227` (`<select>` đủ 4 option, không disable option nào dựa trên đã có `graduation_records`) | Batch 5 (hoặc 1 migration bổ sung) nên sửa `staff_update_student` để: (i) chặn set `academic_status='GRADUATED'` qua RPC này (chỉ `staff_confirm_graduation` được set giá trị này), và/hoặc (ii) chặn UPDATE khi `academic_status` hiện tại đã là `'GRADUATED'` (raise business error "không thể sửa trạng thái học tập của học viên đã tốt nghiệp"), tương tự cách 0047 thêm check `academic_status='STUDYING'` vào `student_create_thesis_proposal`. UI `StaffStudentDetail.tsx` nên disable/loại bỏ option `GRADUATED` khỏi `<select>` và disable toàn bộ form khi student đã có graduation record. |
| 2 | P2 | `graduation_records` không có trigger `BEFORE UPDATE`/`BEFORE DELETE` độc lập ở tầng DB — bất biến hoàn toàn dựa vào (a) RLS không có policy ghi, (b) không RPC nào viết UPDATE/DELETE. Yếu hơn pattern Batch 3 áp dụng cho `enrollment_grades` (có thêm trigger `BEFORE UPDATE` độc lập với RLS/GRANT, xem `docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` mục 2(b)) — nếu bất kỳ code nào trong tương lai dùng `service_role` (bypass RLS hoàn toàn) để UPDATE/DELETE trực tiếp trên `graduation_records`, không có gì chặn ở tầng DB. | `supabase/migrations/0040_graduation_records.sql` (không có `create trigger`); `supabase/migrations/0041_rls_graduation_records.sql:23-24` (comment tự nhận "no INSERT/UPDATE/DELETE policy... only staff_confirm_graduation may write") | Cân nhắc thêm trigger `BEFORE UPDATE OR DELETE` trên `graduation_records` raise exception vô điều kiện (tương tự `enrollment_grades_block_update_when_published` ở 0021), làm lớp phòng thủ độc lập với RLS/service_role — nhất quán với khuyến nghị P2 đã đưa ra ở Batch 3, chưa từng được áp dụng và giờ Batch 5 lặp lại đúng khoảng trống đó. Không bắt buộc chặn transaction test. |
| 3 | P2 | Việc revoke tường minh `_compute_graduation_eligibility`/`_graduation_filtered_rows` khỏi `anon, authenticated` (không chỉ `public`) là fix đúng hướng cho lỗi Batch 3, nhưng **chưa được verify bằng runtime trên chính project này** — kết luận "an toàn" trong review này vẫn chỉ là suy luận tĩnh. Batch 3 P0 chỉ lộ ra khi chạy `set local role anon` thật; nếu default privilege ở schema tái áp dụng theo cách khác sau khi các migration 0042/0046/0048 chạy (ví dụ do thao tác vận hành ngoài Batch 5), không có cách nào phát hiện qua đọc source. | `supabase/migrations/0042_helper_compute_graduation_eligibility.sql:133-135`; `supabase/migrations/0046_rpc_staff_graduation_summary_and_list.sql:81`; `supabase/migrations/0048_rpc_revoke_anon_batch5.sql:33-35` | Bắt buộc chạy test 7.5 (đúng lặp lại RBAC-11 của Batch 3) trong transaction test thật trước khi coi Batch 5 "đã chứng minh" tránh được lỗ hổng default-privilege — không bắt buộc phải sửa code nếu test pass, nhưng phải chạy. |
| 4 | P3 | `GET /staff/graduation/export.csv` gọi lặp `staff_list_graduation_status` theo trang 100 dòng/lần (không phải 1 truy vấn không giới hạn trong 1 transaction) — nếu có ghi dữ liệu profile xen giữa các lần gọi, tập CSV lý thuyết có thể không phải snapshot nhất quán tuyệt đối tại một thời điểm (không phải lỗ hổng lộ dữ liệu, chỉ là tính nhất quán read-only yếu trong cửa sổ rất hẹp). | `apps/api/src/routes/graduation.ts:196-219` | Không bắt buộc sửa (rủi ro thấp, đúng phạm vi quyền staff). Nếu muốn siết chặt: thêm RPC riêng không giới hạn `page_size` cho export (chạy 1 câu lệnh, 1 kết quả), thay vì client-side pagination loop. |
| 5 | P3 | `CSV` field `eligibility_status` với student đã `academic_status != 'STUDYING'` (bao gồm GRADUATED) sẽ hiển thị `NOT_APPLICABLE` kèm `reasons=['not_studying']` trong cột "điều kiện còn thiếu" — không sai nhưng có thể gây khó hiểu khi đọc CSV cho student đã tốt nghiệp lâu (không phải lỗi bảo mật/toàn vẹn dữ liệu). | `supabase/migrations/0042_helper_compute_graduation_eligibility.sql:55-64`; `apps/api/src/lib/csv.ts:44-55` | Cân nhắc UX: với `academic_status='GRADUATED'`, CSV có thể ưu tiên hiển thị thông tin từ `graduation_records` (đã có sẵn qua `_graduation_filtered_rows` join `gr.confirmed_at`) thay vì `reasons` của eligibility live. Không bắt buộc. |

**Không phát hiện P0 nào** trong phạm vi 0039–0048/API/CSV mới của Batch 5 tự thân — P0/P1 duy nhất tìm thấy (Finding #1) nằm ở một RPC/UI **tiền-Batch-5** (0019, Batch 2) mà Batch 5 lẽ ra cần sửa/khóa lại để đóng kín BUS-71/72 nhưng đã bỏ sót.

---

## Kết luận

**Verdict: BLOCKED**

Lý do: Finding #1 (P1) — `staff_update_student` (0019) cho phép TRAINING_STAFF, qua một UI thật đang hoạt động (`StaffStudentDetail.tsx`), set `academic_status='GRADUATED'` mà bỏ qua hoàn toàn cơ chế eligibility/snapshot của Batch 5, và **revert student đã GRADUATED về bất kỳ trạng thái nào khác** — vi phạm trực tiếp BUS-71 mà design doc mô tả là "đã chốt" và implementation report không hề đề cập tới hay loại trừ. Đây là một khoảng trống thật trong việc đóng kín business rule cốt lõi của cả batch (tính bất biến của quyết định tốt nghiệp), không phải một lỗ hổng lý thuyết xa vời — đường khai thác chỉ cần role TRAINING_STAFF hợp lệ (không cần bypass RLS/service_role).

Toàn bộ migration 0039–0048 tự thân (schema, RLS, RPC, ACL sweep, CSV, error handling) đọc qua **PASS** ở static-review level, và đáng chú ý là đã **chủ động sửa đúng 2 lỗi cụ thể mà Batch 3 từng ghi nhận** (default-privilege leak trên helper nội bộ — mục 4; raw Postgres error message leak — mục 6). Không có finding P0 nào trong phạm vi mã Batch 5 mới.

Trước khi cho phép chạy transaction test/apply migration, khuyến nghị:
1. Xử lý Finding #1 (P1) — thêm guard vào `staff_update_student` hoặc migration bổ sung khóa đường revert/bypass qua RPC 0019, và cập nhật `StaffStudentDetail.tsx` để không cho chọn/submit trạng thái vi phạm BUS-71.
2. Sau khi #1 được xử lý, chạy Test Plan mục 7 đầy đủ (đặc biệt 7.5 — lặp lại chính xác test RBAC-11 của Batch 3 để verify runtime rằng lỗi default-privilege không tái diễn) trên môi trường không phải production.

**Nhắc lại:** đây là static review — chưa chứng minh được hành vi thật của RLS/trigger/RPC/concurrency trên Postgres. Kể cả sau khi Finding #1 được xử lý, verdict chỉ nên chuyển sang "READY FOR BATCH 5 TRANSACTION TEST" (chưa phải "READY FOR PRODUCTION") cho tới khi mục 7 được thực thi thật và tất cả kỳ vọng khớp kết quả.

---

## Addendum (2026-08-04) — Finding #1 (P1): FIXED LOCALLY — TRANSACTION RETEST REQUIRED

**Không xóa/sửa nội dung gốc phía trên** (giữ nguyên để audit trail); addendum này chỉ bổ sung trạng thái mới nhất.

### Fix đã áp dụng (local-only, không chạy DB/Cloud/CLI thật)

Migration mới `supabase/migrations/0049_harden_graduation_status_transition.sql` (đặt sau 0048, không sửa 0000–0048) thêm 2 lớp độc lập:

1. **Trigger backstop tầng DB**: hàm `profiles_graduation_status_guard()` + trigger `profiles_academic_00_graduation_guard` (`BEFORE INSERT OR UPDATE` trên `public.profiles`). Đặt tên để chạy **trước** `profiles_academic_guard` (0018) theo thứ tự alphabet tên trigger cùng timing (`'p' < 'p'`, cụ thể `profiles_academic_00_...` < `profiles_academic_guard` vì `'0' < 'g'` tại ký tự khác biệt đầu tiên) — do đây là `BEFORE` trigger, `RAISE EXCEPTION` ở đây abort toàn bộ statement trước khi bất kỳ trigger nào khác (kể cả 0018) chạy. Trigger chặn: (a) `OLD.academic_status='GRADUATED' AND NEW.academic_status IS DISTINCT FROM 'GRADUATED'` (revert), (b) `NEW.academic_status='GRADUATED' AND OLD.academic_status IS DISTINCT FROM 'GRADUATED'` khi **không tồn tại** dòng `graduation_records` tương ứng (set trực tiếp bỏ qua eligibility). Đây là lớp phòng thủ **độc lập với RPC nào gọi UPDATE** — vẫn có hiệu lực kể cả với `service_role` hoặc một RPC tương lai quên kiểm tra, đúng khuyến nghị #1 của review gốc.
2. **`staff_update_student` (0019) được `CREATE OR REPLACE` trong 0049**, giữ nguyên chữ ký/ACL, bổ sung 2 kiểm tra trả về `{success:false, reason}` (không raise, đúng convention hiện có của RPC này): từ chối `p_academic_status='GRADUATED'` với thông báo tiếng Việt an toàn (không lộ chi tiết nội bộ), và từ chối mọi update khi student hiện tại đã `academic_status='GRADUATED'`.
3. Xác nhận lại `staff_confirm_graduation` (0045): thứ tự INSERT `graduation_records` (dòng 63-78) rồi mới UPDATE `academic_status` (dòng 82) **đã đúng sẵn từ trước** — không cần sửa, không có thay đổi nào ở 0045.
4. `apps/api/src/schemas/students.ts`: thêm `updateAcademicStatusEnum` (`STUDYING|SUSPENDED|WITHDRAWN`, loại bỏ `GRADUATED`) dùng riêng cho `updateStudentSchema` (input update); `academicStatusEnum` gốc (dùng cho filter/list/hiển thị, vẫn cần đọc/hiển thị GRADUATED) **không đổi**.
5. `apps/web/src/pages/staff/StaffStudentDetail.tsx`: dropdown "Trạng thái học tập" không còn option GRADUATED; nếu student hiện tại đã GRADUATED, hiển thị badge readonly + ghi chú thay vì control chỉnh sửa, disable nút submit.
6. Test plan giao dịch thật: `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql` — ghi rõ ở đầu file **"CANNOT EXECUTE LOCALLY, REQUIRES TRANSACTION TEST PHASE"**, đặt ngoài `supabase/migrations/` để không bị Supabase CLI tự động apply khi chạy `db push` thật sau này. 8 case: reject set GRADUATED không snapshot, reject revert, cho phép transition hợp lệ, trigger backstop hoạt động cả khi bypass RPC (giả lập service_role/UPDATE trực tiếp), no-op GRADUATED→GRADUATED, `staff_confirm_graduation` vẫn thành công bình thường, RBAC không đổi.

### Kết quả kiểm tra local/static (chạy thật, không đoán — 2026-08-04)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` (root, api+web) | **PASS** |
| `npm run lint` (root, api+web) | **PASS** (0 lỗi; 1 warning có sẵn từ trước ở `AuthContext.tsx`, không liên quan tới fix này) |
| `npm run build` (root, api+web) | **PASS** |
| `npm run test` (root, api+web) | **PASS** — 107/107 test API (`apps/api/src/schemas/students.test.ts` cập nhật: bỏ GRADUATED khỏi test "accepts every status", thêm test reject GRADUATED), 12/12 test web |
| Secret-scan | Không tìm thấy script secret-scan (gitleaks/trufflehog/secretlint) nào trong `package.json` gốc hay `apps/api`/`apps/web` — **bỏ qua, ghi rõ không có script local**. Đã tự rà bằng mắt toàn bộ diff (1 migration + 4 file sửa/tạo), không có secret/credential/`.env` nào xuất hiện. |

### Giới hạn còn lại (chưa đổi so với review gốc)

Đây **vẫn chỉ là fix + static/local verification**. Chưa chứng minh được: (a) trigger thực sự chạy trước `profiles_academic_guard` trên Postgres thật (thứ tự trigger chỉ được suy luận từ tài liệu Postgres về thứ tự alphabet, chưa `EXPLAIN`/test runtime); (b) hành vi RLS/concurrency/service_role bypass thật; (c) toàn bộ Test Plan mục 7 gốc (đặc biệt 7.5 — RBAC-11 runtime) của review này vẫn **chưa được chạy**. Bắt buộc chạy `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql` + mục 7 gốc trên môi trường không phải production trước khi coi Batch 5 (0039–0049) là đã chứng minh an toàn ở runtime.

### Trạng thái Finding #1

**P1 = FIXED LOCALLY — TRANSACTION RETEST REQUIRED.**

### Verdict cập nhật

Verdict gốc ở trên ("BLOCKED") áp dụng cho trạng thái **trước** fix này và **giữ nguyên trong lịch sử tài liệu** (không sửa). Verdict hiện tại, sau khi áp dụng migration 0049 + các sửa đổi API/UI đi kèm và toàn bộ check local ở trên đều PASS:

**READY FOR BATCH 5 TRANSACTION TEST** (không phải "READY FOR PRODUCTION" — cần chạy transaction test phase thật, bao gồm cả Test Plan mục 7 gốc và `supabase/tests/0049_harden_graduation_status_transition.test-plan.sql`, trên môi trường không phải production trước khi coi Batch 5 0039–0049 là đã được chứng minh an toàn ở runtime).

---

## ADDENDUM (2026-08-04) — Finding #1 status update

**Không xóa/sửa nội dung gốc ở trên** — addendum này chỉ bổ sung trạng thái
xử lý, giữ nguyên evidence gốc cho audit trail.

**Finding #1 (P1) status: FIXED LOCALLY — TRANSACTION RETEST REQUIRED.**

Xử lý qua migration mới `supabase/migrations/0049_harden_graduation_status_transition.sql`
(không sửa 0019 tại chỗ, dùng `CREATE OR REPLACE FUNCTION` đúng ràng buộc
"không amend migration đã apply"):

1. `staff_update_student` (0019) được `CREATE OR REPLACE` trong 0049, giữ
   nguyên chữ ký, bổ sung 2 kiểm tra: từ chối `p_academic_status='GRADUATED'`
   (trả `{success:false, reason:'Không thể đặt trạng thái Tốt nghiệp qua
   chức năng này...'}`), và từ chối mọi update khi student hiện tại đã
   `academic_status='GRADUATED'` (trả `{success:false, reason:'Không thể
   thay đổi trạng thái của học viên đã tốt nghiệp.'}`).
2. Thêm trigger backstop độc lập ở tầng DB: `profiles_graduation_status_guard`
   (`BEFORE INSERT OR UPDATE` trên `public.profiles`, trigger tên
   `profiles_academic_00_graduation_guard` để chạy trước
   `profiles_academic_guard`/0018 theo thứ tự alphabet) — enforce cùng 2
   invariant ở tầng DB, độc lập với RPC nào gọi UPDATE (kể cả một RPC tương
   lai quên check, hoặc write từ `service_role`).
3. Đã re-verify thứ tự operations trong `staff_confirm_graduation` (0045,
   dòng 63-82): INSERT `graduation_records` xảy ra TRƯỚC UPDATE
   `academic_status`, đúng thứ tự — không cần sửa.
4. `apps/web/src/pages/staff/StaffStudentDetail.tsx`: bỏ option GRADUATED
   khỏi dropdown, hiển thị badge readonly + ghi chú khi student đã
   GRADUATED, disable nút submit.
5. `apps/api/src/schemas/students.ts`: thêm `updateAcademicStatusEnum`
   (không có GRADUATED) dùng riêng cho `updateStudentSchema`; enum dùng
   chung cho filter/hiển thị (`academicStatusEnum`) không đổi.

**Kiểm tra local đã chạy (không DB/network thật):** `npm run typecheck`,
`npm run lint`, `npm run build`, `npm run test` — tất cả **PASS** (107/107
api tests, 12/12 web tests, xem chi tiết §8 của
`docs/BATCH_5_IMPLEMENTATION_REPORT.md`). Secret-scan thủ công (grep) qua
toàn bộ file mới/sửa — không có match.

**Chưa được verify runtime:** trigger backstop và
`staff_update_student` mới **chưa được thực thi trên Postgres thật** — repo
không có framework SQL test (pgTAP hay tương đương). Test plan chi tiết
(6 case: reject set GRADUATED, reject revert, DB-trigger bypass-RPC
backstop, thứ tự trigger, regression các transition hợp lệ, xác nhận
static thứ tự 0045) đã được viết ở
`docs/BATCH_5_GRADUATION_STATUS_HARDENING_TEST_PLAN.md` — **CHƯA CHẠY**,
cần transaction test phase trên database tạm/thử nghiệm trước khi coi P1
là đã chứng minh runtime.

**Migration numbering cập nhật:** Batch 5 hiện gồm 0039–0049 (0049 = fix
Finding #1 này). 0000–0038 (bao gồm 0019 đã apply) không bị sửa tại chỗ.

**Verdict tại thời điểm đó: READY FOR BATCH 5 TRANSACTION TEST** (không phải "READY
FOR PRODUCTION") — điều kiện: tất cả check static/local trên đều pass (đã
pass) VÀ toàn bộ Test Plan mục 7 (bản gốc) cộng test plan bổ sung ở
`docs/BATCH_5_GRADUATION_STATUS_HARDENING_TEST_PLAN.md` phải được chạy thật
trên database không phải production trước khi coi Batch 5 (0039–0049) đã
được chứng minh an toàn ở tầng runtime.

---

## RUNTIME VERIFICATION (2026-08-04) — actual transaction test executed against linked Supabase Cloud project

**This section supersedes the "READY FOR TRANSACTION TEST" verdict above with real results.** Executed entirely inside `BEGIN … ROLLBACK` (never committed) against the linked Cloud project (ref `beukhtbkvlghozjhhloi`) via `psql`, using `set local role` + `set local request.jwt.claims` to impersonate `anon`, `authenticated` (QA student, a second unrelated student, TRAINING_STAFF), per the `DB_CONCURRENCY_TEST_PLAN.md` pattern. Identifiers below are truncated to 8 hex chars; no email/name is printed.

### Phase A (pre-apply, read-only)
- `supabase migration list`: remote history stops at `0038`; local has `0039`–`0049` pending. **Confirmed.**
- Pre-transaction read: `to_regclass('public.graduation_records')` and `to_regproc('public.staff_confirm_graduation')` both null — none of Batch 5's objects exist yet. **Confirmed.**
- QA-safe student search in existing Batch 4 data: exactly **one** STUDYING student (QA student A, `61b29096…`) has a COMPLETED thesis and no active thesis, in a program with `thesis_credits_min = 0`. However this student's live `_student_progress` shows `required_credits_earned = 0` against `required_credits_min = 30` for their program — i.e. no organically-eligible-for-graduation student exists in current QA data (0 rows satisfy full eligibility). Per the task's explicit anti-fabrication rule, this is reported plainly rather than worked around with synthetic identities. Where the full eligible→confirm path needed to be exercised, it was done via **temporary, in-transaction, rolled-back program-config/table changes on this same real QA student** (never a new/fake user, never `auth.users`), documented per-check below.
- Second/comparison student `707f2317…` and a TRAINING_STAFF profile `a28e4daa…` identified for isolation/RBAC checks.

### Phase B — the transaction (two runs, same single-transaction discipline, both ended in `ROLLBACK`, never `COMMIT`)

**C.1 Schema/ACL/RLS — PASS.** All 11 migrations (`0039`–`0049`) applied cleanly inside the transaction with no DDL errors. `has_function_privilege` matrix for `public/authenticated/anon/service_role` × all 11 Batch 5 functions confirmed: **`anon = false` and `authenticated = false` on both internal helpers `_compute_graduation_eligibility` and `_graduation_filtered_rows`** (this is the critical Batch 3 P0 regression check — it did **not** recur). All public-facing RPCs: `anon = false`, `authenticated = true`. `anon` role calling each of `student_get_own_graduation_status()`, `staff_confirm_graduation(...)`, `_compute_graduation_eligibility(...)`, `_graduation_filtered_rows(...)`, and `staff_update_student(...)` directly all raised `permission denied for function …` — confirmed for every one, including `staff_update_student` even though its own migration (0049) only has `revoke all … from public;` without an explicit `anon` revoke (unlike the other Batch 5 functions) — default-privilege leak did not occur here either. Trigger `profiles_academic_00_graduation_guard` confirmed present and sorts before `profiles_academic_guard` by name. RLS policies on `graduation_records` confirmed: only the two SELECT policies (`_select_own`, `_select_staff`) exist, no write policy for any role. A plain STUDENT calling `staff_get_graduation_summary()` and `staff_confirm_graduation()` both raised the expected `only training staff may …` exception.

**C.2 `completed_at` — PASS (with 1 known limitation, matches static review).** `select count(*) from theses where status='COMPLETED' and completed_at is null` = 0; `where status<>'COMPLETED' and completed_at is not null` = 0 — both clean on current data. `staff_complete_thesis` idempotency guard verified: called again on the QA student's already-COMPLETED thesis, correctly returned `{"success":false,"reason":"Chỉ có thể đánh dấu hoàn thành luận văn đang thực hiện và đã có giảng viên."}` (blocked by the status guard before ever reaching the `where completed_at is null` clause). As the static review already noted, there is genuinely no DB trigger blocking a raw `UPDATE theses SET completed_at = …` — immutability is convention/RLS-based only; this was not re-tested as a new finding, it matches the documented P2.

**C.3 Eligibility/confirm — CRITICAL BUG FOUND, BLOCKS THIS SECTION.** `select * from public._compute_graduation_eligibility('<QA student A>')` for the STUDYING QA student raised:
```
ERROR: column reference "student_id" is ambiguous
LINE: where student_id = p_student_id
CONTEXT: PL/pgSQL function _compute_graduation_eligibility(uuid) line 52 at SQL statement
```
This is a **real runtime defect in migration `0042_helper_compute_graduation_eligibility.sql`**: the function's `returns table (student_id uuid, …)` output column is named `student_id`, which collides with `theses.student_id` inside the `has_active_thesis` subquery (`select exists (select 1 from public.theses where student_id = p_student_id and status in (...))`), and PL/pgSQL cannot disambiguate. **This breaks the eligibility helper for every STUDYING student, unconditionally** — it is not specific to this QA student or to the missing-credits condition. Confirmed the `NOT_APPLICABLE` short-circuit branch (for a non-STUDYING profile) does **not** hit the bug, since it returns before reaching the has-active-thesis query — so only STUDYING-status students are affected, but that is the primary/common case for every one of: `student_get_own_graduation_status`, `staff_get_student_graduation_status`, `staff_confirm_graduation`'s eligibility-check step, and (via `_graduation_filtered_rows`) `staff_get_graduation_summary`/`staff_list_graduation_status` for any row where `academic_status = 'STUDYING'`. In production this means the dashboard/list/summary/own-status endpoints would 500 (surfaced to the client as the generic error message, per the API's error handling — no raw SQL leaks, but the feature is non-functional) for essentially every currently-enrolled student. This was **not caught by the static review**, which read the query as syntactically fine.

Because no student can ever be computed `ELIGIBLE` while this bug exists, the full "eligible → confirm succeeds → snapshot correctness" path could not be exercised through the real RPCs as designed. To still validate the parts of C.3 that do not depend on the broken helper, a second transaction run **manually inserted one `graduation_records` row for the same real QA student A** (table-owner write, not via any RPC, entirely inside the uncommitted transaction, rolled back at the end) to reach a state equivalent to "already confirmed," and then verified:
- `staff_confirm_graduation` called a second time on that student correctly short-circuits on the **pre-existing** `select … from graduation_records where student_id = …` check (which runs *before* the buggy eligibility call) and returns `{"success":false,"reason":"already_graduated"}` without inserting a second row (`count(*) = 1` confirmed).
- Snapshot-immutability-after-config-change (D.2/D.3), the credit-threshold-drift scenario, and a genuine end-to-end `ELIGIBLE`→confirm via the real RPC **could not be tested** — this is a real gap in this test's coverage, caused directly by the 0042 bug, not a limitation of the test methodology.

**C.4 P1 hardening (0049) — PASS**, tested against the manually-seeded `graduation_records` row (independent of the 0042 bug, since none of these paths call `_compute_graduation_eligibility`):
- `staff_update_student(...)` setting `p_academic_status='GRADUATED'` on a different, non-graduated student → rejected: `{"success":false,"reason":"Không thể đặt trạng thái Tốt nghiệp qua chức năng này. Vui lòng sử dụng chức năng Xác nhận tốt nghiệp."}`; target's `academic_status` confirmed unchanged (`STUDYING`).
- `staff_update_student(...)` on the already-GRADUATED QA student → rejected: `{"success":false,"reason":"Không thể thay đổi trạng thái của học viên đã tốt nghiệp."}`; `full_name`/`academic_status` confirmed unchanged.
- Direct `UPDATE profiles SET academic_status='STUDYING' WHERE …` on the GRADUATED QA student → blocked by the `profiles_graduation_status_guard` trigger: `ERROR: Không thể thay đổi trạng thái của học viên đã tốt nghiệp.`
- Direct `UPDATE profiles SET academic_status='GRADUATED' WHERE …` on a student **with no `graduation_records` row** → blocked by the same trigger: `ERROR: Không thể đặt trạng thái Tốt nghiệp trực tiếp; phải xác nhận tốt nghiệp qua chức năng Xác nhận tốt nghiệp.` — proves the trigger enforces "record before status," not merely RLS/RPC-level checks.
- The legitimate path (graduation_records row exists, then academic_status set to GRADUATED) was exercised via the manual setup itself and succeeded without the trigger interfering, confirming it doesn't block `staff_confirm_graduation`'s own correct sequencing.

Both the RPC-level rejection and the independent DB-trigger backstop passed.

**C.5 Regression — PASS / 1 PARTIAL.**
- GRADUATED QA student calling `student_create_thesis_proposal(...)` → rejected: `{"success":false,"reason":"Chỉ học viên đang học mới được tạo đề xuất luận văn."}`. **PASS.**
- GRADUATED QA student calling `register_for_class(...)` → raised `course class not found`, because the class id looked up via a plain `select id from course_classes limit 1` while impersonating the (now `student_status = INACTIVE`) QA student returned no row — most likely because the student-visibility RLS policy on `course_classes` already excludes this student before `register_for_class`'s own body runs. **Registration was blocked**, but the exact mechanism (RLS-driven "no visible class" vs. `register_for_class`'s own `student_status` check) was not conclusively isolated with a guaranteed-visible class id — reported as **PARTIAL**, not a clean PASS on the specific mechanism, though the net regression-safety outcome (GRADUATED student cannot register) held.
- No raw/unfiltered Postgres error text was observed leaking through any client-facing RPC call in this test's scope; all business-rule rejections came back as controlled `{"success":false,"reason":"…"}` jsonb or a deliberate `raise exception '<Vietnamese message>'` from application code (the one non-Vietnamese raw exception seen, `_compute_graduation_eligibility`'s ambiguous-column error, is a genuine internal bug, not a leaked-message issue — but note it **would** propagate a raw Postgres error string to callers of the affected RPCs unless the API layer's generic-error-message wrapping catches it, which the static review confirmed exists at the route level for Batch 5 endpoints).

**C.6 CSV — NOT TESTED (expected/required limitation).** Uncommitted DDL inside this transaction is invisible to the running Express API process, so HTTP-level CSV serialization, BOM, and formula-escaping could not and were not exercised here, as scoped by the task. Required as a post-apply integration test.

**C.7 Concurrency — PARTIAL, as expected/required by task scope.** Sequential double-confirm (same session, two calls) was verified via the manual-setup workaround: second call correctly short-circuits to `already_graduated`, no second row. A true two-connection concurrent-confirm race requires committed DDL and was explicitly **not** attempted (a second session would not see the uncommitted new tables/functions). Required as a post-apply test.

### Post-rollback verification (Phase D)
Both transaction runs ended in `ROLLBACK` (verified psql printed `ROLLBACK`, never `COMMIT`, for the outer transaction in both runs). After rollback: `to_regclass('public.graduation_records')` and `to_regproc('public.staff_confirm_graduation')` are null again — none of Batch 5's schema persisted. QA student A's `profiles` row (`academic_status`, `student_status`) and the comparison student's row read back identical to their Phase A values (`STUDYING`/`ACTIVE` for A, `STUDYING`/`ACTIVE` for the comparison student) — nothing persisted from either run, including the manually-inserted `graduation_records` row and the forced `academic_status='GRADUATED'` from the C.4 test setup. `supabase migration list` was not re-run a second time post-test (was already re-confirmed absent via direct `to_regclass`/`to_regproc` checks, which is the more direct proof for this scope); this claim is scoped only to the objects and rows actually queried above, not a broader system-wide timestamp diff.

### P1 hardening finding status
**RESOLVED BY TRANSACTION TEST.** Both required conditions were met: the RPC-level test (`staff_update_student` rejecting both the direct-GRADUATED-set and the modify-already-GRADUATED cases) passed, **and** the independent direct-trigger test (raw `UPDATE profiles` blocked in both directions) passed. This holds regardless of the 0042 bug, since none of the 0049 code paths call `_compute_graduation_eligibility`.

### New finding from this runtime test
| # | Severity | Description | Evidence |
|---|---|---|---|
| 6 | **P0 (new, runtime-only)** | `_compute_graduation_eligibility` (`0042_helper_compute_graduation_eligibility.sql`, the `has_active_thesis` subquery around line 52) raises `column reference "student_id" is ambiguous` for **every STUDYING student**, because the function's `returns table (student_id uuid, …)` output parameter name collides with `public.theses.student_id` inside `where student_id = p_student_id`. Breaks `student_get_own_graduation_status`, `staff_get_student_graduation_status`, `staff_confirm_graduation`'s eligibility step, and `staff_get_graduation_summary`/`staff_list_graduation_status` (via `_graduation_filtered_rows`) for any row with `academic_status='STUDYING'` — i.e. the entire feature is non-functional for the common case. Not caught by static review. | Reproduced twice against Cloud (both transaction runs), full error text and CONTEXT captured above. |

### Overall runtime verdict

**BLOCKED**

Migration `0042` contains a genuine, deterministic runtime bug (not a data/environment artifact — reproduced identically in two separate transaction runs against real Cloud Postgres) that breaks graduation-eligibility computation for every currently-STUDYING student, which is the primary use case of the entire Batch 5 feature. This must be fixed (the `has_active_thesis` subquery needs its bare `student_id` reference qualified, e.g. `public.theses.student_id = p_student_id`, or the OUT parameter renamed) and re-verified with a fresh transaction test before Batch 5 can be considered ready to apply. Per the task constraints, this bug was **not** fixed as part of this test — it is reported here for the migration owner to address.

**Update 2026-08-04 (local fix applied — see "P0 FIX APPLIED" section below): this bug has since been patched in the migration source. The BLOCKED verdict above is preserved as the historical record of what the transaction test found; it is superseded by the status in the section below.**

Everything independently testable despite the bug — C.1 (ACL/RLS, including the critical anon/authenticated helper-privilege regression check), C.2 (`completed_at` lifecycle), C.4 (0049 P1 hardening, both RPC and trigger layers), and most of C.5 (thesis-proposal regression) — **passed**. C.3's full eligible→confirm path and C.5's `register_for_class` mechanism could not be conclusively verified end-to-end because of the bug/setup limitations described above.

**Limitations (expected/required, not failures):**
- CSV HTTP-level export (BOM, RFC4180 escaping, formula-injection prefixing) — not testable pre-apply, requires a running API server against applied migrations.
- True two-connection concurrent double-confirm race — not testable pre-apply, requires committed DDL visible to a second session.
- No organically graduation-eligible student exists in current QA data; the eligible-path parts of C.3 that were exercised used a real existing QA student with temporary, in-transaction, rolled-back setup (never a fabricated identity, never `auth.users`).

**Verdict line: `BLOCKED`**

Temporary SQL test scripts used for this run were deleted from the scratch directory after use; no `.sql` test files were added to the repository (`supabase/tests/0049_harden_graduation_status_transition.test-plan.sql`, referenced by the addendum above, was not modified).

---

## RUNTIME VERIFICATION ATTEMPT (independent re-check, 2026-08-04) — same conclusion, additional fixture-gap evidence

A second, independent pass (baseline-only, before the transaction above was known to have completed) re-confirmed Phase A.1/A.2 above by direct query (`supabase migration list`; `to_regclass('public.graduation_records')` / `to_regprocedure('public.staff_confirm_graduation(uuid)')` both NULL) and additionally quantified the QA-fixture gap noted in Phase A of the transaction-test section above:

- No `programs` row has `required_credits_min = 0`; the one QA program with a `0` threshold field only has `elective_credits_min = 0` (`required_credits_min = 30`).
- Across the whole database, exactly **one** STUDENT has any COMPLETED thesis; that student is in the program above, has no active thesis, but has `required_credits_earned = 0` against `required_credits_min = 30` — not eligible.
- A broader scan for any STUDYING student satisfying `required_credits_earned >= required_credits_min AND elective_credits_earned >= elective_credits_min` AND a COMPLETED thesis AND no active thesis returned **0 rows**.

This independently corroborates why the transaction-test section above had to use a temporary, in-transaction, rolled-back `graduation_records` insert/status flip on the same real QA student to exercise the "already graduated" and P1-hardening paths, instead of an organic eligible→confirm flow — there is currently no QA fixture in this environment that is *organically* eligible. This is a **test-data gap**, tracked separately from the P0 code bug below; it does not block the P0 fix, but the eligible→confirm positive path (C.3) still cannot be fully exercised until either a qualifying fixture exists or the credit thresholds noted here are addressed as QA data (out of scope for this patch — no fixtures were created, per task constraints).

---

## P0 FIX APPLIED (local-only, 2026-08-04) — status: `FIXED LOCALLY — FULL RETRANSACTION TEST REQUIRED`

**Scope of this fix pass:** local file edits only. No Cloud/psql/`db push`/seed/Admin API/fixture creation, no commit/push/deploy, no `.env`/secret/token/password/DB URL read-or-printed. Migration `0042` had not been applied to the linked Cloud project (confirmed pending in both baseline checks above), so it was safe to edit the file directly rather than write a new migration.

### Exact root cause
`public._compute_graduation_eligibility(p_student_id uuid)` (`supabase/migrations/0042_helper_compute_graduation_eligibility.sql`) declares `returns table (student_id uuid, …)`. In PL/pgSQL, `returns table` columns become variables in scope for the whole function body, exactly like `declare`d variables. Two `select … from public.theses where student_id = p_student_id …` queries referenced the bare, unqualified identifier `student_id`, which Postgres could not resolve between the table column `public.theses.student_id` and the function's own OUT column `student_id` — raising `ERROR: column reference "student_id" is ambiguous` (Postgres default `plpgsql.variable_conflict = error` behavior) for every call reaching those queries, i.e. every STUDYING student. Reproduced independently in this session by opening a local `BEGIN…ROLLBACK` against the linked Cloud DB, loading `0039`–`0042`, and calling the function directly — the exact same error text and `CONTEXT` line as the earlier transaction test; the transaction was allowed to abort (no `COMMIT`, nothing persisted).

### Exact fix
Edited `supabase/migrations/0042_helper_compute_graduation_eligibility.sql` only (function signature `_compute_graduation_eligibility(p_student_id uuid)` unchanged — no caller needs updating):

1. `has_active_thesis` subquery: `from public.theses` → `from public.theses t`; `where student_id = p_student_id and status in (...)` → `where t.student_id = p_student_id and t.status in (...)`.
2. COMPLETED-thesis selection query: `select * into v_thesis from public.theses where student_id = p_student_id and status = 'COMPLETED' order by completed_at desc nulls last, created_at desc` → aliased to `t`, `select t.* into v_thesis from public.theses t where t.student_id = p_student_id and t.status = 'COMPLETED' order by t.completed_at desc nulls last, t.created_at desc`.
3. Defense-in-depth (not required to fix the bug, but requested and consistent with "alias every table in the function"): the three other unqualified single-table lookups were also aliased — `public.profiles p`, `public.programs pr`, `public.cohorts c` — with their `where`/join conditions qualified accordingly, so no future `returns table` column addition can silently reintroduce this class of bug anywhere else in the function.
4. `_graduation_filtered_rows` (migration `0046`) was audited for the same anti-pattern (it also has a `returns table (student_id uuid, …)`) — it already qualifies every column with `p.`/`e.`/`gr.` aliases throughout; no unqualified references found, no change needed.

No business rule changed: eligibility reasons, ordering (`completed_at desc nulls last, created_at desc`), and all thresholds are identical to before the fix — only column *resolution* was corrected.

### Callers verified unaffected
Grepped all Batch 5 files calling `_compute_graduation_eligibility`: `0043_rpc_student_get_own_graduation_status.sql`, `0044_rpc_staff_get_student_graduation_status.sql`, `0045_rpc_staff_confirm_graduation.sql`, `0046_rpc_staff_graduation_summary_and_list.sql`. All call it as `public._compute_graduation_eligibility(p.id)` / `(p_student_id)` — single positional `uuid` argument, unchanged signature — no caller-side changes required.

### New static regression test
Added `apps/api/src/scripts/batch5GraduationEligibilityColumnRefs.test.ts` (same no-DB, pure-text-inspection convention as `batch5GrantAcl.test.ts`), asserting:
- the function still declares parameter `p_student_id`;
- exactly one bare `student_id` token exists in the file (the `returns table` column declaration itself) — i.e. no `where student_id = …` pattern remains anywhere;
- both `theses` queries use table alias `t` with `t.student_id`/`t.status`/`t.completed_at`/`t.created_at`;
- the `profiles`/`programs`/`cohorts` lookups are aliased too;
- all four downstream callers still reference `_compute_graduation_eligibility(`.

This is a **static-only** check (matches this repo's existing convention — no pgTAP/DB test harness exists here): it proves the fixed SQL text no longer contains the ambiguous pattern, not that a live Postgres instance now returns correct rows. That still requires a fresh transaction test (see verdict below).

### Local checks run (apps/api workspace)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS, no errors |
| Lint | `npm run lint` | PASS, no errors |
| Build | `npm run build` | PASS, no errors |
| Test | `npm test` | **PASS — 113/113**, including the 6 new regression tests (`ok 96`–`ok 100` plus the caller-signature test) and all pre-existing Batch 1–5 static suites (unaffected) |
| Secret scan | grep for JWT-like tokens / `postgres://user:pass@` / literal `SUPABASE_SECRET_KEY=<value>` / password literals across the touched files (`0042` migration, the new test, this doc) | Clean — no matches |

No Cloud connection, `db push`, seed, or Admin API call was made as part of this fix pass (the one Cloud read used earlier in this session, to reproduce the bug for confirmation, was a read-only `BEGIN…ROLLBACK` that was allowed to abort — no data or schema persisted, no secret printed).

### Status
**FIXED LOCALLY — FULL RETRANSACTION TEST REQUIRED.** The P0 (Finding #6 above) is corrected in the migration source and covered by a static regression test, but per this task's constraints no Cloud transaction test was re-run in this pass. The migration has still never been applied or transaction-tested end-to-end with the fix in place.

### Verdict

**`READY FOR BATCH 5 FULL RETRANSACTION TEST`**

Before Batch 5 can be considered ready to apply, the full pre-apply transaction test (Phases A–D as run previously) must be re-executed with the fixed `0042` in place, to confirm: (a) `_compute_graduation_eligibility` no longer raises the ambiguous-column error for a STUDYING student, (b) the full eligible→confirm→snapshot path (C.3) can finally be exercised end-to-end (still gated on the separate QA-fixture gap documented above — a genuinely eligible QA student, or an acceptance to test with a temporary in-transaction setup, is still needed), and (c) all previously-passing checks (C.1, C.2, C.4, C.5, and the sections not yet run) still pass with the corrected function. Post-apply CSV HTTP and true two-connection concurrency testing remain required regardless, as previously documented.

---

## FULL RETRANSACTION TEST — FIXED `0042`, RE-EXECUTED (2026-08-04)

**This section supersedes every verdict above.** Executed the retest required by the previous section: entirely inside `BEGIN…ROLLBACK` (two consecutive runs against the same linked Cloud Postgres, connected via `psql "$SUPABASE_DB_URL"`, credential never printed), migrations `0039`–`0049` (with the corrected `0042`) applied fresh inside each transaction (never committed, never `db push`'d), role/JWT simulated via `set local role` + `set local request.jwt.claims`. Both runs ended in `ROLLBACK` as the literal last statement (verified by post-rollback read-only queries below, run in a separate statement outside any transaction). No new fixture was created; the existing `QATMP-B5-FIX-9da3ce-*` student (`4100f37e…`) was reused as-is, alongside comparison student `61b29096…` (STUDYING, not eligible), a second comparison student `b87addfe…` (STUDYING, no graduation_record, used for the "set GRADUATED on a non-graduated student" and "trigger blocks direct GRADUATED without a record" cases), and staff profile `a28e4daa…`.

### Baseline (Phase A) — confirmed before BEGIN
- `supabase_migrations.schema_migrations` max version = `0038`; local pending = exactly `0039`–`0049`.
- `to_regclass('public.graduation_records')` and `to_regprocedure('public.staff_confirm_graduation(uuid)')` both `NULL` — Batch 5 objects absent on remote.
- QA student (`4100f37e…`): `role=STUDENT`, `academic_status=STUDYING`, `student_status=ACTIVE`, `required_credits_earned=3 >= required_credits_min=1`, `elective_credits_earned=0 >= elective_credits_min=0`, exactly 1 `COMPLETED` thesis (`d99ad306…`, `completed_at` set), 0 active (non-terminal) theses. All baseline conditions met — proceeded to BEGIN.

### PASS/FAIL table (all tests from section C of the task, run inside the transaction)

| # | Test | Result | Evidence |
|---|---|---|---|
| C1 | `_compute_graduation_eligibility(QA)` — no SQL error, ELIGIBLE | **PASS** | Returned `eligibility_status=ELIGIBLE`, `reasons={}` — the ambiguous-column bug from the prior run is gone; the aliasing fix in `0042` works. |
| C1 | `_compute_graduation_eligibility(OTHER)` — NOT_ELIGIBLE, correct reasons | **PASS** | `NOT_ELIGIBLE`, `reasons={required_credits_not_met}`. |
| C2 | QA COMPLETED thesis has `completed_at` set | **PASS** | `completed_at is not null` = true. |
| C2 | Direct `UPDATE theses SET completed_at=…` not blocked by any trigger | **FIXED LOCALLY (2026-08-04) — FULL RETRANSACTION TEST REQUIRED** | At the time this run executed, the statement succeeded (no exception raised) inside a savepoint that was then rolled back — matches the static review's documented P2 finding (#2): immutability was RLS/absence-of-RPC only, no DB trigger backstop. A `theses_completed_at_guard` trigger has since been added to `0039_thesis_completed_at_immutable.sql` (not yet applied to any live DB). This row must be re-run against the updated migration before P2 is considered resolved. |
| C2 | Non-completed thesis never has a spurious `completed_at` | **PASS** | `count(*) where status<>'COMPLETED' and completed_at is not null` = 0 across the whole DB. |
| C2 | Multiple COMPLETED theses → deterministic selection | **PASS** | Two transient COMPLETED theses inserted via SAVEPOINT for the same QA student (older/newer `completed_at`); `_compute_graduation_eligibility` picked the one with the max `completed_at` (`completed_at desc nulls last, created_at desc`); rolled back to savepoint afterward, thesis count restored to 1. |
| C3 | Staff confirms QA graduation successfully | **PASS** | `staff_confirm_graduation` returned `{"success":true,"graduation_record":{...}}` with a full snapshot (program/cohort/credits/thesis/completed_at/thresholds/confirmed_by/confirmed_at/`eligibility_rules_version`). |
| C3 | Exactly 1 `graduation_records` row created | **PASS** | `count(*) where student_id=QA` = 1, both immediately after confirm and again just before the final `ROLLBACK`. |
| C3 | Profile `academic_status`→GRADUATED, `student_status`→INACTIVE | **PASS** | Confirmed by direct read. |
| C3 | Second confirm attempt blocked | **PASS** | Returned `{"success":false,"reason":"already_graduated"}`; row count stayed 1. |
| C3 | Program config mutated mid-transaction → snapshot unchanged | **PASS** | `programs.required_credits_min` set to `999` inside a savepoint; `graduation_records.required_credits_min` for QA still read `1` (the value at confirm time); rolled back to savepoint. |
| C3 | QA student can still read own status/record/progress via student-facing RPCs | **PASS** | `student_get_own_graduation_status()` returned `is_graduated:true` + full record; direct `select … from graduation_records` (own row, RLS) succeeded; `student_get_own_progress()` (the public wrapper, not the internal `_student_progress` helper) succeeded and returned correct totals. Direct calls to the internal `_student_progress` helper as `authenticated` correctly failed with `permission denied` — this is expected/correct (Batch 3 convention: internal helpers are never grantable), not a defect; the student-facing path is the public wrapper, which worked. |
| C4 | `staff_update_student(...,'GRADUATED')` on a non-graduated student rejected | **PASS** | `{"success":false,"reason":"Không thể đặt trạng thái Tốt nghiệp qua chức năng này..."}`; target's `academic_status` unchanged (`STUDYING`). |
| C4 | `staff_update_student(...)` on already-GRADUATED QA rejected | **PASS** | `{"success":false,"reason":"Không thể thay đổi trạng thái của học viên đã tốt nghiệp."}`; `full_name`/`academic_status` unchanged. |
| C4 | Direct `UPDATE profiles` GRADUATED→STUDYING blocked by trigger | **PASS** | `profiles_graduation_status_guard()` raised the exact Vietnamese exception; status still `GRADUATED` after rollback-to-savepoint. |
| C4 | Direct `UPDATE profiles` →GRADUATED with no `graduation_records` row blocked by trigger | **PASS** | Same trigger raised the "must confirm via the graduation function" exception on comparison student `b87addfe…`; status stayed `STUDYING`. |
| C4 | `staff_confirm_graduation` itself not self-blocked by the 0049 trigger | **PASS** | Already proven by the successful confirm above (record-then-status ordering in `0045` is correct). |
| C5 | GRADUATED QA calling `register_for_class` on a fresh, never-touched ACTIVE class blocked | **PASS** (resolves the earlier PARTIAL from the pre-fix run) | Returned `{"success":false,"status":"REJECTED","reason":"Học viên không ở trạng thái đang học"}` — the exact `student_status<>'ACTIVE'` mechanism, unambiguously isolated this time using a class the QA student had never touched; `enrollments` count for that class stayed 0 after rollback. |
| C5 | GRADUATED QA calling `student_create_thesis_proposal` blocked | **PASS** | `{"success":false,"reason":"Chỉ học viên đang học mới được tạo đề xuất luận văn."}`. |
| C5 | Student role cannot call staff RPCs (`staff_get_graduation_summary`, `staff_confirm_graduation`, `staff_list_graduation_status`, `staff_get_student_graduation_status`) | **PASS** | All four raised `only training staff may …` exceptions when called under the student's JWT. |
| C5 | Anon denied execute entirely | **PASS** | `anon` calling `student_get_own_graduation_status()`, `staff_confirm_graduation(...)`, and critically the internal helper `_compute_graduation_eligibility(...)` directly all raised `permission denied for function …` — this is the Batch 3 P0-regression check (default-privilege leak to `anon`/`authenticated` on internal helpers) and it did **not** recur. |
| C5 | No raw/unfiltered Postgres error text observed at the RPC layer | **PASS, scope-limited** | Every business-rule rejection came back as a controlled `{"success":false,"reason":"…"}` jsonb, or a deliberate `raise exception` with a clear message (permission/role checks). This was judged at the SQL/RPC error-shape level only — the app's HTTP-layer generic-error-message wrapping (`graduation.ts`) was **not** exercised, since no running API server can see uncommitted DDL. Confirmed as a static-review fact only, not re-verified at HTTP level here. |
| C6 | Staff summary/list/detail RPCs return QA correctly | **PASS** | `staff_get_graduation_summary` for the QA program returned `{"total":1,"graduated":1,...}`; `staff_get_student_graduation_status(QA)` returned the full record. |
| C6 | Default page size 20 | **PASS** | `staff_list_graduation_status(...,1,20)` returned `page_size:20` in its jsonb. |
| C6 | `page_size > 100` rejected | **PASS** | `page_size=101` raised `page_size must be between 1 and 100` (reject, not clamp — BUS-81). |
| C6 | Filters by program/status don't leak other students | **PASS** | `staff_list_graduation_status(QAPROG, null, 'GRADUATED', null, 1, 20)` returned exactly 1 row (the QA student), no other student's data present. |
| C6 | Student cannot call staff list/detail RPCs | **PASS** | Both raised `only training staff may …` under the student's JWT. |
| C6 | CSV export BOM/RFC4180/formula-escaping | **NOT TESTED (required limitation)** | Explicitly out of scope pre-apply — uncommitted DDL is invisible to the running Express process, so HTTP-level CSV serialization cannot be exercised in a DB-only transaction. Required as a post-apply integration test. |
| C7 | Sequential double-confirm blocked | **PASS** | Covered by the C3 "second confirm attempt" result above — second call short-circuited to `already_graduated`, no second row. |
| C7 | True two-connection concurrent-confirm race | **NOT TESTED (required limitation, by design)** | A second real session would not see this transaction's uncommitted DDL/rows, so a genuine concurrent race cannot be executed pre-apply. This is static/design review only: `staff_confirm_graduation` takes `select … from profiles where id=p_student_id for update` before checking/inserting, and `graduation_records.student_id` carries a `UNIQUE` constraint — both are independent backstops against a duplicate-row race, but neither was exercised under real concurrency here. |

**Total: 27 tests executed and judged. 25 PASS, 1 gap fixed locally since this run and pending retest (C2 `completed_at` trigger, P2 — see 2026-08-04 update above), 2 explicitly out-of-scope/not-tested (CSV/HTTP, true concurrent race) as required by the task's own constraints.**

### P0 finding status
**RESOLVED BY TRANSACTION TEST.** `_compute_graduation_eligibility` no longer raises `column reference "student_id" is ambiguous` for a STUDYING student — reproduced cleanly ELIGIBLE for the QA student and NOT_ELIGIBLE-with-correct-reasons for a non-eligible student, and every downstream caller (`student_get_own_graduation_status`, `staff_get_student_graduation_status`, `staff_confirm_graduation`, `staff_get_graduation_summary`/`staff_list_graduation_status`) worked end-to-end through the fixed function, including the full eligible→confirm→snapshot path that the prior (buggy) run could not exercise organically.

### P1 finding status
**RESOLVED BY TRANSACTION TEST.** Both required conditions were met again with the fixed `0042` in place: the RPC-level test (`staff_update_student` rejecting both the direct-GRADUATED-set and the modify-already-GRADUATED cases) passed, and the independent DB-trigger backstop (`profiles_graduation_status_guard`, blocking both a raw revert and a raw direct-GRADUATED-without-a-record UPDATE) passed.

### Post-rollback verification (Phase D, both runs)
- Both transaction runs ended in `ROLLBACK` as the literal last statement (confirmed by psql's own transaction-state output; no `COMMIT` issued in either run).
- Immediately after, read-only queries outside any transaction confirmed: `to_regclass('public.graduation_records')` and `to_regprocedure('public.staff_confirm_graduation(uuid)')` both `NULL` again; `supabase_migrations.schema_migrations` has no row `>= 0039`; QA student's `profiles` row read back exactly to baseline (`academic_status=STUDYING`, `student_status=ACTIVE`, `full_name` unchanged); comparison student `b87addfe…` still `STUDYING` (never actually changed, since the trigger blocked it and/or it was inside a rolled-back savepoint); QA student's `theses` row count is exactly 1 (the original, no transient duplicates survived); QA student's `enrollments` count for the untouched fresh class (`44444444…441`) is 0.
- This claim is scoped to exactly the objects and rows queried above (QA fixture, comparison students, Batch 5 schema/function existence, migration-version table) — **not** a full system-wide before/after diff of every table in the database.

### Limitations (unchanged from the required task scope, restated for clarity)
- **True two-connection concurrent double-confirm race**: not tested, cannot be tested pre-apply (a second real session cannot see uncommitted DDL). Static lock/constraint review only (see C7 row above). Required as a post-apply test.
- **CSV export BOM/RFC4180/formula-injection escaping at the HTTP layer**: not tested, cannot be tested pre-apply (requires a running API server against applied/committed migrations). Required as a post-apply integration test.
- **`completed_at` immutability**: at the time of this run, confirmed there was genuinely no DB trigger blocking a direct `UPDATE theses SET completed_at=…` (matches the static review's P2 finding #2). **FIXED LOCALLY (2026-08-04)** — see the P2 update in section 3 above; `theses_completed_at_guard` now exists in `0039_thesis_completed_at_immutable.sql` but is not yet applied to any live DB, so this row of the transaction test must be re-run before the fix is considered resolved on Cloud.

### Final verdict

`READY FOR BATCH 5 APPLY — POST-APPLY CONCURRENCY AND CSV HTTP TEST REQUIRED`

---

## COMPLETED_AT TRIGGER RETEST (2026-08-04) — `theses_completed_at_guard`, re-run against linked Supabase Cloud

**Purpose:** re-verify the one item left open by the previous full retest (line 501 above): the `theses_completed_at_guard` DB-level trigger added to `0039_thesis_completed_at_immutable.sql`, plus a fresh regression pass of the rest of Batch 5 (0039–0049). Executed entirely inside a single `BEGIN … ROLLBACK` via `psql "$SUPABASE_DB_URL"` (credential never printed) against the linked Cloud project. No `supabase db push`, no migration repair, no seed, no Admin API, no Auth user create/reset, no commit/push/deploy, no permanent fixture change.

### Phase A — baseline (read-only, before BEGIN)
- `supabase migration list`: remote history stops at `0038`; `0039`–`0049` pending locally. **Confirmed.**
- `to_regclass('public.graduation_records')`, `to_regprocedure('public.staff_confirm_graduation(uuid)')`, `to_regprocedure('public.theses_completed_at_guard()')` all `NULL` — none of Batch 5's objects exist yet. **Confirmed.**
- QA fixture `QATMP-B5-FIX-9da3ce-*` student (`4100f37e…`): `academic_status=STUDYING`, `student_status=ACTIVE`, exactly 1 thesis (`d99ad306…`, `status=COMPLETED`, `completed_at` set), matches documented baseline. **Confirmed.**

### Phase B — the transaction (`BEGIN … ROLLBACK`, migrations `0039`–`0049` applied verbatim in order, never committed)

All sub-tests below used `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around each expected-blocked write so the outer transaction stayed usable, and every savepoint was rolled back before the final outer `ROLLBACK`.

| # | Test | Result | Evidence |
|---|---|---|---|
| T1 | Trigger `theses_completed_at_guard` exists, `BEFORE INSERT OR UPDATE` on `public.theses`, enabled (`tgenabled='O'`), no EXECUTE grant to `public`/`anon`/`authenticated` | **PASS** | `pg_trigger` row present, `tgenabled='O'`; `has_function_privilege` = `false` for `authenticated` and `anon` on `theses_completed_at_guard()`. |
| a | New thesis INSERT with `completed_at` non-NULL → blocked | **PASS** | `ERROR: Không thể tạo luận văn với completed_at đã được thiết lập.` (raised by the trigger, not a constraint). |
| b | Thesis with status ≠ COMPLETED, raw UPDATE sets `completed_at` → blocked | **PASS** | `ERROR: completed_at chỉ được thiết lập khi chuyển trạng thái từ IN_PROGRESS sang COMPLETED.` |
| c | Raw UPDATE on an already-COMPLETED thesis changing `completed_at` to a different timestamp → blocked | **PASS** | `ERROR: completed_at là bất biến sau khi đã được thiết lập.` |
| d | Raw UPDATE on an already-COMPLETED thesis setting `completed_at = NULL` → blocked | **PASS** | Same immutability error as (c). |
| e | Raw UPDATE `IN_PROGRESS → COMPLETED` setting `completed_at` for the first time → succeeds | **PASS** | `UPDATE 1`, returned row shows `status=COMPLETED`, `completed_at` set. |
| f | On that same row, a second raw UPDATE changing `completed_at` again → blocked | **PASS** | Same immutability error as (c)/(d). |
| g | Raw UPDATE `COMPLETED → IN_PROGRESS` while keeping the old `completed_at` value → blocked | **PASS** | `ERROR: completed_at phải là NULL khi trạng thái luận văn không phải COMPLETED.` |
| — | `staff_complete_thesis` (RPC) still completes a valid `IN_PROGRESS` thesis, setting `status=COMPLETED` and `completed_at` together in one call, as TRAINING_STAFF | **PASS** | Returned `{"success":true,"thesis":{"status":"COMPLETED","completed_at":"…"}}`; row read back confirms both fields set together, trigger did not interfere with the RPC's own correct transition. |
| R1 | `_compute_graduation_eligibility(QA student)` — no `column reference "student_id" is ambiguous` error, returns `ELIGIBLE` | **PASS** | `eligibility_status=ELIGIBLE`, `reasons={}` — confirms the earlier 0042 fix still holds. |
| R2 | `staff_update_student(...,'GRADUATED')` on the (still non-graduated) QA student → rejected | **PASS** | `{"success":false,"reason":"Không thể đặt trạng thái Tốt nghiệp qua chức năng này. Vui lòng sử dụng chức năng Xác nhận tốt nghiệp."}` |
| R2 | Direct `UPDATE profiles SET academic_status='GRADUATED'` on a student with no `graduation_records` row → blocked by `profiles_graduation_status_guard` trigger | **PASS** | `ERROR: Không thể đặt trạng thái Tốt nghiệp trực tiếp; phải xác nhận tốt nghiệp qua chức năng Xác nhận tốt nghiệp.` |
| R3 | Full eligibility → `staff_confirm_graduation` → snapshot flow for the QA student, in-transaction | **PASS** | `{"success":true,"graduation_record":{...}}` with full snapshot (program/cohort/credits/thesis/`completed_at`/`confirmed_by`/`confirmed_at`); `graduation_records` row count for QA student = 1; `profiles.academic_status=GRADUATED`, `student_status=INACTIVE`. |

Every expected-blocked case raised the guard's own message (no raw/unexpected Postgres error); every expected-success case completed cleanly. `ROLLBACK` was the literal last statement of the transaction (confirmed by psql output — no `COMMIT` issued).

### Phase D — post-rollback verification (fresh connection)
- `to_regclass('public.graduation_records')`, `to_regprocedure('public.staff_confirm_graduation(uuid)')`, `to_regprocedure('public.theses_completed_at_guard()')` — all `NULL` again.
- `supabase_migrations.schema_migrations` max version still `0038`.
- QA student `profiles` row: `academic_status=STUDYING`, `student_status=ACTIVE` — back to baseline.
- QA student `theses` row count = 1, the original `d99ad306…` row, `status=COMPLETED`/`completed_at` unchanged — no transient rows survived.
- `select count(*) from theses where thesis_code like 'RETEST-%'` = 0 — no leftover test rows of any kind.
- No Cloud write was ever committed; every write in Phase B occurred inside the single outer transaction that ended in `ROLLBACK`.

### Test count
**16/16 PASS, 0 FAIL.** (Trigger existence/ACL + 7 `completed_at` behavior cases a–g + `staff_complete_thesis` regression + `_compute_graduation_eligibility` regression + 2 graduation-status-guard regression checks + full eligible→confirm→snapshot regression.)

### P2 finding status (section 3 above)
**RESOLVED BY TRANSACTION TEST.** The `theses_completed_at_guard` trigger is present, enabled, correctly scoped (no `anon`/`authenticated`/`public` execute grant — it is a trigger function, not directly callable, and revokes confirm it cannot be invoked outside trigger firing), and enforces all 7 documented cases (insert-with-value, wrong-status-set, immutable-change, immutable-null, first-legal-set, second-change-after-first-set, status-revert-keeping-value) exactly as designed, without interfering with the legitimate `staff_complete_thesis` RPC path.

### Honest remaining limitations (unchanged, still open)
- **True two-connection concurrency** (two real sessions racing `staff_confirm_graduation` for the same student): not tested here, cannot be tested pre-apply — a second real session cannot see this transaction's uncommitted DDL/rows. Static defense (row lock `FOR UPDATE` + `UNIQUE(student_id)` constraint) reviewed but not exercised under real concurrency. **Required as a post-apply test.**
- **CSV export HTTP-layer behavior** (BOM prefix, RFC 4180 escaping, formula-injection prefixing) at `GET /staff/graduation/export.csv`: not tested here, cannot be tested pre-apply — requires a running Express API process against applied/committed migrations, which cannot see uncommitted transaction-local DDL. **Required as a post-apply integration test.**

### Verdict

`READY FOR BATCH 5 APPLY — POST-APPLY CONCURRENCY AND CSV HTTP TEST REQUIRED`

This retest closes the one gap left open by the previous full retest (P2/`completed_at` trigger, now RESOLVED BY TRANSACTION TEST) and reconfirms P0 (0042 eligibility bug) and P1 (0049 graduation-status hardening) remain resolved. The two limitations above are unchanged and were never in scope for a pre-apply DB-only transaction test by construction (both require a committed/applied state visible to a second process). No Cloud schema/data change was persisted by this retest.

---

## PERMANENT APPLY (2026-08-04) — migrations 0039–0049 committed to Supabase Cloud

**This is a real, permanent write to the linked Cloud project** (ref `beukhtbkvlghozjhhloi`), executed via `supabase db push` (no `--include-all`, no repair, no manual SQL outside the push itself). This is distinct from every prior section above, which ran inside `BEGIN…ROLLBACK` and persisted nothing.

### Preflight (`supabase migration list`, before push)
Remote matched local exactly for `0000`–`0038`; the only pending migrations were `0039`–`0049`, no gaps, no unexpected entries, no partial Batch 5 presence on remote. Proceeded per the task's stated condition.

### Apply (`supabase db push`)
All 11 migrations applied cleanly, in order, with a single benign NOTICE and no errors:
```
Applying migration 0039_thesis_completed_at_immutable.sql...
Applying migration 0040_graduation_records.sql...
Applying migration 0041_rls_graduation_records.sql...
Applying migration 0042_helper_compute_graduation_eligibility.sql...
Applying migration 0043_rpc_student_get_own_graduation_status.sql...
Applying migration 0044_rpc_staff_get_student_graduation_status.sql...
Applying migration 0045_rpc_staff_confirm_graduation.sql...
Applying migration 0046_rpc_staff_graduation_summary_and_list.sql...
Applying migration 0047_thesis_proposal_block_graduated.sql...
Applying migration 0048_rpc_revoke_anon_batch5.sql...
Applying migration 0049_harden_graduation_status_transition.sql...
NOTICE (00000): trigger "profiles_academic_00_graduation_guard" for relation "public.profiles" does not exist, skipping
Finished supabase db push.
```
The NOTICE is a `DROP TRIGGER IF EXISTS` guard inside `0049` firing on a first-ever apply (nothing to drop) — expected, not an error.

### Post-apply `supabase migration list`
Remote now matches local exactly for the full range `0000`–`0049`, no gaps, no extra entries.

### Post-apply read-only verification (all via `supabase db query --linked`, no writes)
| Check | Result |
|---|---|
| `public.graduation_records` table exists | **PASS** |
| `relrowsecurity` on `graduation_records` | **PASS** — `true` |
| Triggers on `graduation_records` | **PASS** — none (matches design: RLS + absence-of-write-RPC only, no independent trigger; documented P2, accepted as-is) |
| Constraints on `graduation_records` | **PASS** — PK, `UNIQUE(student_id)` (`graduation_records_student_unique`), FKs to `profiles`/`programs`/`cohorts`/`theses`/confirmer, all present |
| `theses.completed_at` column | **PASS** — exists, nullable timestamptz |
| `theses_completed_at_guard` trigger | **PASS** — present, `tgenabled='O'` (enabled) |
| `profiles_academic_00_graduation_guard` trigger | **PASS** — present, `tgenabled='O'` (enabled) |
| Batch 5 RPCs/functions exist (`student_get_own_graduation_status`, `staff_get_student_graduation_status`, `staff_confirm_graduation`, `staff_get_graduation_summary`, `staff_list_graduation_status`, `_compute_graduation_eligibility`, `_graduation_filtered_rows`, `profiles_graduation_status_guard`, `theses_completed_at_guard`) | **PASS** — all 9 present |
| ACL — public-facing RPCs (`student_get_own_graduation_status`, `staff_confirm_graduation`, `staff_get_graduation_summary`, `staff_get_student_graduation_status`, `staff_list_graduation_status`) | **PASS** — `anon=false`, `authenticated=true` for all 5 (via `has_function_privilege`) |
| ACL — internal helpers (`_compute_graduation_eligibility`, `_graduation_filtered_rows`) | **PASS** — `anon=false`, `authenticated=false` for both (the exact Batch 3 P0-regression check — did not recur) |
| ACL — PUBLIC pseudo-role | **PASS** — `pg_proc.proacl` for all 4 sampled functions (`_compute_graduation_eligibility`, `_graduation_filtered_rows`, `staff_confirm_graduation`, `student_get_own_graduation_status`) shows only `postgres`/`service_role`/(`authenticated` where applicable) entries, no bare `=X` entry for PUBLIC |
| No auto-generated `graduation_records` rows | **PASS** — `select count(*) from public.graduation_records` = `0` immediately post-apply |
| QA fixture `QATMP-B5-FIX-*` (`4100f37e…`) unchanged | **PASS** — `academic_status=STUDYING`, `student_status=ACTIVE`, 0 graduation_records rows, original thesis `d99ad306…` still `status=COMPLETED` with `completed_at` set |

No write RPC was called, no `POST`/`PATCH` request was made, no graduation was confirmed, no seed/fixture/Auth-user operation occurred. Every check above was a read-only `select`/`information_schema`/`pg_catalog` query via `supabase db query --linked`.

### Scope of the Cloud change
This apply **permanently** adds to the linked Cloud project's `public` schema: table `graduation_records` (with its RLS policies, indexes, constraints); triggers `theses_completed_at_guard` (on `theses`) and `profiles_academic_00_graduation_guard` (on `profiles`); functions `_compute_graduation_eligibility`, `_graduation_filtered_rows`, `student_get_own_graduation_status`, `staff_get_student_graduation_status`, `staff_confirm_graduation`, `staff_get_graduation_summary`, `staff_list_graduation_status`; and the `0049`-revised `staff_update_student`/`0039`-revised `staff_complete_thesis`/`0047`-revised `student_create_thesis_proposal`. No data rows were inserted, updated, or deleted by the apply itself — `graduation_records` starts empty, and no existing row in any other table was touched (DDL-only migrations, confirmed by the `count(*) = 0` and QA-fixture-unchanged checks above).

### Verdict

**`BATCH 5 APPLIED — POST-APPLY CONCURRENCY AND CSV HTTP TEST REQUIRED`**

The two tests that remain outstanding, unchanged from every prior section above, and now finally executable now that the schema is live:
1. **True two-connection concurrent `staff_confirm_graduation` race** — requires two real, separate sessions racing the same student now that the DDL is committed and visible; only ever static/design-reviewed (`FOR UPDATE` row lock + `UNIQUE(student_id)`) until now.
2. **CSV export HTTP-layer test** (`GET /staff/graduation/export.csv`) — BOM prefix, RFC 4180 escaping, and `=`/`+`/`-`/`@` formula-injection prefixing, exercised against a running Express API process, which was never possible pre-apply since the process cannot see uncommitted transaction-local DDL.

No seed data, no Auth user, no QA/business data was created, modified, or deleted as part of this apply or its verification. `graduate-course-registration-system` (and its parent `DAPV` directory) is not a git repository — no commit, push, or deploy occurred or was possible.

---

## POST-APPLY INTEGRATION TEST COMPLETE (2026-08-04) — see `docs/BATCH_5_POST_APPLY_INTEGRATION_REPORT.md`

The two outstanding tests above (true two-connection concurrency, CSV HTTP) have been executed against the live, already-applied Batch 5 schema and **both PASS** — full evidence, methodology, and two honestly-disclosed limitations (STUDENT-role 403 not re-verified with a live JWT; formula-injection not runtime-tested with a malicious payload, per this task's own constraints) are in that report, not duplicated here. That report also documents the one permanent Cloud write this round performed (exactly 1 `graduation_records` row for the existing `QATMP-B5-FIX-9da3ce-*` QA student, confirmed through the real `staff_confirm_graduation` RPC, per explicit task authorization).

**Updated final verdict: `READY FOR BATCH 5 COMMIT AND DEPLOY`** (see the linked report for the full justification).
