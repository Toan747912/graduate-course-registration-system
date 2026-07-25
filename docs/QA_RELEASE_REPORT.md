# QA Release Report — graduate-course-registration-system

Ngày thực hiện: 2026-07-25
Người thực hiện: Claude Code (QA session, read-only đối với dữ liệu nghiệp vụ)
Môi trường: Windows 11, Node v22.22.0, npm 11.10.0, Supabase CLI 2.90.0, Supabase Cloud (project ref không in ở đây)

Phạm vi: đánh giá mức sẵn sàng deploy hiện tại. Không sửa code, không sửa migration, không thay đổi dữ liệu cloud, không tạo secret mới.

**Cập nhật 2026-07-25 (phiên riêng, có user approval rõ ràng):** đã thực hiện repair migration tracking cho `0012` (`supabase migration repair --status applied 0012`) sau khi verify read-only rằng function remote khớp hoàn toàn với file local. Không sửa code/migration file, không chạy `db push`, không chạy `psql`, không tạo/xóa dữ liệu. Xem chi tiết ở mục 3 và mục 7.

---

## 1. Build quality

| Lệnh | Kết quả | Ghi chú |
|---|---|---|
| `npm install` | PASS | "up to date, audited 364 packages". 15 vulnerabilities báo bởi `npm audit` (3 moderate, 12 high) — **toàn bộ nằm trong dev-tooling** (`eslint`/`minimatch`/`brace-expansion` transitive, `concurrently`, `esbuild` dev-server). Không có vulnerability nào trong runtime dependencies (`express`, `@supabase/supabase-js`, `react`, `zod`, `cors`, `dotenv`). Không chạy `npm audit fix` (nằm ngoài scope, có thể đổi version breaking). |
| `npm run typecheck` | PASS | `tsc --noEmit` sạch cho cả `apps/api` và `apps/web`, không có lỗi. |
| `npm run lint` | PASS (1 warning) | `apps/api`: 0 vấn đề. `apps/web`: 1 warning tại `apps/web/src/context/AuthContext.tsx:82` — `react-refresh/only-export-components` (Fast Refresh chỉ hoạt động tốt nếu file chỉ export component). Không phải lỗi, không ảnh hưởng production build. |
| `npm run build` | PASS | `apps/api`: `tsc -p tsconfig.json` thành công. `apps/web`: `tsc --noEmit && vite build` thành công — output `dist/index.html`, `dist/assets/index-*.css` (5.71 kB), `dist/assets/index-*.js` (409.20 kB, gzip 116.45 kB). |
| `npm test` (root) | **KHÔNG TỒN TẠI** | Root `package.json` không định nghĩa script `test`. `apps/api/package.json` cũng không có script test. |
| `npm run test --workspace apps/web` (vitest) | PASS | 1 test file (`apps/web/src/lib/enrollmentMatching.test.ts`), 3/3 test pass, 317ms. |

**Không tìm thấy lỗi hay warning nào bị bỏ qua.** Toàn bộ warning/lỗi liệt kê ở trên là đầy đủ.

---

## 2. Configuration & secret hygiene

| Hạng mục | Kết quả |
|---|---|
| `.gitignore` loại trừ `.env`, `.env.local`, `apps/web/.env`, `apps/api/.env`, `dist/`, `build/`, `supabase/.temp/` | PASS |
| `.env.example` (root, `apps/web`, `apps/api`) chỉ chứa tên biến, giá trị rỗng, không có secret thật | PASS |
| Xác nhận `.env` thật không bị git track | **KHÔNG THỂ XÁC MINH QUA GIT** — thư mục `graduate-course-registration-system/` hiện **không phải git repository** (`git status` báo "fatal: not a git repository"). Không có `.git` để kiểm tra tracked files. `.gitignore` đã có rule đúng, nhưng việc "không bị track" chỉ có ý nghĩa khi có repo. **Đây là một finding cần lưu ý**, không phải PASS/FAIL theo nghĩa thông thường. |
| Quét mã nguồn tìm Supabase key hard-code (`sb_publishable_`, `sb_secret_`, JWT `service_role`) | PASS — không tìm thấy ngoài `apps/web/dist/` (bundle build chứa mã nguồn thư viện `@supabase/supabase-js` được minify, không phải secret thật) và `node_modules/`. |
| Quét DB URL / password hard-code (`postgresql://...:...@...`) | PASS — không tìm thấy trong `apps/**`, `supabase/**`, `docs/**`, `README.md`. |
| Quét project ref / email demo hard-code trong mã nguồn được track | 1 phát hiện không nhạy cảm: `supabase/.temp/linked-project.json` chứa `project ref` (không kèm key/password) — file này nằm trong `supabase/.temp/`, đã bị `.gitignore` loại trừ. Không phải secret. |

