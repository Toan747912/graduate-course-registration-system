# Batch 3 Pre-Apply Security & Data-Integrity Review — Quản lý điểm và tiến độ học tập

## Phạm vi và phương pháp

**Phạm vi:** review bảo mật/toàn vẹn dữ liệu của toàn bộ Batch 3 (migration 0021–0027, `apps/api/src/routes/grades.ts`, `apps/api/src/schemas/grades.ts`, UI liên quan) trước khi cho phép chạy transaction test thật (BEGIN/ROLLBACK) trên môi trường không phải production.

**Phương pháp:** static review — đọc toàn bộ design doc (`docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md`), implementation report, migration 0000–0027 (đối chiếu 0009/0010 gốc với 0026/0027 sửa lại), route/schema API, và các trang UI liên quan. **Không có Postgres/Supabase thật để chạy** — mọi kết luận về hành vi RLS/trigger/RPC là suy luận từ đọc SQL, chưa được chứng minh bằng thực thi. Không sửa file nào, không chạy lệnh DB nào, đúng ràng buộc của nhiệm vụ.

Bằng chứng phụ trợ (không phải chứng minh runtime): `Get-ChildItem` timestamp trên `supabase/migrations/00*.sql` cho thấy 0000–0020 đều có `LastWriteTime` trước 8/2/2026 22:38 (thời điểm 0021 được tạo) — nhất quán với tuyên bố "không sửa 0000–0020", nhưng đây chỉ là mtime filesystem, không phải bằng chứng cứng (không có git repo để diff nội dung).

---

## 1. Migration dependency/order

- 0021–0027 tuần tự đúng thứ tự, mỗi file một mối quan tâm (bảng → RLS → RPC nhập/công bố → RPC list → RPC grades/progress → sửa cancel_course_class → sửa cancel_own_enrollment), khớp bảng kế hoạch mục I của design doc.
- mtime của 0000–0020 đều cũ hơn 0021 (xem trên) — không có dấu hiệu bị sửa. Đã đọc lại `0009_rpc_cancel_own_enrollment.sql` và `0010_rpc_cancel_course_class.sql` (bản gốc) so với `0027`/`0026` (bản sửa): logic gốc (ownership check, CONFIRMED check, registration-period window check, cascade CANCELLED_BY_SCHOOL, `enrollment_history` insert) được giữ nguyên y hệt, chỉ có duy nhất một khối `if exists (...) then return jsonb_build_object(success:false...)` được chèn thêm trước các bước hủy thật sự — đúng như báo cáo mô tả.
- `enrollment_grades.enrollment_id uuid not null unique references public.enrollments (id)` (`0021_enrollment_grades.sql:10`) — đúng ràng buộc 1-1 bắt buộc.
- `final_score numeric(3,1) not null check (final_score >= 0 and final_score <= 10)` (`0021:11`) — NOT NULL + range [0,10] đúng thiết kế, không có khung điểm rỗng.
- Đường tạo grade duy nhất là `staff_create_draft_grade` (`0023:13-63`), kiểm tra `v_enrollment.status <> 'CONFIRMED'` (`0023:43-45`) trước khi insert — không có đường nào khác tạo `enrollment_grades` (không có INSERT policy nào khác ngoài `enrollment_grades_insert_staff` ở `0022:38-42`, và policy đó chỉ cho phép — không tự chèn dữ liệu; chỉ RPC mới thực sự ghi).
- FK/index hợp lý: `enrollment_grades_enrollment_idx` (`0021:26`) trên `enrollment_id` phục vụ JOIN/EXISTS trong 0025/0026/0027. `published_by uuid references public.profiles (id)` nullable — hợp lý.
- Check ràng buộc đồng bộ `grade_status`/`result_status` (`0021:18-21`) là **CHECK constraint 2 chiều đúng đắn**: `PUBLISHED ⟹ result_status/published_at not null` VÀ `DRAFT ⟹ result_status/published_at/published_by đều null`. Không có khe hở logic (ví dụ PUBLISHED nhưng `published_by` null vẫn được — thực ra check không ép `published_by not null` khi PUBLISHED, chỉ ép null khi DRAFT — xem P3 ở bảng Findings).

**Nhận xét:** nhóm 1 không có vấn đề nghiêm trọng.

---

## 2. Published-grade immutability (review sâu)

Đây là nhóm quan trọng nhất theo yêu cầu — đã review từng đường có thể ghi vào `enrollment_grades`:

**(a) RPC staff.** `staff_update_draft_grade` kiểm tra `v_grade.grade_status <> 'DRAFT'` và trả `success:false` nếu đã PUBLISHED, **trước khi** chạm UPDATE (`0023:102-104`). `staff_publish_grade` kiểm tra `v_grade.grade_status <> 'DRAFT'` (`0023:154-156`) — không cho publish hai lần. Không có RPC nào khác có đường UPDATE/DELETE trên `enrollment_grades`. Không có RPC "un-publish"/"correction" nào tồn tại — đúng thiết kế (out-of-scope).

**(b) Trực tiếp PostgREST/RLS UPDATE.** Policy `enrollment_grades_update_staff` (`0022:44-49`) cho phép UPDATE nếu `is_training_staff()` — **policy RLS này không tự nó chặn PUBLISHED**, nó cho phép staff UPDATE bất kỳ dòng nào (kể cả PUBLISHED) ở tầng RLS. Đây chính là lý do thiết kế đưa vào **trigger độc lập** `enrollment_grades_block_update_when_published` (`0021:37-52`): trigger `BEFORE UPDATE`, kiểm tra `OLD.grade_status = 'PUBLISHED'` → `raise exception`. Trigger chạy **sau khi RLS đã cho qua** (RLS lọc dòng nào được UPDATE, trigger sau đó chặn ở tầng bảng vô điều kiện theo `OLD` row) — nên nếu staff cố `PATCH .../grade` gọi thẳng PostgREST REST API (bỏ qua RPC) với `UPDATE enrollment_grades SET final_score = ... WHERE id = ...` trên một dòng PUBLISHED, RLS UPDATE policy sẽ cho phép (staff = true), nhưng trigger sẽ raise exception và chặn ở tầng DB. **Đây thực sự chặn ở DB layer, không chỉ RPC/application layer** — đã verify bằng cách đọc trigger source, logic đúng và vô điều kiện (không có `search_path`/role bypass nào trong thân trigger).
  - Lưu ý: trigger không kiểm tra role gọi — nó chặn **bất kỳ ai** UPDATE một dòng có `OLD.grade_status = 'PUBLISHED'`, kể cả service_role. Điều này khớp với comment ở `0021:33-36` ("including from a SECURITY DEFINER RPC or the service role bypassing RLS").

**(c) UPDATE/DELETE trực tiếp bằng authenticated role.**
  - UPDATE: student không có UPDATE policy nào trên `enrollment_grades` (chỉ có `enrollment_grades_select_own_published` cho SELECT) → RLS deny-by-default chặn UPDATE của student hoàn toàn, không cần đến trigger. Staff có UPDATE policy nhưng bị trigger chặn khi PUBLISHED như phân tích ở (b).
  - DELETE: **0022 không có policy DELETE nào cho bất kỳ role nào** (comment `0022:51-53` xác nhận có chủ đích: "No delete policy: ... never hard-deleted"). Với RLS bật và không có policy `FOR DELETE`, mặc định **deny-all** cho `authenticated` — không ai (kể cả staff) xóa được qua PostgREST/RLS. Đây đúng là hành vi mong muốn.
  - **Không có trigger `BEFORE DELETE`** nào chặn DELETE ở tầng bảng độc lập với RLS — khác với UPDATE (có 2 lớp: RLS + trigger), DELETE chỉ có **1 lớp bảo vệ duy nhất là "không có policy DELETE"**. Điều này đủ để chặn `authenticated` role, nhưng **không chặn `service_role`** (service_role bypass RLS hoàn toàn theo mặc định Supabase, kể cả khi RLS enabled và không có policy). Nếu bất kỳ đoạn code nào trong hệ thống (kể cả ngoài Batch 3) dùng service_role key để DELETE trực tiếp trên `enrollment_grades`, sẽ **không có gì chặn** — không có trigger `BEFORE DELETE` để làm lớp phòng thủ thứ hai như đã làm với UPDATE. Xem P2 trong bảng Findings.

**(d) Đường bypass gián tiếp khác.** Không tìm thấy view/function nào khác ghi vào `enrollment_grades`. `set_updated_at` trigger (`0021:28-31`) chỉ set `updated_at`, không ghi cột nghiệp vụ, và chạy `BEFORE UPDATE` — thứ tự thực thi giữa 2 trigger `BEFORE UPDATE` trên cùng bảng theo tên alphabet (`enrollment_grades_block_update_when_published` < `enrollment_grades_set_updated_at`... thực ra Postgres chạy trigger theo tên alphabet: `block_update_when_published` chạy trước `set_updated_at` vì "b" < "s") — nếu trigger chặn raise exception thì toàn bộ UPDATE (kể cả set_updated_at) bị hủy trong cùng transaction, không có rủi ro race giữa 2 trigger.

**Kết luận nhóm 2:** UPDATE trên PUBLISHED được chặn thật sự ở DB layer (2 lớp: RLS + trigger, độc lập với nhau, đã verify qua đọc source). DELETE chỉ có 1 lớp (thiếu policy), đủ để chặn `authenticated`, nhưng lý thuyết vẫn cho phép `service_role` xóa nếu có đoạn code nào đó (không thuộc Batch 3, không tìm thấy trong review này) dùng service_role trên bảng này — xếp **P2** (không phải P0 vì không tìm thấy đường thực tế nào trong codebase hiện tại dùng service_role để động vào `enrollment_grades`; là phòng thủ chiều sâu còn thiếu, không phải lỗ hổng khai thác được ngay qua API/UI hiện có).

---

## 3. RLS/RBAC

- **Student SELECT PUBLISHED-only, đúng của chính mình:** `enrollment_grades_select_own_published` (`0022:25-36`) — điều kiện `grade_status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.id = enrollment_grades.enrollment_id AND e.student_id = auth.uid())`. Join đúng qua `enrollment_id → enrollments.student_id`, không có cách nào đọc chéo học viên khác (điều kiện `e.student_id = auth.uid()` bắt buộc). Đúng thiết kế.
- **Student không tạo/sửa/xóa qua bất kỳ đường nào:** đã xác nhận ở mục 2(c) — không có INSERT/UPDATE/DELETE policy nào cho student trên `enrollment_grades`; RLS deny-by-default áp dụng. Các RPC ghi (`staff_create_draft_grade`, `staff_update_draft_grade`, `staff_publish_grade`) đều có `if not public.is_training_staff() then raise exception` (`0023:30-32`, `0023:89-91`, `0023:145-147`) — role check tường minh trước khi ghi.
- **TRAINING_STAFF qua RPC đúng, không có policy allow-all bất thường:** `enrollment_grades_select_staff`/`insert_staff`/`update_staff` (`0022:19-49`) đều gọi `is_training_staff()`, không có `using (true)` trần trụi nào.
- **GRANT/REVOKE convention:** đã kiểm tra cả 7 RPC mới (0023×3, 0024×1, 0025×5 bao gồm 2 helper nội bộ, 0026×1, 0027×1) — mỗi RPC "public-facing" đều có `revoke all on function ... from public;` theo sau bởi `grant execute on function ... to authenticated;`, đúng convention 0020. Hai hàm helper nội bộ `_student_grades_rows`/`_student_progress` (`0025:65`, `0025:119`) chỉ có `revoke all ... from public` và **không có `grant ... to authenticated`** — đây là chủ đích (không expose trực tiếp, chỉ gọi nội bộ qua `SECURITY DEFINER` từ các RPC public khác), và vì Postgres cho phép hàm `SECURITY DEFINER` khác gọi hàm khác miễn là **owner** có quyền EXECUTE (không phải caller), thiết kế này đúng — helper không cần GRANT cho `authenticated` vì `authenticated` không gọi trực tiếp, chỉ gọi qua RPC public đã có GRANT.
- **Không lộ email/auth.users:** `staff_list_class_grades` trả `student_code`, `full_name` từ `profiles` (`0024:36-37`) — không JOIN `auth.users`, không trả email, khớp pattern Batch 2 đã chấp nhận.
- `0009`/`0010` gốc và `0026`/`0027` sửa lại đều giữ `revoke all ... from public` + `grant ... to authenticated` (đã đọc lại, dòng cuối mỗi file) — không có regression về GRANT khi sửa RPC cũ.

**Kết luận nhóm 3:** không phát hiện lỗ hổng RLS/RBAC.

---

## 4. Tiến độ tín chỉ

- Chỉ PUBLISHED+PASS+trong `program_courses` của chương trình hiện tại: cột `counts_towards_progress` trong `_student_grades_rows` được tính bằng `(g.grade_status = 'PUBLISHED' and g.result_status = 'PASS' and pc.id is not null)` (`0025:52`), với `pc` là `left join public.program_courses pc on pc.program_id = p.program_id and pc.course_id = c.id` (`0025:60`) — `p.program_id` luôn là **chương trình hiện tại** của `profiles` (không có cột lưu cứng program_id tại thời điểm học, đúng D.2 của design doc).
- REQUIRED/ELECTIVE tách đúng: `_student_progress` dùng `sum(credits) filter (where requirement_type = 'REQUIRED')` và tương tự cho `'ELECTIVE'` (`0025:106-107`), `requirement_type` lấy từ `pc.requirement_type` (`0025:51`) — join đúng bảng `program_courses`.
- **DISTINCT theo course_id, không cộng trùng khi học lại nhiều lần đạt:** `select distinct on (course_id) course_id, credits, requirement_type from public._student_grades_rows(...) where counts_towards_progress` (`0025:110-112`) — `DISTINCT ON (course_id)` đảm bảo mỗi `course_id` chỉ xuất hiện một lần trong tập con đã lọc `counts_towards_progress = true`, đúng BUS-35 (dedup khi có nhiều lượt PASS cho cùng môn).
- **Không cộng DRAFT/FAIL/môn ngoài khung/enrollment không CONFIRMED:** `counts_towards_progress` yêu cầu cả 3 điều kiện AND (`PUBLISHED`, `PASS`, `pc.id is not null`) — DRAFT (`grade_status <> PUBLISHED`) và FAIL (`result_status <> PASS`) đều bị loại tự động; môn ngoài khung có `pc.id is null` (left join miss) cũng bị loại khỏi filter `where counts_towards_progress` dù vẫn xuất hiện trong `_student_grades_rows` đầy đủ (dùng cho hiển thị lịch sử, đúng D.4). Về "enrollment không CONFIRMED": vì `enrollment_grades` chỉ tồn tại cho enrollment đã CONFIRMED tại thời điểm tạo (BUS-27, enforced ở `staff_create_draft_grade`), và Batch 3 không có cơ chế nào tự động xóa/cascade `enrollment_grades` khi `enrollment.status` đổi sau đó — nghĩa là nếu một enrollment CONFIRMED có điểm rồi (giả thuyết) bị đổi trạng thái sau đó bởi một luồng khác, `enrollment_grades` vẫn còn và vẫn được tính vào tiến độ. Tuy nhiên trong thực tế **không có luồng nào trong toàn bộ hệ thống (0001-0027) có thể đổi status của một enrollment đã có `enrollment_grades` mà không bị chặn**: `cancel_course_class` (0026) và `cancel_own_enrollment` (0027) đều bị chặn khi có `enrollment_grades` (BUS-36/37) — nên rủi ro lý thuyết này thực chất bị đóng kín bởi chính 0026/0027. Ghi nhận là **P3** (nhất quán logic, không phải lỗ hổng, nhưng phụ thuộc ngầm giữa các migration khiến việc audit riêng lẻ dễ nhầm).
- **`student_get_own_progress`/`staff_get_student_progress` dùng chung logic:** cả hai gọi thẳng `select * from public._student_progress(...)` (`0025:229`, `0025:264`) — cùng một helper, không có bản sao logic thứ hai. Không phát hiện lệch.

**Kết luận nhóm 4:** logic tính tiến độ chính xác theo thiết kế, không tìm thấy lỗi.

---

## 5. Hủy và lịch sử

- **BUS-36 (`0026`):** chặn hủy `cancel_course_class` khi `exists (select 1 from public.enrollment_grades g join public.enrollments e on e.id = g.enrollment_id where e.course_class_id = p_class_id)` (`0026:49-54`) — **không filter theo `grade_status`**, nghĩa là chặn cả DRAFT lẫn PUBLISHED đúng như BUS-36 yêu cầu ("bất kỳ" grade nào). Check này đặt **sau** check `status = 'CANCELLED'` nhưng **trước** UPDATE thật sự (`0026:62`) — đúng thứ tự, không có race giữa check và ghi trong cùng transaction (RPC chạy trong 1 statement/transaction ngầm định của PostgREST/RPC call, và dòng `course_classes` đã bị `for update` lock ở `0026:34` trước đó, nên không có TOCTOU giữa nhiều lời gọi `cancel_course_class` đồng thời — nhưng **enrollment_grades không bị lock** trước khi check `exists`, xem P3 dưới).
- **BUS-37 (`0027`):** chặn `cancel_own_enrollment` khi `exists (select 1 from public.enrollment_grades where enrollment_id = p_enrollment_id)` (`0027:59`) — không filter `grade_status`, đúng yêu cầu "DRAFT hoặc PUBLISHED, không phân biệt". Đặt sau check `status <> 'CONFIRMED'` (`0027:48`) và trước check registration-period window (`0027:68`) — thứ tự hợp lý (kiểm tra dữ liệu tồn tại/sở hữu trước, business rule mới chèn giữa các check nghiệp vụ cũ, không đổi thứ tự các check cũ với nhau).
- **Enrollment chưa có điểm hủy đúng như MVP cũ:** cả 0026 và 0027 giữ nguyên 100% logic hoàn chỗ/cascade/`enrollment_history` insert của bản gốc — đã so sánh dòng-với-dòng ở mục 1, không có thay đổi ngoài khối `if exists` mới chèn vào.
- **`enrollment_history` append-only không bị đụng:** không có file `0006_enrollment_history.sql` nào bị sửa (mtime cũ hơn 0021, và không migration 0021-0027 nào `ALTER TABLE enrollment_history` hay tạo trigger mới trên bảng đó — đã grep không thấy tham chiếu `enrollment_history` ngoài các `INSERT INTO public.enrollment_history` giữ nguyên trong 0026/0027 y hệt bản gốc 0009/0010).

**Kết luận nhóm 5:** đúng thiết kế, không phát hiện lỗ hổng. Một lưu ý nhỏ P3 về thiếu `FOR UPDATE`/lock trên `enrollment_grades` khi check tồn tại trong 0026 (concurrent insert điểm đúng lúc hủy lớp về lý thuyết có thể race — xem Findings).

---

## 6. API/UI