**Kết luận mục 2:** Không phát hiện secret hard-code nào trong source. Rủi ro duy nhất là thiếu git repository nên rule gitignore chưa từng được kiểm chứng thực tế (chưa có commit nào để soi).

---

## 3. Database & migration readiness (chỉ đọc, không thay đổi)

Dùng `supabase migration list` và `supabase db query --linked` (read-only qua Management API, không có ghi).

**Migration list (local vs remote) — sau repair, xem lịch sử drift & xử lý bên dưới:**

```
Local | Remote
0000  | 0000
0001  | 0001
0002  | 0002
0003  | 0003
0004  | 0004
0005  | 0005
0006  | 0006
0007  | 0007
0008  | 0008
0009  | 0009
0010  | 0010
0011  | 0011
0012  | 0012   <-- Resolved: đã repair, xem chi tiết bên dưới
```

- **[Resolved] Migration drift 0012 đã được xử lý.** Trình tự xử lý (thực hiện trong phiên repair riêng, có user approval rõ ràng):
  1. **Verify read-only trước khi sửa** — so sánh định nghĩa function `public.create_course_class(uuid, uuid, text, integer, jsonb)` lấy trực tiếp từ remote (`pg_get_functiondef`) với nội dung file local `supabase/migrations/0012_rpc_create_course_class.sql`: **khớp hoàn toàn từng dòng** — cùng signature, `SECURITY DEFINER`, `SET search_path TO 'pg_catalog', 'public'`, kiểm tra `auth.uid()`/`public.is_training_staff()`, insert `course_classes` rồi `class_schedules` trong cùng transaction, trả về `jsonb` với `success/class_id/class_code/status/schedule_count`. Không có sai khác nào được phát hiện.
  2. **Repair migration tracking** — chạy đúng một lệnh: `supabase migration repair --status applied 0012`. Lệnh này **chỉ ghi một dòng vào bảng `supabase_migrations.schema_migrations`** (đánh dấu version `0012` là đã áp dụng); **không chạy lại bất kỳ câu SQL nào trong file 0012**, không tạo/sửa function, không tạo/sửa/xóa dữ liệu. Không chạy `supabase db push`, không chạy `psql` sửa schema/data.
  3. **Xác nhận sau repair** — `supabase migration list` báo cáo local/remote khớp `0000`–`0012`, không còn lệch.
  - Nguyên nhân gốc (không đổi): nội dung SQL của 0012 từng được áp dụng lên remote qua đường khác `supabase db push` bình thường (không xác định được chính xác cách áp dụng ban đầu), khiến bảng theo dõi lịch sử migration bị thiếu bản ghi dù function đã tồn tại đúng. Repair chỉ đồng bộ lại **sổ sách theo dõi**, không đổi trạng thái thực tế của database.

- **RLS trên toàn bộ bảng nghiệp vụ `public`:** PASS — cả 8 bảng đều bật `relrowsecurity = true`:
  `class_schedules`, `course_classes`, `courses`, `enrollment_history`, `enrollments`, `profiles`, `registration_periods`, `semesters`.
  Tất cả đều có ít nhất 1 policy (`courses`, `enrollment_history`, `enrollments`, `profiles`: 1 policy; `registration_periods`, `semesters`: 3; `class_schedules`, `course_classes`: 5).

- Không chạy `supabase db push`, không seed lại, không sửa schema — đúng như yêu cầu.

---

## 4. API / RBAC smoke test (không thay đổi dữ liệu)

Khởi động `npm run dev` tạm thời (web :5173, api :4000), đăng nhập lấy JWT thật qua Supabase Auth (không mutate dữ liệu), gọi các endpoint **chỉ-đọc** bằng `curl` với `Authorization: Bearer <jwt>`, sau đó dừng server. Không gọi bất kỳ endpoint `POST` nghiệp vụ nào (đăng ký, hủy, tạo lớp, tạo đợt).

| Request | Kết quả HTTP |
|---|---|
| `GET /api/health` | 200 PASS |
| `POST /api/auth/session/verify` (staff token) | 200 PASS |
| `POST /api/auth/session/verify` (student1 token) | 200 PASS |
| `GET /api/student/semesters` (student1) | 200 PASS |
| `GET /api/student/classes?semesterId=...` (student1) | 200 PASS |
| `GET /api/student/enrollments/history` (student1) | 200 PASS |
| `GET /api/staff/registration-periods` (staff) | 200 PASS |
| `GET /api/staff/course-classes` (staff) | 200 PASS |
| `GET /api/staff/course-classes/:id` (staff) | 200 PASS |
| `GET /api/staff/course-classes/:id/enrollments` (staff, roster) | 200 PASS |
| `GET /api/staff/course-classes` **với token student1** | **403 PASS** (bị từ chối đúng) |
| `GET /api/student/enrollments/history` **với token staff** | **403 PASS** (bị từ chối đúng) |

**RBAC hoạt động đúng theo cả hai chiều.** Không có POST nghiệp vụ nào được gọi trong bước này.

---

## 5. UI smoke test (không thay đổi dữ liệu)

Dùng Playwright (cài tạm ngoài repo, trong thư mục scratchpad — không sửa `package.json`/`node_modules` của dự án) điều khiển Chromium headless thật qua UI.

| Kịch bản | Kết quả |
|---|---|
| Truy cập `/staff/course-classes` khi **chưa đăng nhập** | PASS — bị route guard chuyển hướng về `/login` |
| Đăng nhập student1 → `StudentClasses` hiển thị | PASS — nội dung "Danh sách lớp học phần" render đúng |
| Điều hướng sang `StudentHistory` | PASS — nội dung "Lịch sử đăng ký" render đúng |
| Đăng nhập staff → `StaffRegistrationPeriods` hiển thị | PASS |
| Điều hướng sang `StaffCourseClasses` | PASS — nội dung "Quản lý lớp học phần" render đúng |
| Mở `StaffCourseClassDetail` (lớp CS601-01, dữ liệu seed có sẵn) | PASS — nội dung "Chi tiết lớp học phần" render đúng |

Không có thao tác tạo/đăng ký/hủy nào được click trong bước này. Chỉ xem (login + điều hướng + đọc).

**Lưu ý:** Playwright **không nằm trong repo** (không có dependency, không có config, không có test file `.spec.ts` nào ngoài `apps/web/src/lib/enrollmentMatching.test.ts` của vitest). Việc lái UI ở trên là một smoke test thủ công trong phiên QA này, không phải bằng chứng của một bộ E2E tự động hoá đã được thiết lập trong dự án.

---

## 6. Regression evidence

### 6a. Đã kiểm thử lại trực tiếp trong phiên QA này (mục 4 và 5 ở trên)
- Health check, xác thực phiên (session verify) cho cả 2 role.
- Đọc dữ liệu (semesters/classes/history phía student; registration periods/classes/class detail/roster phía staff).
- Từ chối chéo role (student gọi staff GET → 403; staff gọi student GET → 403).
- Route guard chưa đăng nhập.
- Hiển thị 4 trang UI chính (StudentClasses, StudentHistory, StaffRegistrationPeriods, StaffCourseClasses, StaffCourseClassDetail).

### 6b. Bằng chứng từ kiểm thử E2E trước đó (không chạy lại trong phiên này — chỉ xác minh dữ liệu còn tồn tại)
Nguồn bằng chứng: dữ liệu còn lưu trong `enrollment_history`/`enrollments` trên Supabase Cloud (đọc read-only trong phiên QA này) và báo cáo E2E trước ("luồng hủy lớp — QA-CANCEL-02").