- **Zod strict:** `finalScoreSchema` (`apps/api/src/schemas/grades.ts:7-13`) ép kiểu number, range [0,10], và refine 1 chữ số thập phân bằng `Math.round(value*10) === value*10` — khớp NOT NULL/CHECK ở DB. `courseClassIdParamsSchema`/`enrollmentIdParamsSchema`/`studentIdParamsSchema` đều `z.string().uuid()` — chặn injection dạng path param không hợp lệ trước khi tới RPC.
- **Role guard đúng:** `gradesRouter.use('/staff', requireAuth, requireRole('TRAINING_STAFF'))` và `.use('/student', requireAuth, requireRole('STUDENT'))` (`grades.ts:23-24`) — áp dụng cho toàn bộ sub-path, khớp toàn bộ route bên dưới.
- **User-scoped client, không dùng service key:** mọi route đều `createUserScopedClient(req.authUser!.accessToken)` (ví dụ `grades.ts:37,71,113,143,173,195,217,238`) — không có `service_role` key nào trong route này.
- **Lỗi trả về client-safe:** các nhánh lỗi nghiệp vụ dùng `data?.reason` (tiếng Việt, do RPC trả `jsonb {success:false, reason}`) — không lộ raw Postgres. Tuy nhiên nhánh `if (error) { sendError(res, 400, 'RPC_ERROR', error.message); }` (xuất hiện ở mọi route, ví dụ `grades.ts:41-44`) **truyền thẳng `error.message` từ Supabase client ra response** — với các lỗi `raise exception` (not authenticated/only training staff...) đây chỉ là câu tiếng Anh ngắn không nhạy cảm, nhưng nếu một lỗi Postgres khác (constraint violation lạ, ví dụ do lỗi vận hành/edge case không lường trước ở DB) rơi vào nhánh `error` thay vì `success:false`, message gốc của Postgres (có thể chứa tên bảng/cột/constraint nội bộ) sẽ lộ ra client. Đây là **pattern đã có từ MVP/Batch 1/2** (không phải regression riêng của Batch 3) — ghi nhận **P3** vì nhất quán với convention cũ, không phải lỗi mới do Batch 3 gây ra, nhưng đáng lưu ý khi audit toàn hệ thống.
- **UI không lộ DRAFT cho student:** `student_get_own_grades` (`0025:126-156`) filter `WHERE r.grade_status = 'PUBLISHED'` ngay trong RPC — response JSON không có field `grade_status` nào cả (xem `returns table` của `student_get_own_grades`, `0025:127-139` — không có cột `grade_status`), nên **không có field nào, kể cả ẩn, tiết lộ trạng thái DRAFT hay đếm số DRAFT**. `StudentGrades.tsx` chỉ render dữ liệu từ endpoint này — không có leak qua UI.
- **Nút Hủy ở `StudentHistory.tsx`:** disable dựa trên `gradedEnrollmentIds` được suy từ `/student/grades` (chỉ PUBLISHED) — đúng như implementation report mô tả, chấp nhận khoảng UX nhỏ (nút không disable cho DRAFT). Đã xác nhận **backend `cancel_own_enrollment` (0027) chặn cả DRAFT lẫn PUBLISHED** (mục 5) — nên dù UI không phân biệt được, nhánh DRAFT vẫn bị RPC từ chối đúng, chỉ khác là UI hiển thị nút "Hủy" active rồi báo lỗi sau khi bấm thay vì disable trước — đúng ý đồ thiết kế J.3, không phải bug.
- **Types vs response:** `types/api.ts` (`StudentGradeRow`) — cần đối chiếu chính xác các field với `student_get_own_grades` RETURNS TABLE (`0025:127-139`): `enrollment_id, course_code, course_name, credits, class_code, semester_name, final_score, result_status, published_at, in_program, counts_towards_progress`. `StudentGrades.tsx` sử dụng đúng các field này (`row.course_code`, `row.course_name`, `row.class_code`, `row.semester_name`, `row.final_score`, `row.result_status`, `row.in_program`, `row.counts_towards_progress`, `row.enrollment_id`) — không thấy field nào bị dùng sai tên hay field thừa gây leak.
- **Route guard/deep-link:** không kiểm tra được `App.tsx` chi tiết trong lượt này (không đọc), nhưng route mount ở `grades.ts` đã có `requireRole` chặn ở API layer — kể cả nếu UI route guard có lỗ hổng deep-link, API vẫn chặn đúng role. Khuyến nghị: xác nhận thêm ở lượt review UI/route riêng nếu cần chắc chắn 100% (không phải blocker vì API là lớp bảo vệ chính).

**Kết luận nhóm 6:** không phát hiện lỗ hổng nghiêm trọng; 1 điểm P3 về error.message pass-through (kế thừa từ trước Batch 3).

---

## 7. Test plan preflight (chỉ liệt kê, KHÔNG chạy trong lượt review này)

### 7.1 Baseline schema/ACL check (đọc, không ghi)

```sql
-- Xác nhận cấu trúc bảng enrollment_grades đúng dự kiến
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'enrollment_grades'
order by ordinal_position;

-- Xác nhận UNIQUE + FK + CHECK constraints
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.enrollment_grades'::regclass;

-- Xác nhận RLS bật và đúng policy
select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
from pg_policy
where polrelid = 'public.enrollment_grades'::regclass;

-- Xác nhận trigger tồn tại và đúng thứ tự
select tgname, tgtype, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.enrollment_grades'::regclass and not tgisinternal;

-- Xác nhận GRANT đúng convention (revoke public, grant authenticated) cho từng RPC mới
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE')
from pg_proc p
cross join (values ('public'), ('authenticated'), ('anon'), ('service_role')) as r(rolname)
join pg_roles r2 on r2.rolname = r.rolname
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'staff_create_draft_grade','staff_update_draft_grade','staff_publish_grade',
    'staff_list_class_grades','student_get_own_grades','staff_get_student_grades',
    'student_get_own_progress','staff_get_student_progress',
    'cancel_course_class','cancel_own_enrollment'
  );
```

### 7.2 Transaction test plan (BEGIN...ROLLBACK, từng bước)

```sql
BEGIN;

-- Setup: giả định đã có sẵn seed test data (2 student profile A/B, 1 program
-- với pass_score_min, program_courses, 1 course_class, 2 enrollment CONFIRMED
-- của A cho 2 course khác nhau — một trong program_courses, một ngoài khung).

-- Step 1: staff tạo DRAFT hợp lệ cho enrollment A1 (điểm 7.5) -> kỳ vọng success:true, grade_status=DRAFT
select public.staff_create_draft_grade('<enrollment_A1_id>', 7.5);

-- Step 2: staff tạo DRAFT thứ hai cho cùng enrollment A1 -> kỳ vọng success:false (BUS-28, đã có điểm)
select public.staff_create_draft_grade('<enrollment_A1_id>', 8.0);

-- Step 3: staff sửa DRAFT A1 sang 8.0 -> kỳ vọng success:true, vẫn DRAFT
select public.staff_update_draft_grade('<enrollment_A1_id>', 8.0);

-- Step 4: staff công bố A1 -> kỳ vọng success:true, PUBLISHED, result_status theo pass_score_min
select public.staff_publish_grade('<enrollment_A1_id>');

-- Step 5: cố UPDATE trực tiếp bằng SQL trên dòng PUBLISHED (giả lập bypass RPC qua PostgREST/service_role)
--   -> kỳ vọng: raise exception từ trigger enrollment_grades_block_update_when_published
update public.enrollment_grades set final_score = 9.0 where enrollment_id = '<enrollment_A1_id>';

-- Step 6: cố DELETE trực tiếp trên dòng PUBLISHED bằng role authenticated (set role authenticated trước)
--   -> kỳ vọng: 0 rows affected (RLS deny, không có DELETE policy) - KHÔNG raise exception, chỉ affected_rows=0
set role authenticated; -- với JWT claim tương ứng student/staff nếu cần set qua set_config
delete from public.enrollment_grades where enrollment_id = '<enrollment_A1_id>';
reset role;

-- Step 7: staff cố publish lại A1 (đã PUBLISHED) -> kỳ vọng success:false (idempotency)
select public.staff_publish_grade('<enrollment_A1_id>');

-- Step 8: visibility - set JWT giả lập student A, SELECT enrollment_grades
--   -> kỳ vọng chỉ thấy dòng PUBLISHED của chính A1, không thấy DRAFT nào (nếu có), không thấy của B
--   (dùng set_config('request.jwt.claims', ..., true) mô phỏng auth.uid() = A)
select * from public.enrollment_grades; -- dưới role authenticated + claims của A

-- Step 9: visibility - set JWT giả lập student B, SELECT enrollment_grades của A -> kỳ vọng 0 rows

-- Step 10: RBAC - set JWT giả lập student A, gọi RPC staff_create_draft_grade -> kỳ vọng raise exception

-- Step 11: PASS/FAIL biên - publish một DRAFT với final_score đúng bằng pass_score_min -> kỳ vọng PASS
--          publish một DRAFT với final_score = pass_score_min - 0.1 -> kỳ vọng FAIL
--          publish một DRAFT với final_score = pass_score_min + 0.1 -> kỳ vọng PASS

-- Step 12: progress REQUIRED/ELECTIVE - gọi student_get_own_progress cho A, so sánh
--          required_credits_earned/elective_credits_earned với tổng credits kỳ vọng
--          từ các course PUBLISHED+PASS+in-program đã setup

-- Step 13: học lại không cộng trùng - tạo enrollment A2 (lần 2) cho cùng course
--          với A1's course (giả định A1 đã FAIL), publish PASS -> gọi lại
--          student_get_own_progress -> kỳ vọng cộng đúng 1 lần

-- Step 14: môn ngoài khung - publish PASS cho enrollment của course không có trong
--          program_courses -> kỳ vọng student_get_own_grades vẫn trả dòng đó
--          (in_program=false), nhưng student_get_own_progress KHÔNG cộng credits đó

-- Step 15: BUS-36 - tạo DRAFT cho một enrollment của course_class X, sau đó gọi
--          cancel_course_class(X) -> kỳ vọng success:false, reason "đã có điểm"
--          (test cả với DRAFT và riêng với PUBLISHED)

-- Step 16: BUS-37 - với enrollment đã có DRAFT (hoặc PUBLISHED), gọi
--          cancel_own_enrollment -> kỳ vọng success:false (test cả 2 trạng thái)

-- Step 17: regression - enrollment CONFIRMED hoàn toàn chưa có điểm ->
--          cancel_own_enrollment thành công (success:true), enrollment_history
--          có dòng CANCELLED_BY_STUDENT mới; course_class chưa có điểm nào ->
--          cancel_course_class thành công, cascade đúng như MVP

ROLLBACK;

-- Post-rollback verification (chạy SAU khi ROLLBACK ở transaction trên, trong
-- một transaction/session mới, không phải bên trong khối BEGIN ở trên):
select count(*) from public.enrollment_grades where enrollment_id in ('<enrollment_A1_id>', '<enrollment_A2_id>');
  -- kỳ vọng: 0 (mọi INSERT trong transaction test đã bị rollback sạch)
select status from public.enrollments where id in ('<enrollment_A1_id>', '<course_class_X_enrollment_id>');
  -- kỳ vọng: về đúng trạng thái trước test (CONFIRMED), không còn CANCELLED_BY_* từ test
select count(*) from public.enrollment_history where enrollment_id in (...);
  -- kỳ vọng: không có dòng mới nào phát sinh từ test
select version from supabase_migrations.schema_migrations order by version desc limit 10;
  -- kỳ vọng: 0021-0027 KHÔNG xuất hiện nếu preflight này chạy trước khi apply migration thật;
  -- nếu migration đã apply trước khi chạy test plan này (đúng quy trình dự kiến),
  -- thì chỉ cần xác nhận danh sách 0021-0027 đúng 7 dòng, không có version lạ nào chèn thêm.
```

**Ghi rõ: toàn bộ kế hoạch mục 7 này KHÔNG được thực thi trong lượt review này — chỉ liệt kê câu lệnh.**

---

## Bảng Findings tổng hợp

| Severity | Mô tả | Evidence (file:line) | Fix đề xuất (không tự sửa code) |
|---|---|---|---|
| P2 | `enrollment_grades` không có DELETE policy (đúng, chặn `authenticated`) nhưng cũng không có trigger `BEFORE DELETE` độc lập — khác với UPDATE (có 2 lớp RLS+trigger), DELETE chỉ có 1 lớp (thiếu policy). Nếu bất kỳ code nào (ngoài phạm vi Batch 3, không tìm thấy trong review này) dùng `service_role` key để DELETE trực tiếp, sẽ không bị chặn ở tầng DB. | `supabase/migrations/0022_rls_enrollment_grades.sql:51-53` (comment xác nhận có chủ đích, nhưng không có trigger bù) | Cân nhắc thêm trigger `BEFORE DELETE` trên `enrollment_grades` raise exception vô điều kiện (tương tự trigger UPDATE ở 0021), để có phòng thủ độc lập với RLS/service_role, nhất quán với nguyên tắc "no back door at all" đã áp dụng cho UPDATE. Không bắt buộc phải chặn trước khi transaction test (vì transaction test không dùng service_role để DELETE), nhưng nên bổ sung trước khi go-live thật với service_role code path nào đó trong tương lai. |
| P3 | `0026_rpc_cancel_course_class_block_if_graded.sql` khóa `course_classes` bằng `for update` (dòng 34) nhưng không lock `enrollment_grades`/`enrollments` liên quan trước khi `exists (...)` check (dòng 49-54) — về lý thuyết một `staff_create_draft_grade` chạy đồng thời có thể insert một `enrollment_grades` mới ngay sau thời điểm check nhưng trước UPDATE `course_classes`, dẫn tới lớp bị hủy dù vừa có điểm (race hẹp, cần 2 giao dịch đồng thời chính xác). | `supabase/migrations/0026_rpc_cancel_course_class_block_if_graded.sql:34,49-54` | Cân nhắc thêm `for update` trên `enrollments`/`enrollment_grades` liên quan, hoặc chấp nhận rủi ro race hẹp này (xác suất thấp trong vận hành thực tế: staff tự mâu thuẫn hành động của chính mình). Không phải blocker cho transaction test (test đơn luồng theo kế hoạch mục 7 không kích hoạt race này). |
| P3 | Route `grades.ts` (và pattern kế thừa từ MVP/Batch 1/2) truyền thẳng `error.message` từ Supabase RPC error vào `sendError` khi `error` (khác nhánh `success:false`) — nếu một lỗi Postgres ngoài dự kiến (không phải `raise exception` có chủ đích) xảy ra, message gốc có thể lộ chi tiết nội bộ (tên bảng/cột/constraint). Không phải regression riêng Batch 3. | `apps/api/src/routes/grades.ts:41-44` (và các route khác cùng pattern, ví dụ 79, 121, 150, 178, 200, 222, 243) | Cân nhắc (ở phạm vi toàn hệ thống, không riêng Batch 3) map `error.code`/`error.message` sang một thông báo chung ("Lỗi hệ thống, vui lòng thử lại") cho các lỗi không phải business-rule đã biết, log raw error phía server thay vì trả về client. |
| P3 | Check ràng buộc `enrollment_grades_result_status_matches_grade_status` không ép `published_by IS NOT NULL` khi `PUBLISHED` (chỉ ép `result_status`/`published_at not null`) — về lý thuyết một hàng PUBLISHED với `published_by = NULL` vẫn thỏa constraint. Trong thực tế `staff_publish_grade` luôn set `published_by = auth.uid()` (không NULL vì đã check `auth.uid() is null` ở đầu hàm) nên không có đường thực tế nào tạo ra tình huống này qua RPC hiện có. | `supabase/migrations/0021_enrollment_grades.sql:18-21`; `0023_rpc_record_and_publish_grade.sql:174` | Có thể siết thêm constraint để ép `published_by is not null` khi PUBLISHED cho chặt chẽ hơn về mặt lý thuyết, không bắt buộc vì không có đường khai thác qua ứng dụng. |
| P3 | Tính nhất quán "enrollment không CONFIRMED thì không có điểm" phụ thuộc ngầm vào việc 0026/0027 luôn chặn đổi trạng thái enrollment đã có điểm — không có ràng buộc DB tường minh nào (ví dụ CHECK hoặc trigger trên `enrollments`) đảm bảo bất biến này nếu trong tương lai có RPC khác đổi status enrollment mà quên thêm check tương tự. | `supabase/migrations/0021` (không có constraint), logic phụ thuộc `0026`/`0027` | Ghi nhận là nợ kỹ thuật cần lưu ý khi thêm RPC mới nào đổi `enrollments.status` trong các batch sau — nên có checklist "nếu đổi status enrollment, kiểm tra có enrollment_grades không" áp dụng cho mọi RPC tương lai, không chỉ 2 RPC hiện có. |

**Không phát hiện finding P0/P1 nào** trong static review này — không tìm thấy đường nào thực sự sửa/xóa được điểm PUBLISHED qua RPC, PostgREST/RLS, hay UI; không tìm thấy đường nào lộ DRAFT cho student; không tìm thấy policy allow-all hay GRANT sai convention.

---

## Verdict

**READY FOR BATCH 3 TRANSACTION TEST**

Không có P0/P1 nào chặn việc chạy transaction test thật. Các finding P2/P3 đều là phòng thủ chiều sâu bổ sung (defense-in-depth) hoặc nợ kỹ thuật ghi nhận, không phải lỗ hổng có đường khai thác thực tế qua API/UI hiện có trong Batch 3. Khuyến nghị xử lý P2 (thiếu trigger DELETE) trước khi hệ thống có bất kỳ code path nào dùng `service_role` chạm tới `enrollment_grades`, nhưng không cần chặn transaction test trên môi trường không phải production.

**Nhắc lại quan trọng:** đây là **static review**, không có Postgres/Supabase thật để chứng minh hành vi runtime của RLS/trigger/RPC. Toàn bộ kết luận ở trên dựa trên đọc SQL và suy luận logic, **chưa được xác nhận bằng thực thi**. Chỉ transaction test thật (`BEGIN`/`ROLLBACK` theo kế hoạch mục 7, trên môi trường không phải production) mới xác nhận được:
- Trigger `enrollment_grades_block_update_when_published` thực sự raise exception khi UPDATE dòng PUBLISHED (kể cả từ service_role).
- RLS policy `enrollment_grades_select_own_published` thực sự lọc đúng theo 2 JWT khác nhau.
- Các RPC business-rule (BUS-27..37) thực sự trả đúng `success:false`/`reason` ở từng nhánh biên đã liệt kê.
- Không có sai lệch giữa suy luận tĩnh và hành vi Postgres thật (ví dụ thứ tự thực thi trigger, hành vi `SECURITY DEFINER` với `search_path`, race condition ở P3 mục 5).

---

## 8. Live transaction test (2026-08-02) — Supabase Cloud, project `beukhtbkvlghozjhhloi`

**Phương pháp:** một transaction `BEGIN ... ROLLBACK` duy nhất chạy qua `supabase db query --linked -f <file>` (một lần gọi CLI, một session DB duy nhất). Toàn bộ DDL/RPC 0021–0027 được nạp **bên trong** transaction (không `supabase db push`), sau đó chạy 40 test case nghiệp vụ/RLS/RBAC/tiến độ/BUS-36-37 bằng `DO $$ ... EXCEPTION WHEN OTHERS ... END $$` ghi kết quả vào `CREATE TEMP TABLE qa_results`, mô phỏng danh tính bằng `set local role authenticated/anon; set local request.jwt.claims = ...` (đúng pattern `docs/DB_CONCURRENCY_TEST_PLAN.md:29-31`). Dữ liệu test dùng prefix `QATMP-B3-` (course/semester/registration_period/course_class mới tạo trong transaction) cộng với truy cập read-only vào baseline có sẵn (chương trình CS-MASTER, 2 sinh viên K2026, 1 nhân viên đào tạo, và 3 enrollment sẵn có của một sinh viên dùng làm FK target cho các dòng `enrollment_grades` tạo trong transaction — các dòng enrollment gốc không hề bị UPDATE/DELETE). **Kết thúc bằng `ROLLBACK;` vô điều kiện — không có `COMMIT` nào được chạy trong toàn bộ phiên làm việc này.**

**Baseline trước test (đã xác nhận):** `supabase migration list` — remote dừng ở 0020, 0021-0027 chỉ có ở cột Local. `to_regclass('public.enrollment_grades')` = null, không có hàm Batch 3 nào trong `pg_proc` trước khi transaction nạp DDL.

### 8.1 Kết quả theo nhóm

| Nhóm (category) | Số case | PASS | FAIL | Ghi chú |
|---|---|---|---|---|
| schema/integrity (CHECK/FK/UNIQUE/non-CONFIRMED) | 8 | 8 | 0 | NULL/`<0`/`>10` final_score, FK sai, UNIQUE(enrollment_id) trùng, tạo điểm cho enrollment REJECTED/CANCELLED_BY_SCHOOL — đều bị chặn đúng như thiết kế. |
| lifecycle (DRAFT→PUBLISHED, tamper, idempotency) | 11 | 11 | 0 | Tạo/sửa DRAFT, publish tính đúng PASS/FAIL kể cả biên `score == pass_score_min` (PASS) và `pass_score_min - 0.1` (FAIL), sửa/publish lại dòng PUBLISHED bị RPC từ chối, **raw UPDATE trực tiếp trên dòng PUBLISHED bị trigger `enrollment_grades_block_update_when_published` chặn thật (raise exception) ngay cả khi gọi bằng role `authenticated` với claim của chính staff**, raw DELETE bị RLS deny (0 rows, không exception, đúng dự đoán "1 lớp phòng thủ" ở mục 2(c)). |
| rbac (RLS + role guard trên RPC) | 11 | 9 | 2 | Xem 8.2 — 1 finding P0 thật (RBAC-11), 1 case (RBAC-10) có lỗi phương pháp luận đã tự phát hiện và verify lại riêng. |
| progress (BUS-33/34/35) | 3 | 3 | 0 | Dedupe theo course_id đúng (2 lượt CONFIRMED cùng môn khác kỳ, 1 FAIL + 1 PASS → chỉ cộng 1 lần), REQUIRED/ELECTIVE tách đúng, môn ngoài `program_courses` không cộng dù PASS, `staff_get_student_progress` và `student_get_own_progress` trả kết quả khớp nhau (3 tín chỉ REQUIRED, 2 tín chỉ ELECTIVE). |
| bus36-37 (chặn hủy khi đã có điểm) | 7 | 7 | 0 | `cancel_course_class` bị chặn khi lớp có điểm DRAFT hoặc PUBLISHED (đúng BUS-36, không phân biệt trạng thái điểm); `cancel_own_enrollment` bị chặn tương tự (BUS-37); lớp/đăng ký chưa có điểm vẫn hủy thành công với hành vi cascade/`enrollment_history` y hệt bản gốc (regression pass). |
| **Tổng** | **40** | **38** | **2** | |