| Kịch bản nghiệp vụ | Trạng thái bằng chứng |
|---|---|
| Đăng ký thành công (CONFIRMED) | **Có bằng chứng DB**: nhiều enrollment CONFIRMED của student1 (CS601-01, CS602-01, MG601-01, QA-CANCEL-02 trước khi bị hủy). |
| Trùng lịch học (schedule conflict) | **Có bằng chứng DB**: enrollment REJECTED cho CS603-01 với lý do đúng `"Trùng lịch học với lớp đã đăng ký"` — khớp với logic trong `0008_rpc_register_for_class.sql`. |
| Tự hủy đăng ký (self-cancel) | **Có bằng chứng DB**: enrollment MG601-01 có transition CONFIRMED → CANCELLED_BY_STUDENT (20/07/2026), sau đó student1 đăng ký lại thành công. |
| Hủy lớp bởi nhà trường (school-cancel) | **Có bằng chứng DB + báo cáo E2E trước**: lớp `QA-CANCEL-02` CANCELLED, enrollment tương ứng có transition CONFIRMED → CANCELLED_BY_SCHOOL kèm lý do `"Kiểm thử end-to-end nghiệp vụ hủy lớp"`. Đây là dữ liệu do phiên E2E trước tạo ra (đã được yêu cầu giữ lại, xác nhận trong 6c). |
| **Vượt giới hạn tín chỉ (BUS-05)** (`"Vượt giới hạn tín chỉ cho phép"`) | **Đã test trước đây trong transaction có rollback — không còn dấu vết trong database.** Kịch bản này được xác nhận đã kiểm thử theo `docs/DB_CONCURRENCY_TEST_PLAN.md` bằng phiên `psql` thủ công chạy trong một transaction (`begin ... rollback`) để mô phỏng `auth.uid()` qua `set local request.jwt.claims`; vì kết thúc bằng `rollback` nên `enrollments`/`enrollment_history` không lưu lại bản ghi nào — đây là lý do truy vấn `enrollment_history.reason` distinct trong phiên QA này không thấy giá trị `"Vượt giới hạn tín chỉ cho phép"`. Việc thiếu dấu vết trong DB là **kết quả kỳ vọng của phương pháp test bằng rollback**, không phải bằng chứng chưa từng kiểm thử. |
| **Hết chỗ / chỗ cuối (BUS-06/BUS-07)** (`"Lớp đã đủ sĩ số"`) | **Đã test trước đây trong transaction có rollback — không còn dấu vết trong database**, cùng phương pháp và lý do như trên (`docs/DB_CONCURRENCY_TEST_PLAN.md`, `psql` + `rollback`). Không xuất hiện trong `enrollment_history.reason` vì không được commit, không phải vì chưa chạy. |

**Kết luận 6b:** 4/6 kịch bản có bằng chứng còn tồn tại trong database hiện tại (đăng ký, trùng lịch, tự hủy, hủy lớp) vì các test đó chạy qua API/UI thật và commit thật. 2/6 kịch bản còn lại (vượt tín chỉ BUS-05, hết chỗ BUS-06/07) **đã được kiểm thử trước đây** theo kế hoạch trong `docs/DB_CONCURRENCY_TEST_PLAN.md`, nhưng bằng phương pháp `psql` transaction + `rollback` nên **không để lại dấu vết trong database** — sự vắng mặt trong `enrollment_history` là do rollback, không phải do chưa kiểm thử.

### 6c. Dữ liệu QA tồn tại trên cloud (đã xác nhận qua truy vấn read-only, không xóa)
- `ZZTEST-01` — course_class, status = `CANCELLED` (dữ liệu QA cũ, giữ nguyên).
- `QA-CANCEL-02` — course_class, status = `CANCELLED` (từ phiên E2E hủy lớp trước đó, giữ nguyên).

---

## 7. Kết luận

### Verdict: **READY WITH LIMITATIONS**

Ứng dụng build/typecheck/lint sạch, RLS bật đầy đủ, RBAC hoạt động đúng hai chiều qua smoke test thật, migration history đã đồng bộ (0000–0012, không còn lệch), và có bằng chứng cho cả 6/6 luồng nghiệp vụ cốt lõi (4 luồng còn dấu vết trong DB, 2 luồng đã test qua transaction rollback nên không còn dấu vết nhưng có bằng chứng đã thực thi theo kế hoạch tài liệu). Blocker P1 duy nhất đã được xử lý (repair migration tracking). Còn lại là các hạn chế cần các bên liên quan chấp nhận tường minh trước khi go-live thật.

### Blocker

- **P1 — Migration drift: [Resolved].** Migration `0012_rpc_create_course_class.sql` từng thiếu bản ghi trong `supabase_migrations.schema_migrations` trên remote dù function đã tồn tại và hoạt động đúng. Đã xử lý bằng `supabase migration repair --status applied 0012` (sau khi verify read-only định nghĩa function remote khớp hoàn toàn với file local 0012). Lệnh repair **chỉ cập nhật bảng theo dõi migration, không chạy lại SQL, không tạo/sửa/xóa dữ liệu hay schema**. Xác nhận sau repair: `supabase migration list` báo `0000`–`0012` khớp local/remote, không còn lệch. Chi tiết đầy đủ ở mục 3.

Không phát hiện blocker P0 (không có lỗi build/typecheck, không có secret rò rỉ, RLS không bị tắt, RBAC không bị bypass).

### Limitations (đã có bằng chứng, không phải suy đoán)

1. **Chưa public deploy** — toàn bộ kiểm thử trong báo cáo này chạy trên `localhost` (dev server), không phải môi trường production/staging đã publish. Chưa có bằng chứng về hành vi sau khi build production thực sự được deploy (CDN, domain thật, CORS với origin thật, v.v.).
2. **Không có Playwright/E2E tự động trong repo** — xác nhận qua tìm kiếm dependency và file cấu hình: không có. Toàn bộ E2E (bao gồm luồng hủy lớp trước đó và UI smoke test trong báo cáo này) là thao tác thủ công bằng script Playwright cài tạm ngoài repo, không lặp lại được tự động qua CI.
3. **Không có test tự động cho `apps/api`** — chỉ `apps/web` có 1 file vitest (3 test, chỉ kiểm tra 1 hàm thuần `enrollmentMatching`). Toàn bộ logic RPC nghiệp vụ (đăng ký, hủy, tạo lớp — nằm trong SQL migrations) không có test tự động, chỉ có kế hoạch thủ công trong `docs/DB_CONCURRENCY_TEST_PLAN.md`.
4. **2/6 kịch bản nghiệp vụ (vượt giới hạn tín chỉ BUS-05, hết chỗ ngồi BUS-06/07) không còn dấu vết trong database hiện tại** — đã được kiểm thử trước đây theo `docs/DB_CONCURRENCY_TEST_PLAN.md` bằng `psql` transaction kết thúc `rollback`, nên không có bản ghi `enrollment_history` tương ứng để soi lại. Đây là hạn chế về **khả năng tái xác minh bằng chứng qua dữ liệu**, không phải hạn chế về việc logic đã từng được kiểm thử hay chưa.
5. **Không có git repository** tại `graduate-course-registration-system/` — không thể xác minh bằng git rằng `.env` thật chưa từng được commit; chỉ có thể xác nhận rule `.gitignore` là đúng.
6. **15 vulnerability từ `npm audit`** (3 moderate, 12 high), toàn bộ ở dev-tooling (eslint/concurrently/esbuild chain), không phải runtime dependency — rủi ro thấp cho production nhưng nên dọn trước khi siết CI an ninh.
7. Dữ liệu QA (`ZZTEST-01`, `QA-CANCEL-02`) vẫn còn tồn tại trên project cloud dùng chung — nếu project này sẽ dùng làm production thật, cần dọn dữ liệu test trước khi đi live (không nằm trong scope QA này để tự xóa).

### Đề xuất bước tiếp theo (theo thứ tự ưu tiên)