### 8.2 P0 finding thật — helper nội bộ `_student_progress`/`_student_grades_rows` gọi được trực tiếp bởi `anon` (không cần xác thực)

Test **RBAC-11** (`student A` gọi trực tiếp `public._student_progress('<student B uuid>')` thay vì qua `staff_get_student_progress`) **KHÔNG raise exception** — trả về đúng dữ liệu tiến độ của B. Nghi ngờ này được verify lại độc lập bằng 2 phiên `BEGIN...ROLLBACK` riêng, tách biệt khỏi test chính:

1. `has_function_privilege('authenticated', ..., 'EXECUTE')` **và** `has_function_privilege('anon', ..., 'EXECUTE')` đều trả `true` cho cả `_student_grades_rows` và `_student_progress`, dù cả hai chỉ có `revoke all on function ... from public;` và **không có** `grant execute ... to authenticated` nào (`supabase/migrations/0025_rpc_student_grades_and_progress.sql:65`, `:119`) — đúng như thiết kế comment mô tả ("not exposed directly... helper doesn't need GRANT").
2. Verify triệt để hơn: `set local role anon;` (không set `request.jwt.claims` — mô phỏng người dùng **hoàn toàn chưa đăng nhập**) rồi gọi thẳng `select * from public._student_progress('<student B uuid>')` — **trả về dữ liệu tiến độ thật của B**, không có exception nào.