1. ~~**[P1]** Xử lý migration drift 0012~~ — **Đã xử lý** (`supabase migration repair --status applied 0012`, xác nhận local/remote khớp 0000–0012).
2. **[P2]** Khởi tạo git repository (nếu chưa có) và xác minh thực tế qua `git log`/`git show` rằng không commit thật có `.env` — hiện chỉ xác minh được rule, chưa xác minh được lịch sử.
3. **[P2]** Nếu cần bằng chứng có thể soi lại trong database cho BUS-05/BUS-06/07 (thay vì chỉ dựa vào tài liệu kế hoạch test), cân nhắc chạy lại hai kịch bản này trên một project QA riêng **và commit thay vì rollback** — không thực hiện trên project cloud dùng chung này.
4. **[P3]** Thiết lập Playwright E2E chính thức trong repo (package.json, config, test file commit vào git) thay vì script tạm ngoài repo, để có thể chạy lại qua CI.
5. **[P3]** Bổ sung test tự động (vitest hoặc pgTAP) cho logic RPC nghiệp vụ trong migrations, hiện chỉ có kế hoạch thủ công.
6. **[P3]** Dọn `npm audit` cho dev-tooling khi có cửa sổ bảo trì (không khẩn cấp, không ảnh hưởng runtime).
7. **[P4]** Trước khi go-live thật, dọn dữ liệu QA (`ZZTEST-01`, `QA-CANCEL-02`) khỏi project cloud nếu project này sẽ phục vụ production.

---

## Phụ lục: toàn bộ lệnh đã chạy trong phiên QA này

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run test --workspace apps/web

cat .gitignore
cat .env.example apps/web/.env.example apps/api/.env.example
grep -rnE "sb_publishable_|sb_secret_|postgresql://...@..." apps supabase docs README.md
grep -rn "<known local secret substrings>" apps supabase docs README.md package.json

supabase migration list
supabase db query --linked "select proname from pg_proc where proname = 'create_course_class';"
supabase db query --linked "select version from supabase_migrations.schema_migrations order by version;"
supabase db query --linked "select relname, relrowsecurity, relforcerowsecurity from pg_class ... where nspname='public' and relkind='r';"
supabase db query --linked "select tablename, count(*) from pg_policies where schemaname='public' group by tablename;"
supabase db query --linked "select class_code, status from course_classes where class_code in ('ZZTEST-01','QA-CANCEL-02');"
supabase db query --linked "select distinct reason from enrollment_history where reason is not null;"

npm run dev   # tạm thời, để smoke test — đã dừng sau khi xong
curl .../api/health
curl -X POST .../api/auth/session/verify   (staff + student1 token)
curl .../api/student/semesters | classes | enrollments/history   (student1 token)
curl .../api/staff/registration-periods | course-classes | course-classes/:id | .../enrollments   (staff token)
curl .../api/staff/course-classes   (student1 token → phải 403)
curl .../api/student/enrollments/history   (staff token → phải 403)

# UI smoke test (Playwright, cài tạm ngoài repo trong scratchpad)
node login.js ... (đăng nhập thật, lưu storageState)
node ui_smoke.js  (route guard, StudentClasses, StudentHistory, StaffRegistrationPeriods, StaffCourseClasses, StaffCourseClassDetail)

# Dừng dev server sau khi hoàn tất smoke test
Stop-Process trên các PID đang LISTEN ở cổng 5173 và 4000
```

### Lệnh chạy trong phiên repair migration 0012 (sau, có user approval rõ ràng)

```bash
supabase db query --linked "select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_course_class';"
# -> đối chiếu thủ công với supabase/migrations/0012_rpc_create_course_class.sql, khớp hoàn toàn -> tiến hành repair

supabase migration repair --status applied 0012
supabase migration list
```

Không chạy `supabase db push`, không chạy `psql` sửa schema/data, không tạo/xóa dữ liệu trong bước repair này.

Không có secret/token/key/DB URL nào được in trong báo cáo hoặc log của phiên QA này. Không có migration file, seed, hay dữ liệu cloud nào bị thay đổi — chỉ có bảng theo dõi migration history (`supabase_migrations.schema_migrations`) được cập nhật qua lệnh repair.