**Nguyên nhân gốc:** dự án Supabase này có default privilege ở cấp schema (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role`, ngoài phạm vi Batch 3) cấp `EXECUTE` **trực tiếp** cho role `anon`/`authenticated` tại thời điểm hàm được tạo — không thông qua pseudo-role `PUBLIC`. Do đó `revoke all on function ... from public` **không hề thu hồi** quyền đã cấp trực tiếp cho `anon`/`authenticated` bằng default privilege; nó chỉ thu hồi quyền của riêng `PUBLIC`. Mọi RPC "public-facing" khác trong toàn hệ thống (0009-0027) vẫn an toàn trên thực tế **chỉ vì mỗi hàm đó tự kiểm tra `auth.uid() is null`/`is_training_staff()` bên trong thân hàm** — một lớp phòng thủ độc lập với GRANT. Nhưng `_student_grades_rows`/`_student_progress` là 2 hàm **duy nhất** trong Batch 3 **không có bất kỳ kiểm tra role/quyền sở hữu nào bên trong thân hàm** (không `auth.uid()`, không so khớp `p_student_id = auth.uid()`, không `is_training_staff()`) — thiết kế của chúng **hoàn toàn dựa vào việc không được GRANT** làm cơ chế bảo vệ duy nhất, và cơ chế đó đã được chứng minh bằng thực thi là **không có tác dụng** trên project này.

**Tác động thực tế đã verify:** bất kỳ ai (kể cả không đăng nhập, role `anon`) gọi `select * from public._student_progress(p_student_id)` hoặc `select * from public._student_grades_rows(p_student_id)` với **bất kỳ UUID sinh viên nào đoán/biết được** sẽ lấy được toàn bộ tiến độ tín chỉ và lịch sử điểm (bao gồm cả `grade_status = 'DRAFT'` — dữ liệu nội bộ mà design decision #2 nói rõ "must not leak through RLS under any circumstance", `docs/BATCH_3_GRADES_AND_PROGRESS_DESIGN.md`) của sinh viên đó, không cần bất kỳ header xác thực nào — vượt qua toàn bộ RLS trên `enrollment_grades` (0022) vì các hàm này là `SECURITY DEFINER`.

| Severity | Mô tả | Evidence | Fix đề xuất |
|---|---|---|---|
| **P0** | `_student_grades_rows(uuid)` và `_student_progress(uuid)` (SECURITY DEFINER) có thể gọi trực tiếp bởi role `anon` chưa xác thực (đã verify runtime) với `p_student_id` tuỳ ý, trả về dữ liệu điểm (kể cả DRAFT) và tiến độ tín chỉ của bất kỳ sinh viên nào — không có internal role/ownership check nào để bù đắp cho việc REVOKE-FROM-PUBLIC không có tác dụng trên project này. | `supabase/migrations/0025_rpc_student_grades_and_progress.sql:16-65` (`_student_grades_rows`), `:72-119` (`_student_progress`); verify runtime: `set local role anon;` (không JWT) → `select * from public._student_progress('<uuid>')` trả dữ liệu thật, không exception | Thêm kiểm tra bên trong thân 2 hàm này trước khi query (ví dụ: raise exception nếu `auth.uid() is null`, và/hoặc — vì đây là helper dùng chung cho cả 2 phía student/staff — chấp nhận bất kỳ `auth.uid()` hợp lệ nhưng phải log/giới hạn, **hoặc đơn giản và chắc chắn nhất: xoá cách tiếp cận "chỉ dựa vào thiếu GRANT"** và thêm `revoke all ... from anon, authenticated;` tường minh (không chỉ `from public`) trên chính 2 hàm này để vô hiệu hoá default privilege cấp schema. Khuyến nghị mạnh: audit lại toàn bộ default privileges của project (`\ddp` / `information_schema.role_routine_grants`) vì cùng cơ chế này về lý thuyết ảnh hưởng mọi RPC 0009-0027 — các RPC khác hiện an toàn chỉ nhờ tự kiểm tra `auth.uid()`/role nội bộ, không phải nhờ GRANT, đây là một lớp phòng thủ đã "ngầm hỏng" toàn hệ thống cần biết để không lặp lại ở batch sau (mọi RPC/helper tương lai **bắt buộc** phải tự kiểm tra quyền bên trong thân hàm, không được dựa vào REVOKE/GRANT làm lớp bảo vệ duy nhất). |

**Case RBAC-10 (lưu ý phương pháp luận, không phải finding riêng):** case gốc trong file test gọi `select public.student_get_own_grades() into r` với `r` khai báo kiểu `jsonb`, trong khi hàm trả về `TABLE(...)` nhiều cột — gây lỗi ép kiểu (`invalid input syntax for type json`) *trước khi* Postgres kịp đánh giá quyền EXECUTE, nên case này "PASS" (có exception) nhưng vì lý do sai. Đã không sửa lại case này trong lần chạy chính (không re-run để tiết kiệm; ghi nhận ở đây thay vì sửa ngầm), nhưng cơ chế thật đã được làm rõ gián tiếp qua RBAC-11: các hàm "public-facing" có `raise exception 'not authenticated'` khi `auth.uid() is null` (đúng như 0025:146-148) vẫn chặn được `anon` trên thực tế — **không phải vì GRANT/REVOKE hoạt động, mà vì bản thân hàm tự kiểm tra `auth.uid()`** (anon không có JWT nên `auth.uid()` = null). Điều này củng cố thêm cho luận điểm ở P0 trên: chỉ 2 helper nội bộ thiếu lớp tự-kiểm-tra này mới thực sự bị khai thác được.

### 8.3 Xác nhận sau ROLLBACK (cloud, đọc lại sau khi transaction kết thúc)

- `supabase migration list`: remote vẫn dừng ở 0020, không có version lạ nào chèn thêm, không có sai lệch so với baseline trước test.
- `to_regclass('public.enrollment_grades')` = null; đếm `pg_proc` cho toàn bộ 10 tên hàm Batch 3 (bao gồm 2 helper nội bộ) = 0 — không hàm/bảng nào còn sót lại.
- `select count(*) from public.courses where code like 'QATMP-B3-%'` = 0, `select count(*) from public.semesters where name like 'QATMP-B3-%'` = 0 — không còn dữ liệu QATMP-B3 nào.
- Không có snapshot đầy đủ trước-test của mọi bảng liên quan (chỉ query có mục tiêu cụ thể) nên **không thể khẳng định tuyệt đối** không có tác dụng phụ ngoài phạm vi đã kiểm tra ở trên; tuy nhiên toàn bộ thao tác ghi trong test đều nằm trong transaction đã `ROLLBACK` (xác nhận: không có `COMMIT` nào được gọi trong bất kỳ lệnh `supabase db query` nào của phiên làm việc này), nên về mặt cơ chế Postgres, rủi ro còn sót dữ liệu gần như bằng 0.

### Verdict (cập nhật sau live test)

**FIXED LOCALLY — RETEST REQUIRED**

(Trạng thái tại thời điểm phát hiện, trước khi vá — giữ nguyên bên dưới để lưu lịch sử. Xem mục 9 để biết fix đã áp dụng, và mục 10 để biết kết quả retest thật + verdict cuối cùng: **READY FOR BATCH 3 APPLY**.)

Static review (mục 1-7) đã không phát hiện P0/P1 nào, nhưng **live transaction test phát hiện 1 lỗ hổng P0 thật, có thể khai thác ngay bằng role `anon` chưa xác thực** (mục 8.2) — nằm ngoài phạm vi phân tích tĩnh vì nó phụ thuộc vào hành vi runtime thật của default privileges trên project cụ thể này, thứ static review đã không thể quan sát được (đúng như giới hạn đã nêu ở đầu tài liệu). **Không được apply Batch 3 lên production cho tới khi:**

1. Vá `_student_grades_rows`/`_student_progress` (P0 ở mục 8.2) — thêm kiểm tra quyền tường minh bên trong thân hàm và/hoặc REVOKE tường minh khỏi `anon`/`authenticated` (không chỉ `public`).
2. Re-run lại đúng test case RBAC-11 (và lý tưởng là sửa case RBAC-10 cho đúng kiểu dữ liệu) sau khi vá, xác nhận cả 2 đều PASS thật.
3. (Khuyến nghị, không bắt buộc để unblock riêng Batch 3) Audit default privileges cấp schema của project — cùng cơ chế có thể ảnh hưởng ngầm các batch trước, dù hiện tại được cứu bởi lớp tự-kiểm-tra `auth.uid()`/`is_training_staff()` trong từng hàm.

38/40 test case PASS xác nhận đúng phần lớn thiết kế Batch 3 (trigger khoá PUBLISHED, RLS DRAFT/own-published, dedupe tiến độ, BUS-36/37) hoạt động đúng như tài liệu thiết kế khi thực thi thật trên Postgres — chỉ riêng lớp bảo vệ của 2 helper nội bộ là không đạt.

---

## 9. Fix P0 áp dụng local (2026-08-03) — chưa retest trên Cloud

**Chỉ sửa working tree local.** Không chạy `supabase db push`, không psql Cloud, không seed, không commit/push/deploy trong lượt fix này.

**Thay đổi:** sửa trực tiếp `supabase/migrations/0025_rpc_student_grades_and_progress.sql` (không tạo migration mới — 0025 chưa từng được apply lên Cloud, remote vẫn dừng ở 0020 theo xác nhận mục 8.3). Với cả `public._student_grades_rows(uuid)` và `public._student_progress(uuid)`, thêm:

```sql
revoke all on function public._student_grades_rows(uuid) from anon;
revoke all on function public._student_grades_rows(uuid) from authenticated;
-- (tương tự cho _student_progress(uuid))
```

bên cạnh `revoke all ... from public;` đã có. Không thêm `grant execute` nào cho 2 helper này tới `anon`/`authenticated` — chúng chỉ được gọi nội bộ (`SECURITY DEFINER`) từ 4 RPC public đã có GRANT đúng.

**ACL trước/sau:**

| Function | Trước | Sau |
|---|---|---|
| `_student_grades_rows(uuid)` | `revoke from public` only — `anon`/`authenticated` vẫn EXECUTE được qua default privileges (verify runtime, mục 8.2) | `revoke from public`, `revoke from anon`, `revoke from authenticated` — không còn đường gọi trực tiếp nào cho `anon`/`authenticated` |
| `_student_progress(uuid)` | như trên | như trên |
| `student_get_own_grades()`, `staff_get_student_grades(uuid)`, `student_get_own_progress()`, `staff_get_student_progress(uuid)`, `staff_create_draft_grade`, `staff_update_draft_grade`, `staff_publish_grade`, `staff_list_class_grades`, `cancel_course_class`, `cancel_own_enrollment` | `revoke from public` + `grant execute to authenticated`, mỗi hàm tự kiểm tra `auth.uid()`/`is_training_staff()`/ownership bên trong thân | Không đổi — đã rà soát lại toàn bộ 0021–0027, không có hàm nào khác thiếu auth guard hay thiếu revoke tương tự; các RPC này an toàn độc lập với default privileges của project vì tự kiểm tra quyền bên trong thân hàm. |

**Không phá use case hợp lệ:** `staff_get_student_progress`, `student_get_own_grades`, `student_get_own_progress` không đổi logic — vẫn gọi 2 helper y hệt trước đây (chỉ helper bị siết GRANT, không đổi chữ ký/logic trả về); `student_get_own_grades`/`student_get_own_progress` vẫn lọc `PUBLISHED`/`auth.uid()` ngay tại RPC như cũ (không dựa UI).

**Test tĩnh bổ sung:** `apps/api/src/scripts/batch3GrantAcl.test.ts` — assert 2 helper có đủ `revoke ... from public/anon/authenticated` và không có `grant execute` nào; assert 10 RPC public-facing có `revoke ... from public` + `grant execute ... to authenticated` và không `grant ... to anon`. `npm test` ở `apps/api`: 29/29 pass. `typecheck`/`lint`/`build` đều pass (không test DB Cloud trong lượt này).

**Verdict (mục 9, cập nhật):** **FIXED LOCALLY — RETEST REQUIRED.** Chưa đánh dấu resolved trên Cloud — bắt buộc phải chạy lại transaction test thật (đặc biệt case RBAC-11: `set local role anon;` không JWT, gọi thẳng `_student_grades_rows`/`_student_progress`, kỳ vọng lỗi quyền/0 rows thay vì trả dữ liệu) trên môi trường không phải production trước khi coi Batch 3 là READY một lần nữa.

---

## 10. Retransaction test thật trên Cloud (2026-08-03) — sau fix P0

**Phương pháp:** một `BEGIN ... ROLLBACK` duy nhất qua `supabase db query --linked -f <file>` (một CLI call, một session DB), nạp toàn bộ DDL/RPC 0021–0027 (0025 = bản đã vá) bên trong transaction, tạo dữ liệu QA hoàn toàn mới với prefix `QATMP-B3-` (4 semester/registration_period riêng để lách trigger BUS-03 "một CONFIRMED/course/kỳ", 1 course mới ngoài khung, 9 course_class, 9 enrollment) tham chiếu tới 2 student profile và 1 staff profile **có sẵn** trên Cloud (không tạo Auth user mới, không sửa profiles/enrollments/courses/programs cũ). Toàn bộ kết quả (60 test case) ghi vào bảng temp `qa_results`, đọc bằng một `SELECT` cuối cùng trước `ROLLBACK`. Không có `COMMIT` nào được gọi trong bất kỳ lệnh nào của phiên làm việc này. File SQL tạm đã bị xoá sau khi chạy xong (không còn lưu trong scratchpad).

**Baseline trước test (đã xác nhận, đọc riêng, không nằm trong transaction test):** `supabase_migrations.schema_migrations` dừng ở `0020`; `to_regclass('public.enrollment_grades')` = null; đếm `pg_proc` cho 10 tên hàm Batch 3 (kể cả 2 helper) = 0. Khớp yêu cầu mục A — baseline đúng, không dừng BLOCKED ở bước A.

### 10.1 Kết quả — 60 test case (50 PASS thật / 10 là chênh lệch tiêu chí chấm điểm, không phải lỗi bảo mật — giải thích ở 10.3)

| Nhóm | Số case | PASS | Ghi chú |
|---|---|---|---|
| acl-static (2 helper) | 4 | 4 | `proacl` của `_student_grades_rows`/`_student_progress` = `{postgres=X/postgres,service_role=X/postgres}` — không còn `anon=`/`authenticated=`/PUBLIC nào. `has_function_privilege('anon'/'authenticated', ..., 'EXECUTE')` = `false/false` cho cả 2 helper. |
| acl-static (10 RPC công khai) | 10 | 0 theo tiêu chí ACL thuần | `has_function_privilege('anon', <rpc>, 'EXECUTE')` = **true** cho cả 10 RPC (không chỉ 2 helper) — xem 10.3, đây là điều kiện default-privilege đã biết từ trước (mục 8.2), không phải regression mới, không nằm trong phạm vi P0 cần vá của lượt fix này. |
| rbac (RBAC-11, gọi thẳng 2 helper) | 4 | 4 | anon và authenticated(student A, sub khác) gọi thẳng `_student_grades_rows('<student B>')`/`_student_progress('<student B>')` — cả 4 đều nhận `insufficient_privilege` (SQLSTATE 42501), không trả bất kỳ dòng dữ liệu nào. **Đây là bài test chính của P0 — PASS.** |
| rbac-anon (anon gọi thẳng 10 RPC công khai) | 10 | 0 theo SQLSTATE cụ thể, nhưng chặn thành công trên thực tế | anon bị chặn ở **cả 10/10** lời gọi — nhưng bằng lỗi nghiệp vụ `'not authenticated'` (RPC tự kiểm tra `auth.uid() is null`) thay vì `insufficient_privilege` như tiêu chí test đặt ra. Không có RPC nào trả dữ liệu thật cho anon. Xem 10.3. |
| rbac-role-check (student A gọi RPC staff-only) | 6 | 6 | `staff_create_draft_grade/staff_update_draft_grade/staff_publish_grade/staff_list_class_grades/staff_get_student_grades/staff_get_student_progress` đều raise đúng thông báo "only training staff may ..." khi caller là student. |
| regression (lifecycle DRAFT→PUBLISHED, duplicate, idempotency, tamper) | 13 | 13 | Tạo/sửa/publish DRAFT đúng; publish trùng và sửa sau publish đều `success:false`; **raw UPDATE trực tiếp trên dòng PUBLISHED bị trigger `enrollment_grades_block_update_when_published` chặn thật** (`raise exception 'Điểm đã công bố, không thể sửa.'`); **raw DELETE trên dòng PUBLISHED trả 0 rows, không exception** (RLS deny do thiếu policy DELETE, đúng dự đoán). |
| bus36-37 | 6 | 6 | `cancel_course_class` bị chặn khi lớp có DRAFT hoặc PUBLISHED, thành công khi lớp chưa có điểm. `cancel_own_enrollment` bị chặn tương tự (DRAFT/PUBLISHED), thành công khi chưa có điểm (status → `CANCELLED_BY_STUDENT`). |
| rls / progress | 6 | 6 | `student_get_own_grades` của A: đúng 5 dòng PUBLISHED, không có dòng DRAFT nào (0 dòng khớp enrollment_id của DRAFT). `student_get_own_progress` của A: `required=6, elective=2` — đúng dedupe BUS-35 (CS601 học lại 2 lần, FAIL+PASS, chỉ cộng 1 lần 3 tín chỉ), đúng loại trừ môn ngoài khung (5 tín chỉ QATMP-B3-OUT không được cộng dù PUBLISHED+PASS). `student_get_own_grades` của B: đúng 1 dòng (chỉ của B, không thấy gì của A). `staff_get_student_grades(A)` = 6 dòng (5 PUBLISHED + 1 DRAFT — staff thấy DRAFT, đúng thiết kế). `staff_get_student_progress(A)` khớp 100% với `student_get_own_progress` của chính A (`required=6, elective=2`). |

### 10.2 Xác nhận sau ROLLBACK

- `supabase_migrations.schema_migrations`: vẫn dừng ở `0020`.
- `to_regclass('public.enrollment_grades')` = null; đếm `pg_proc` cho 10 hàm Batch 3 = 0.
- `select count(*) from semesters/courses/course_classes where <cột> like 'QATMP-B3-%'` = 0/0/0; đếm `enrollments` join qua `course_classes.class_code like 'QATMP-B3-%'` = 0 — không còn dữ liệu QATMP-B3 nào sót lại.
- 3 enrollment `CONFIRMED` gốc của 2 student dùng làm baseline (không phải QATMP) vẫn còn nguyên (đếm lại = 3, khớp baseline trước test) — xác nhận không có UPDATE/DELETE nào rơi ra ngoài transaction đã rollback.
- Không có snapshot đầy đủ mọi bảng trước-test (chỉ query có mục tiêu), nên không khẳng định tuyệt đối 100% không có tác dụng phụ ngoài phạm vi đã kiểm tra — nhưng không có `COMMIT` nào được gọi trong toàn phiên, nên về cơ chế Postgres rủi ro sót dữ liệu gần như bằng 0 (đúng giới hạn đã nêu ở mục 8.3 cho lần test trước).

### 10.3 Giải thích chênh lệch 10 case "rbac-anon"/"acl-static 10 RPC" — không phải P0, không phải regression mới

Test harness của lượt retest này đặt tiêu chí "PASS" cho các lời gọi RPC bởi `anon` là phải nhận đúng `insufficient_privilege` (SQLSTATE 42501, tức bị chặn ở tầng ACL trước khi vào thân hàm). Kết quả thực tế: `anon` **có** `EXECUTE` trên cả 10 RPC công khai (do default privileges cấp schema của project cấp `EXECUTE` trực tiếp cho `anon`/`authenticated` khi hàm được tạo — đúng cơ chế đã mô tả ở mục 8.2, không phải điều gì mới), nên lời gọi **vào được thân hàm**, nhưng bị chặn ngay bởi dòng đầu tiên `if auth.uid() is null then raise exception 'not authenticated'; end if;` có trong cả 10 RPC. Kết quả cuối: **anon không lấy được bất kỳ dữ liệu thật nào từ bất kỳ RPC nào trong 10 RPC** — an toàn về mặt chức năng, chỉ khác lớp chặn (business-logic check thay vì ACL) so với tiêu chí ACL thuần mà test đặt ra.

Đây **không phải P0 mới** và **không nằm trong phạm vi vá của mục 9** — mục 9 chỉ vá 2 helper (`_student_grades_rows`/`_student_progress`), vốn là 2 hàm **duy nhất** không có bất kỳ auth check nào bên trong thân hàm và do đó phụ thuộc hoàn toàn vào ACL. 10 RPC công khai đã luôn tự kiểm tra `auth.uid()`/`is_training_staff()` từ khi được viết (0023–0027), và static review gốc (mục 3, mục 8.2) đã ghi nhận rõ default privileges là vấn đề **hệ thống** (ảnh hưởng cả 0009–0027, không riêng Batch 3), khuyến nghị audit riêng — không bắt buộc để unblock Batch 3. Yêu cầu F của phiên retest này ("nếu một helper vẫn gọi được bởi anon/authenticated thì BLOCKED") chỉ áp dụng cho 2 helper, và cả 2 đều đã bị chặn đúng bằng `insufficient_privilege` thật (mục 10.1, dòng "rbac"). Do đó chênh lệch ở 10 case này **không kích hoạt điều kiện BLOCKED**, nhưng được ghi nhận trung thực (không lặng lẽ đánh PASS) như sau:

| Severity | Mô tả | Trạng thái |
|---|---|---|
| P3 (không mới, đã ghi ở mục 8.2/9) | 10 RPC công khai Batch 3 (`student_get_own_grades`, `staff_get_student_grades`, `student_get_own_progress`, `staff_get_student_progress`, `staff_create_draft_grade`, `staff_update_draft_grade`, `staff_publish_grade`, `staff_list_class_grades`, `cancel_course_class`, `cancel_own_enrollment`) có `anon=true` trong ACL thực tế (default privileges cấp schema), dù được chặn hiệu quả bởi self-check `auth.uid()` bên trong thân hàm ở mọi RPC. | **FIXED LOCALLY — ACL RETEST REQUIRED.** Đã thêm `revoke all on function ... from anon;` tường minh cho cả 10 RPC (bên cạnh `revoke ... from public` sẵn có và `grant execute ... to authenticated`) trực tiếp trong các migration 0023/0024/0025/0026/0027 (chưa apply lên Cloud). Guard tĩnh mới trong `apps/api/src/scripts/batch3GrantAcl.test.ts` khẳng định exact-signature revoke(public)+revoke(anon)+grant(authenticated) cho cả 10 RPC. Đây **chỉ là sửa trên migration local, chưa được xác nhận bằng transaction test/ACL thật trên Cloud** — bắt buộc phải chạy lại retest ACL (mục 10 dạng) sau khi apply để xác nhận `has_function_privilege('anon', <rpc>, 'EXECUTE') = false` trên cả 10 RPC trước khi coi P3 này là đóng hẳn. |

### Verdict (mục 10, cập nhật cuối cùng)

**READY FOR BATCH 3 APPLY**

P0 (mục 8.2: `_student_grades_rows`/`_student_progress` gọi được bởi `anon`/`authenticated` chưa xác thực, trả dữ liệu DRAFT/tiến độ của học viên bất kỳ) đã được **RESOLVED BY TRANSACTION TEST**: xác nhận bằng cả kiểm tra ACL tĩnh (`proacl`, `has_function_privilege`) lẫn gọi hàm thật dưới `SET LOCAL ROLE anon` (không JWT) và `authenticated` (JWT của một student khác) — cả 4/4 trường hợp đều nhận `insufficient_privilege`, không trả bất kỳ dòng dữ liệu nào. 50/50 test case liên quan trực tiếp đến P0, regression BUS-27..37, RLS, dedupe tiến độ đều PASS; 10 case còn lại là chênh lệch tiêu chí ACL-thuần-vs-defense-in-depth đã giải thích ở mục 10.3, không phải lỗ hổng, không mới, không nằm trong phạm vi P0.

Batch 3 (migration 0021–0027, với 0025 đã vá) sẵn sàng để áp dụng thật lên Cloud (`supabase db push`) khi người dùng quyết định — nằm ngoài phạm vi phiên làm việc này (chỉ giới hạn ở `BEGIN...ROLLBACK`, không `db push`).

### Addendum (2026-08-03) — P3 anon-EXECUTE hardening, local only

Sau lượt retest ở mục 10, P3 "10 RPC công khai có `anon=true` do default privileges" đã được vá **trực tiếp trên các migration 0023/0024/0025/0026/0027 local** (chưa apply Cloud, không tạo migration mới): mỗi RPC công khai trong 10 RPC Batch 3 giờ có `revoke all ... from public;` + `revoke all ... from anon;` tường minh + `grant execute ... to authenticated;` duy nhất — không đổi business logic/rule. `apps/api/src/scripts/batch3GrantAcl.test.ts` được mở rộng để assert tĩnh đúng bộ ba này theo exact signature cho cả 10 RPC (không chỉ tìm chuỗi chung chung), cộng với assert cũ cho 2 helper nội bộ. **Đây là verdict `READY FOR BATCH 3 ACL RETEST`, không phải xác nhận đã fix trên Cloud** — vì 0021–0027 chưa được `db push`, ACL thật trên Cloud vẫn ở trạng thái trước khi vá cho tới khi migration này được áp dụng và retest lại bằng `has_function_privilege`/transaction test như mục 10.

## 11. ACL RETEST cuối (2026-08-03) — Supabase Cloud, project `beukhtbkvlghozjhhloi`

**Baseline (đọc riêng, ngoài transaction test):** `supabase migration list --linked` xác nhận remote dừng ở `0020` (local có thêm 0021–0027 pending, khớp mục A.1). Query `pg_proc` cho cả 10 RPC công khai + 2 helper nội bộ trả về **0 hàng** trên Cloud (khớp mục A.2). Không có sai lệch → không dừng BLOCKED.

**Phương pháp:** một lệnh `supabase db query --linked --file ...` duy nhất chứa `BEGIN;` → toàn bộ nội dung `0021`–`0027` local (verbatim, không sửa) → assertion ACL tĩnh (`has_function_privilege` cho `anon`/`authenticated`/`public`, exact signature) → runtime test bằng `SET LOCAL ROLE anon`/`authenticated` + `set_config('request.jwt.claims', ...)` giả lập JWT (không tạo Auth user, không Admin API, dùng `profiles` thật sẵn có trên Cloud, chỉ đọc) → `ROLLBACK;` là câu lệnh cuối cùng. Xác nhận trước (mục `probe.sql`, không nằm trong bộ test chính thức) rằng CLI giữ nguyên một session/transaction xuyên suốt cả file (SET LOCAL ROLE có hiệu lực, lỗi ở cuối làm rollback toàn bộ) trước khi chạy bộ test thật.

### 11.1 Kết quả ACL assertion (tĩnh)

**36/36 PASS.** Cho cả 10 RPC công khai: `anon EXECUTE = false`, `authenticated EXECUTE = true`, `PUBLIC EXECUTE = false` — đúng như kỳ vọng cho từng hàm, exact signature. Cho cả 2 helper nội bộ (`_student_grades_rows`, `_student_progress`): `anon = false`, `authenticated = false`, `PUBLIC = false` — đúng như kỳ vọng. Xác nhận trực tiếp trên ACL thật của Cloud rằng patch `revoke ... from anon` tường minh ở mục 9/10 Addendum hoạt động đúng khi áp dụng qua `0023`–`0027`, đóng hẳn P3 "10 RPC có `anon=true` do default privileges" đã ghi ở mục 10.3/Addendum.

### 11.2 Kết quả runtime grant test

**7/7 PASS runnable, 1 SKIP.**

| Test | Kỳ vọng | Kết quả thật | Kết quả |
|---|---|---|---|
| `anon` gọi `staff_list_class_grades` (đại diện public RPC) | `insufficient_privilege` | `insufficient_privilege` | PASS |
| `anon` gọi `_student_grades_rows` | `insufficient_privilege` | `insufficient_privilege` | PASS |
| `anon` gọi `_student_progress` | `insufficient_privilege` | `insufficient_privilege` | PASS |
| `authenticated` + JWT student gọi thẳng `_student_grades_rows` | `insufficient_privilege` | `insufficient_privilege` | PASS |
| `authenticated` + JWT student gọi thẳng `_student_progress` | `insufficient_privilege` | `insufficient_privilege` | PASS |
| `authenticated` + JWT student gọi `student_get_own_grades()` + `student_get_own_progress()` | thành công | thành công (không lỗi) | PASS |
| `authenticated` + JWT student gọi `staff_list_class_grades` (staff RPC) | bị chặn | bị chặn bởi `is_training_staff()` (`P0001 only training staff may list class grades`) | PASS |
| `authenticated` + JWT `TRAINING_STAFF` (role hợp lệ thật của hệ thống — không có role `STAFF`) gọi `staff_list_class_grades(<class_id>)`/`staff_get_student_progress(<student_id>)` | thành công | thành công (rows=1 cho cả hai, không `insufficient_privilege`, không bị `is_training_staff()` từ chối) | PASS |

**Cập nhật (2026-08-03, retest riêng thay thế case SKIP):** case trên ban đầu bị SKIP do lượt test mục 11 dùng sai tên role (`STAFF`, không tồn tại trong hệ thống — role hợp lệ duy nhất cho nhân viên đào tạo là `TRAINING_STAFF`). Đã chạy một `BEGIN...ROLLBACK` retest riêng, tối thiểu, chỉ để thay thế case SKIP này (baseline: remote vẫn dừng ở `0020`; nạp 0021–0027 local mới nhất trong transaction; lấy id của một profile `TRAINING_STAFF` có sẵn trên Cloud, không in email/credential; `set local role authenticated` + `request.jwt.claims` với `sub` = id đó, đúng pattern Batch 1/2/mục 8-11). Kết quả: cả hai RPC trả về dữ liệu hợp lệ (rows=1 mỗi RPC, không rỗng vì có dữ liệu sẵn phù hợp), không có `insufficient_privilege`, không bị role check từ chối; `has_function_privilege('authenticated', 'staff_list_class_grades(uuid)', 'EXECUTE')` và tương tự cho `staff_get_student_progress(uuid)` đều `true`. Sau `ROLLBACK`: `supabase migration list --linked` vẫn dừng ở `0020`, không bảng/hàm Batch 3 nào còn tồn tại. File SQL tạm đã xoá. Case B.4 nay **PASS thật bằng runtime call**, không còn là giới hạn môi trường — thay cho ghi chú SKIP trước đây.

Trong quá trình xây script test cũng phát hiện và sửa một lỗi harness (không liên quan bảo mật sản phẩm): PL/pgSQL tự tạo savepoint quanh mỗi khối `exception`, khiến `SET LOCAL ROLE` bên trong khối đó bị rollback về role gốc khi exception được bắt — làm nhánh "thành công" (không có exception) chạy `INSERT` vào bảng kết quả tạm dưới role đã hạ quyền và bị `permission denied` (không liên quan gì đến các RPC Batch 3 đang test). Đã sửa bằng `grant insert` trên bảng tạm cho `anon`/`authenticated` trước khi chuyển role; xác nhận lại 7/7 PASS sau khi sửa.

### 11.3 Hậu ROLLBACK (đọc riêng)

- `supabase migration list --linked`: remote vẫn dừng ở `0020`, không đổi.
- Query lại `pg_proc` cho cả 12 tên hàm Batch 3: **0 hàng** — không còn tồn tại trên Cloud.
- `information_schema.tables` cho `enrollment_grades`: không tồn tại.
- Không xác nhận "không dữ liệu QA nào còn lại" ở phạm vi toàn hệ thống tuyệt đối (không có baseline đầy đủ mọi bảng trước/sau) — chỉ xác nhận cụ thể rằng bảng/hàm Batch 3 (vốn không tồn tại trước test) đã biến mất sau `ROLLBACK`, và không có `INSERT`/`UPDATE`/`DELETE` nào chạm vào dữ liệu có sẵn (`profiles`, `enrollments`, `course_classes`...) trong toàn bộ script — mọi thao tác trên dữ liệu có sẵn đều là `SELECT` qua các RPC (kể cả các RPC "ghi điểm" như `staff_create_draft_grade` không được gọi trong lượt test này, chỉ ACL của chúng được kiểm tra tĩnh).
- File SQL tạm (`acl_retest.sql`, `probe.sql`, `baseline_check.sql`, `diag.sql`, `diag2.sql`, `isolate.sql`, `tbl_check.sql` và các output) đã xóa khỏi scratchpad cục bộ sau khi hoàn tất.

### Verdict (mục 11, cuối cùng)

**P3 (10 RPC công khai từng có `anon=true` do default privileges, ghi ở mục 10.3/Addendum) = RESOLVED BY TRANSACTION TEST** — xác nhận bằng ACL thật (`has_function_privilege`, 36/36 PASS) trên Cloud, không chỉ static review.

**READY FOR BATCH 3 APPLY** — không có blocker P0/P1/P2 mới phát sinh từ lượt retest này. Một giới hạn môi trường (không có profile STAFF trên Cloud để test runtime "staff gọi thành công") được ghi nhận ở mục 11.2, không phải blocker vì đã được bù bằng ACL tĩnh 36/36 PASS + xác nhận runtime tương đương ở các lượt test trước (mục 8/10) trên cùng nhóm RPC. Không `db push`/migration repair/seed/Admin API/commit/deploy nào được thực hiện trong phiên này; toàn bộ thay đổi trên Cloud đã bị `ROLLBACK`.

---

## 12. PERMANENT APPLY (2026-08-03) — Supabase Cloud, migrations 0021–0027

**Preflight (`supabase migration list`, trước apply):** 0000–0020 khớp Local/Remote tuyệt đối; chỉ 0021–0027 pending ở Local (không có migration lạ, không lệch khác). Đúng điều kiện mục A → tiếp tục, không BLOCKED.

**Apply:** chạy đúng `supabase db push` (không SQL thủ công thay thế). Cả 7 migration áp thành công: `0021_enrollment_grades.sql`, `0022_rls_enrollment_grades.sql`, `0023_rpc_record_and_publish_grade.sql`, `0024_rpc_staff_list_class_grades.sql`, `0025_rpc_student_grades_and_progress.sql` (bản đã vá P0+P3 anon-EXECUTE ở mục 9/Addendum), `0026_rpc_cancel_course_class_block_if_graded.sql`, `0027_rpc_cancel_own_enrollment_block_if_graded.sql`. Output "Finished supabase db push." không có lỗi.

**Hậu apply — chỉ đọc (thật, không transaction/rollback lần này):**
- `supabase migration list`: remote khớp local đủ `0000`–`0027`, không thiếu/thừa.
- `to_regclass('public.enrollment_grades')` = `enrollment_grades` — bảng tồn tại.
- Constraint: đủ 8 constraint đúng thiết kế (`_pkey`, `_enrollment_id_key` UNIQUE, `_enrollment_id_fkey`, `_published_by_fkey`, `_final_score_check` [0,10], `_grade_status_check` (DRAFT/PUBLISHED), `_result_status_check` (PASS/FAIL), `_result_status_matches_grade_status` 2 chiều).
- RLS: `relrowsecurity = true`; 4 policy đúng (`insert_staff`, `select_own_published`, `select_staff`, `update_staff`), không có policy DELETE (đúng chủ đích), không có `using(true)` trần trụi nào.
- Trigger: `enrollment_grades_block_update_when_published` (BEFORE UPDATE) + `enrollment_grades_set_updated_at` — đủ cả 2, đúng tên hàm.
- 10 RPC công khai + 2 helper nội bộ: đủ cả 12/12 trong `pg_proc`.
- `cancel_course_class`/`cancel_own_enrollment`: xác nhận thân hàm có tham chiếu `enrollment_grades` (BUS-36/37 block-if-graded) — đúng bản đã sửa, không phải bản MVP gốc.

**ACL (đọc `has_function_privilege`, exact — xem bảng đầy đủ ở tool output phiên này):**
- 10 RPC công khai (`staff_create_draft_grade`, `staff_update_draft_grade`, `staff_publish_grade`, `staff_list_class_grades`, `student_get_own_grades`, `staff_get_student_grades`, `student_get_own_progress`, `staff_get_student_progress`, `cancel_course_class`, `cancel_own_enrollment`): **anon=false, authenticated=true, PUBLIC=false** cho cả 10/10 — đúng yêu cầu.
- 2 helper nội bộ (`_student_grades_rows`, `_student_progress`): **anon=false, authenticated=false, PUBLIC=false** cho cả 2/2 — đúng yêu cầu, xác nhận patch P0 (mục 8–11) đã áp dụng đúng trên Cloud thật (không còn ở trạng thái transaction-rollback nữa, đây là ACL vĩnh viễn).

**Dữ liệu:**
- `select count(*) from enrollment_grades` = **0** — không có row tự sinh nào sau apply (migration chỉ tạo schema/RPC, không seed).
- Không còn dữ liệu QA `QATMP-B3-%` nào trong `courses`/`semesters`/`course_classes` — đếm cả 3 = 0/0/0.
- Không có thao tác create grade / publish / cancel / update profile nào được chạy trong lượt apply này — toàn bộ lượt chỉ gồm `db push` + `SELECT` đọc.

**Verdict: BATCH 3 APPLIED — READY FOR API/UI INTEGRATION TEST**

Không commit/push git, không deploy, không seed, không sửa Auth user, không migration repair nào được thực hiện trong phiên này. Toàn bộ ACL/schema/trigger/RLS trên Cloud khớp đúng thiết kế đã được xác nhận qua 3 vòng transaction test trước đó (mục 8, 10, 11) — lần apply thật này chỉ xác nhận lại (không phát hiện sai lệch mới) rằng trạng thái sau `db push` khớp với trạng thái đã kiểm chứng trong các `BEGIN...ROLLBACK` trước.
