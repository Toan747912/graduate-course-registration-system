# Thiết kế mở rộng: Hệ thống Quản lý Học viên Cao học

> Tài liệu thiết kế cho giai đoạn mở rộng từ MVP "Đăng ký học phần" (BUS-01..15, UC-01..08, BR-01..13)
> sang **Graduate Student Management System**. Đây là tài liệu **thiết kế**, không phải PR code.
> Không migration nào trong `0000`–`0014` bị sửa. Không có thay đổi source/DB trong lượt này.

Nguồn tham chiếu đã đọc để viết tài liệu này:
- `BA_Portfolio_Graduate_Course_Registration/03_Business_Rules.md` (BUS-01..15)
- `BA_Portfolio_Graduate_Course_Registration/04_Use_Cases.md` (UC-01..08)
- `BA_Portfolio_Graduate_Course_Registration/02_Stakeholders_and_Scope.md` (actor matrix, out-of-scope list)
- `BA_Portfolio_Graduate_Course_Registration/07_Data_Model.md`
- `BA_Portfolio_Graduate_Course_Registration/10_Traceability_Matrix.md`
- `supabase/migrations/0000_*.sql` .. `0014_*.sql`, `supabase/README.md`
- `apps/api/src/routes/{student,staff,auth}.ts`, `middleware/{auth,requireRole}.ts`
- `apps/web/src/App.tsx`, `pages/student/*`, `pages/staff/*`, `components/{StudentNav,StaffNav}.tsx`

---

## A. Product scope

### A.1 Module hiện có (MVP, không đổi hành vi)
- Học kỳ / Đợt đăng ký (`semesters`, `registration_periods`)
- Danh mục môn học / Lớp học phần / Lịch học (`courses`, `course_classes`, `class_schedules`)
- Đăng ký / hủy đăng ký học phần + lịch sử (`enrollments`, `enrollment_history`)
- 2 role nhị phân: `STUDENT`, `TRAINING_STAFF`

### A.2 Module mở rộng (giai đoạn này thiết kế, chưa code)
1. **Chương trình đào tạo & Khóa học** (Program, Cohort/Khóa) — nhân viên đào tạo quản lý; học viên chỉ xem.
2. **Hồ sơ học viên mở rộng** — gắn học viên vào 1 chương trình + 1 khóa, thêm `academic_status` (Đang học/Tạm dừng/Đã tốt nghiệp/Thôi học).
3. **Cấu hình chương trình** — môn bắt buộc/tự chọn, tín chỉ tối thiểu bắt buộc/tự chọn, điểm đạt tối thiểu, tín chỉ tối thiểu để nhận luận văn.
4. **Kết quả học phần & tiến độ tín chỉ** — điểm tổng kết 0–10/lần học, tự tính Đạt/Không đạt, lịch sử học lại, tín chỉ tích lũy (chỉ tính khi Đạt, chỉ tính 1 lần).
5. **Luận văn (MVP)** — đề tài, giảng viên hướng dẫn (danh mục, không tài khoản), trạng thái, điều kiện tín chỉ tối thiểu để được phân công.

### A.3 Ngoài phạm vi (giữ nguyên theo yêu cầu đã chốt)
Học phí, tuyển sinh, email/thông báo, hội đồng bảo vệ luận văn, điểm thành phần (chỉ 1 điểm tổng kết/lần học), CRUD tài khoản hoặc role giảng viên, tài khoản đăng nhập cho giảng viên.

---

## B. Actors / Permissions matrix

Actor mới: không có — vẫn 2 role. Giảng viên hướng dẫn là **dữ liệu tham chiếu** (danh mục), không phải actor/account.

| Chức năng | Student | Training Staff |
|---|:---:|:---:|
| CRUD Chương trình đào tạo | ✗ | ✓ |
| CRUD Khóa (cohort) | ✗ | ✓ |
| Cấu hình tín chỉ tối thiểu / điểm đạt / ngưỡng luận văn của chương trình | ✗ | ✓ |
| Gán môn bắt buộc/tự chọn vào chương trình | ✗ | ✓ |
| Gán học viên vào chương trình + khóa | ✗ | ✓ |
| Xem chương trình/khóa/môn bắt buộc-tự chọn của bản thân | ✓ | ✓ (mọi học viên) |
| Đổi trạng thái học tập học viên (Đang học/Tạm dừng/Tốt nghiệp/Thôi học) | ✗ | ✓ |
| Nhập điểm tổng kết học phần | ✗ | ✓ |
| Xem kết quả/tiến độ tín chỉ của bản thân | ✓ | ✓ (mọi học viên) |
| Xem lịch sử học lại của bản thân | ✓ | ✓ (mọi học viên) |
| CRUD danh mục giảng viên hướng dẫn | ✗ | ✓ |
| Tạo đề tài luận văn + gán giảng viên hướng dẫn | ✗ | ✓ |
| Cập nhật trạng thái luận văn | ✗ | ✓ |
| Xem đề tài luận văn của bản thân | ✓ | ✓ (mọi học viên) |
| Đăng ký học phần (MVP cũ) | ✓ *(chỉ khi `academic_status = STUDYING` — BUS-16)* | — |

Không có role mới, không có permission per-object ngoài phân tách Student/Staff hiện có — nhất quán với mô hình nhị phân hiện tại, chỉ dùng RLS + `requireRole` như cũ.

---

## C. Data model đề xuất

Nguyên tắc kế thừa từ `supabase/README.md`: không lưu cột trùng lặp có thể suy ra từ quan hệ (không lưu lại `semester_id` nếu suy ra được qua FK, không lưu counter tín chỉ tổng nếu tính được từ join — trừ khi hiệu năng đòi hỏi, sẽ ghi rõ lý do).

### C.1 `programs` (Chương trình đào tạo)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `code` | text | unique |
| `name` | text | |
| `required_credits_min` | int, check > 0 | tín chỉ tối thiểu bắt buộc |
| `elective_credits_min` | int, check >= 0 | tín chỉ tối thiểu tự chọn |
| `pass_score_min` | numeric(3,1), check 0–10 | điểm đạt tối thiểu toàn chương trình |
| `thesis_credits_min` | int, check >= 0 | tín chỉ tối thiểu để được phân công luận văn |
| `created_at`, `updated_at` | timestamptz | trigger `set_updated_at` (đã có sẵn) |

### C.2 `cohorts` (Khóa học/nhập học, ví dụ "K2026")
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `program_id` | uuid FK → `programs` | |
| `code` | text | unique theo `(program_id, code)` |
| `name` | text | ví dụ "Khóa 2026" |
| `created_at`, `updated_at` | | |

Không có bảng "Khóa" độc lập với chương trình — mỗi khóa thuộc đúng một chương trình (đơn giản hoá theo yêu cầu chốt #1/#4).

### C.3 `program_courses` (Môn bắt buộc/tự chọn của chương trình)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `program_id` | uuid FK → `programs` | |
| `course_id` | uuid FK → `courses` (bảng MVP có sẵn) | |
| `requirement_type` | enum `REQUIRED` \| `ELECTIVE` | |
| unique | `(program_id, course_id)` | 1 môn chỉ 1 loại trong 1 chương trình |

`courses.credits` (đã có ở migration 0003) là nguồn duy nhất cho tín chỉ môn học — không lưu lại ở đây.

### C.4 `profiles` — mở rộng (không sửa migration 0001, thêm cột qua migration mới)
| Cột thêm | Kiểu | Ghi chú |
|---|---|---|
| `program_id` | uuid FK → `programs`, nullable | null cho staff; **NOT NULL** cho mọi học viên sau backfill (xem dưới) |
| `cohort_id` | uuid FK → `cohorts`, nullable | phải thuộc `program_id` (check qua trigger, vì FK đơn thuần không ràng buộc chéo bảng); NOT NULL cho học viên sau backfill |
| `academic_status` | enum `STUDYING` \| `SUSPENDED` \| `GRADUATED` \| `WITHDRAWN` | **NOT NULL** cho mọi học viên (role=STUDENT); không áp dụng cho staff |

Không tạo bảng "student_profile" riêng — hồ sơ học viên theo yêu cầu chốt #2 (mã, họ tên, email, chương trình, khóa, trạng thái) đã có sẵn `id`/`full_name`/(email qua `auth.users`)/role trong `profiles`; chỉ cần bổ sung 3 cột trên là đủ, tránh trùng lặp bảng.

**Backfill & ràng buộc NOT NULL (DECIDED):** migration bổ sung cột `academic_status` phải backfill toàn bộ học viên hiện có theo `student_status` cũ **trước khi** đặt ràng buộc `NOT NULL`:
- `student_status = 'ACTIVE'` → `academic_status = 'STUDYING'`
- `student_status = 'INACTIVE'` → `academic_status = 'SUSPENDED'`

Sau backfill, không còn học viên nào có `academic_status = NULL` — cột được đặt `NOT NULL` ngay trong cùng migration. `program_id`/`cohort_id` vẫn có thể tạm thời NULL cho học viên demo cũ nếu chưa gán chương trình cụ thể (không có dữ liệu nguồn để suy ra), nhưng RPC nghiệp vụ (đăng ký học phần, nhập điểm, luận văn) chỉ hoạt động dựa trên `academic_status`.

**Quan hệ với `student_status` cũ (migration 0001 `ACTIVE`/`INACTIVE`) — DECIDED, không sync hai chiều:** `academic_status` là **nguồn nghiệp vụ chính** kể từ giai đoạn mở rộng này. Chỉ có **sync một chiều** `academic_status` → `student_status`, thực hiện bằng trigger khi `academic_status` thay đổi:
- `STUDYING` → `student_status = 'ACTIVE'`
- `SUSPENDED` / `GRADUATED` / `WITHDRAWN` → `student_status = 'INACTIVE'`

Không có chiều ngược lại (không cho phép sửa `student_status` để tự suy ra `academic_status`). Cột `student_status` được giữ lại nguyên trạng chỉ để không phá vỡ RLS/RPC MVP hiện tại (`is_active_student()`), nhưng **không còn là nguồn quyết định nghiệp vụ** cho bất kỳ luật mới nào — mọi RPC/rule mới (kể cả Batch 4 tích hợp vào `register_for_class`) phải kiểm tra trực tiếp `academic_status = 'STUDYING'`, không dựa vào `student_status`.

### C.5 `enrollment_grades` (Điểm tổng kết + lịch sử học lại)
Đây là bảng cốt lõi cho luật #6–#8 (điểm, đạt/không đạt, học lại, tín chỉ tính 1 lần).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `student_id` | uuid FK → `profiles` | |
| `course_id` | uuid FK → `courses` | (không FK vào `course_classes`/`enrollments` MVP — xem lý do bên dưới) |
| `attempt_no` | int, check > 0 | số lần học, tăng dần: 1 = học lần đầu, 2 = học lại... |
| `enrollment_id` | uuid FK → `enrollments`, **NOT NULL, unique** | mỗi lần học phải gắn đúng một lượt đăng ký MVP (DECIDED); 1 `enrollment` chỉ sinh ra tối đa 1 dòng điểm |
| `score` | numeric(3,1), check 0–10, nullable | điểm tổng kết; null = chưa có điểm |
| `passed` | boolean, generated hoặc trigger-tính | Đạt/Không đạt theo `programs.pass_score_min` của chương trình học viên |
| `graded_at` | timestamptz, nullable | |
| `graded_by` | uuid FK → `profiles` (staff) | |
| `created_at` | timestamptz | |
| unique | `(student_id, course_id, attempt_no)`, `(enrollment_id)` | mỗi lần học là 1 dòng, không ghi đè; mỗi `enrollment` MVP chỉ có đúng 1 dòng điểm tương ứng |

**Vì sao không gắn `passed`/tín chỉ trực tiếp vào `enrollments` MVP:** `enrollments` là mô hình "1 lượt đăng ký lớp học phần trong 1 kỳ", đã có ràng buộc partial-unique theo CONFIRMED (BUS-03) và trigger BUS chặt cho MVP đăng ký — không nên chèn thêm cột nghiệp vụ điểm/học lại vào bảng lõi MVP để tránh rủi ro hồi quy. `enrollment_grades` là bảng **mới**, tách biệt, luôn tham chiếu bắt buộc `enrollment_id` (DECIDED) để mỗi lần học/điểm truy vết trực tiếp về đúng lượt đăng ký lớp đã sinh ra nó — không cho phép nhập điểm rời rạc không qua đăng ký lớp trong phạm vi MVP này.

**Tín chỉ tính 1 lần khi đạt (luật #8):** không lưu counter tín chỉ tích lũy ở `profiles`. Tín chỉ tích lũy được suy ra bằng view/RPC: với mỗi `course_id` có ít nhất một `attempt` `passed = true`, cộng `courses.credits` đúng 1 lần (không nhân theo số lần học lại) — xem RPC ở mục D/H.

### C.6 `advisors` (Danh mục giảng viên hướng dẫn — không có tài khoản)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `full_name` | text | |
| `email` | text, nullable | chỉ để liên hệ tham khảo, không dùng đăng nhập |
| `title` | text, nullable | học hàm/học vị, ví dụ "TS." |
| `created_at`, `updated_at` | | |

Không FK vào `auth.users`/`profiles` — theo đúng yêu cầu chốt #9 "giảng viên không có tài khoản đăng nhập".

### C.7 `theses` (Luận văn — MVP)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `student_id` | uuid FK → `profiles`, unique | 1 học viên chỉ có 1 đề tài đang hoạt động (xem ràng buộc bên dưới) |
| `advisor_id` | uuid FK → `advisors` | |
| `title` | text | |
| `status` | enum `NOT_STARTED` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` | |
| `assigned_at` | timestamptz | |
| `created_at`, `updated_at` | | |
| partial unique | `(student_id) WHERE status IN ('NOT_STARTED','IN_PROGRESS')` | học viên không có 2 đề tài đang hiệu lực cùng lúc; nếu CANCELLED có thể tạo đề tài mới |

Điều kiện tín chỉ tối thiểu (`programs.thesis_credits_min`) được validate ở RPC tạo/gán luận văn, không lưu lại dưới dạng cột (suy ra tại thời điểm gán bằng cùng RPC tính tín chỉ tích lũy ở C.5).

### C.8 Tổng quan quan hệ (ERD rút gọn)

```
programs 1───* cohorts
programs 1───* program_courses *───1 courses (MVP)
programs 1───* profiles (program_id)   cohorts 1───* profiles (cohort_id)
profiles 1───* enrollment_grades *───1 courses
enrollments (MVP) 1───1 enrollment_grades (enrollment_id, NOT NULL + unique)
profiles 1───0..1 theses *───1 advisors
programs 1───* theses (gián tiếp, qua profiles.program_id — không lưu program_id trực tiếp ở theses)
```

---

## D. Business rules mới (tiếp nối BUS-15)

| Code | Nội dung |
|---|---|
| **BUS-16** | Chỉ học viên có `academic_status = STUDYING` mới được đăng ký học phần. `academic_status` là nguồn nghiệp vụ chính cho điều kiện này (không dùng `student_status`); mọi RPC/kiểm tra liên quan phải kiểm tra trực tiếp cột này. |
| **BUS-17** | Một chương trình đào tạo có `code` duy nhất; một khóa (`cohort`) có `code` duy nhất trong phạm vi chương trình của nó. |
| **BUS-18** | Một môn học chỉ có đúng một loại (`REQUIRED` hoặc `ELECTIVE`) trong một chương trình; không được vừa bắt buộc vừa tự chọn. |
| **BUS-19** | Chương trình phải cấu hình đủ 3 giá trị trước khi có thể gán học viên: tín chỉ tối thiểu bắt buộc, tín chỉ tối thiểu tự chọn, điểm đạt tối thiểu. |
| **BUS-20** | Điểm tổng kết học phần nằm trong khoảng 0–10 (một số thập phân); giá trị Đạt/Không đạt luôn được hệ thống tự tính từ `score` so với `pass_score_min` của chương trình học viên tại thời điểm chấm — không cho nhập tay Đạt/Không đạt. |
| **BUS-21** | Học viên Không đạt một môn được phép học lại ở học kỳ sau; mỗi lần học tạo một dòng `enrollment_grades` mới với `attempt_no` tăng dần; không được sửa/xoá dòng của lần học trước (append-only, tương tự BUS-09/`enrollment_history`). |
| **BUS-22** | Tín chỉ của một môn học chỉ được cộng vào tổng tín chỉ tích lũy của học viên đúng một lần, tại lần học đầu tiên có `passed = true` (theo `attempt_no` nhỏ nhất trong số các lần đạt); các lần học lại sau khi đã đạt không cộng thêm tín chỉ. |
| **BUS-23** | Đề tài luận văn chỉ được gán khi tổng tín chỉ tích lũy hiện tại của học viên ≥ `programs.thesis_credits_min` của chương trình học viên đang theo học. |
| **BUS-24** | Một học viên chỉ có tối đa một đề tài luận văn đang ở trạng thái `NOT_STARTED` hoặc `IN_PROGRESS` tại một thời điểm; chỉ có thể tạo đề tài mới nếu đề tài trước đó đã `CANCELLED` (không cho tạo mới nếu đang `IN_PROGRESS`/`NOT_STARTED`, và không tự động thay thế đề tài `COMPLETED`). |
| **BUS-25** | Chỉ Nhân viên đào tạo được thay đổi `academic_status` của học viên; thay đổi này tự động sync một chiều sang `student_status` (`STUDYING`→`ACTIVE`; `SUSPENDED`/`GRADUATED`/`WITHDRAWN`→`INACTIVE`), không có chiều ngược lại; khi chuyển sang `WITHDRAWN`/`GRADUATED`/`SUSPENDED`, học viên không còn được đăng ký học phần mới (ràng buộc lại BUS-16) nhưng lịch sử điểm/luận văn vẫn được giữ nguyên, không xoá. |
| **BUS-26** | Chương trình/khóa của một học viên chỉ được thay đổi (gán lại `program_id`/`cohort_id`) nếu học viên đó **chưa có** bất kỳ `enrollments` (MVP), `enrollment_grades`, hay `theses` nào liên kết. Ngay khi có dữ liệu ở một trong ba nguồn này, `program_id`/`cohort_id` trở thành bất biến (immutable) và mọi yêu cầu đổi chương trình/khóa bị hệ thống từ chối. |

---

## E. Use cases mới (tiếp nối UC-08)

| Code | Tên | Actor chính |
|---|---|---|
| UC-09 | Tạo/cập nhật chương trình đào tạo (cấu hình tín chỉ, điểm đạt, ngưỡng luận văn) | Training staff |
| UC-10 | Tạo/cập nhật khóa học thuộc một chương trình | Training staff |
| UC-11 | Gán môn bắt buộc/tự chọn vào chương trình | Training staff |
| UC-12 | Gán học viên vào chương trình + khóa | Training staff |
| UC-13 | Cập nhật trạng thái học tập của học viên | Training staff |
| UC-14 | Xem hồ sơ + chương trình/khóa của bản thân | Student |
| UC-15 | Nhập điểm tổng kết học phần cho một lần học | Training staff, System (tự tính Đạt/Không đạt) |
| UC-16 | Xem kết quả học tập & tiến độ tín chỉ của bản thân (gồm lịch sử học lại) | Student |
| UC-17 | Xem bảng kết quả học tập của một học viên (staff, phục vụ xét luận văn) | Training staff |
| UC-18 | Quản lý danh mục giảng viên hướng dẫn | Training staff |
| UC-19 | Tạo đề tài luận văn và gán giảng viên hướng dẫn | Training staff, System (kiểm tra ngưỡng tín chỉ) |
| UC-20 | Cập nhật trạng thái luận văn | Training staff |
| UC-21 | Xem đề tài luận văn của bản thân | Student |

---

## F. User stories & acceptance criteria (trọng yếu)

**US-17** (UC-15, BUS-20/21/22) — *Là nhân viên đào tạo, tôi muốn nhập điểm tổng kết để hệ thống tự xác định Đạt/Không đạt.*
- AC1: Nhập `score` ngoài [0,10] → từ chối, báo lỗi rõ ràng.
- AC2: Sau khi lưu, `passed` được hệ thống tính tự động, không có trường nhập tay cho Đạt/Không đạt trên UI.
- AC3: Nếu học viên đã có lần học `passed = true` cho đúng môn đó, không cho tạo thêm lần học mới cho môn này (đã đạt thì không học lại — hệ thống chặn, không chỉ cảnh báo).
- AC4: Nếu Không đạt, hệ thống cho phép tạo lần học tiếp theo (`attempt_no + 1`) ở học kỳ sau, giữ nguyên lịch sử lần trước.

**US-18** (UC-16, BUS-22) — *Là học viên, tôi muốn xem tổng tín chỉ tích lũy và biết còn thiếu bao nhiêu tín chỉ bắt buộc/tự chọn.*
- AC1: Trang hiển thị: tổng tín chỉ bắt buộc đã đạt / tối thiểu cần; tổng tín chỉ tự chọn đã đạt / tối thiểu cần.
- AC2: Danh sách toàn bộ các lần học (kể cả học lại) hiển thị theo môn, có đánh dấu lần nào được tính tín chỉ.
- AC3: Học viên không có quyền chỉnh sửa bất kỳ điểm/trạng thái nào trên trang này (read-only).

**US-19** (UC-19, BUS-23/24) — *Là nhân viên đào tạo, tôi muốn hệ thống tự chặn việc gán luận văn nếu học viên chưa đủ tín chỉ.*
- AC1: Khi tạo đề tài, nếu tín chỉ tích lũy hiện tại < `programs.thesis_credits_min` → hệ thống từ chối, thông báo rõ số tín chỉ còn thiếu.
- AC2: Không cho tạo đề tài thứ hai nếu học viên đang có đề tài `NOT_STARTED`/`IN_PROGRESS`.
- AC3: Đổi trạng thái sang `CANCELLED` mở khoá cho phép tạo đề tài mới; đổi sang `COMPLETED` không tự tạo lại.

**US-20** (UC-13, BUS-16/25) — *Là nhân viên đào tạo, tôi muốn đổi trạng thái học tập và hệ thống tự chặn đăng ký học phần khi không còn "Đang học".*
- AC1: Đổi trạng thái sang `SUSPENDED`/`GRADUATED`/`WITHDRAWN` → lần gọi RPC đăng ký học phần tiếp theo của học viên đó bị từ chối ở tầng DB (không chỉ tầng UI).
- AC2: Dữ liệu điểm/luận văn hiện có của học viên không bị ảnh hưởng khi đổi trạng thái.

---

## G. Business flows

### G.1 Gán học viên vào chương trình/khóa (UC-12)
1. Staff mở hồ sơ học viên (đã tồn tại `profiles`, role=STUDENT).
2. Chọn `program_id` → hệ thống chỉ hiển thị các `cohort` thuộc chương trình đó.
3. Chọn `cohort_id`.
4. Lưu → validate: chương trình đã cấu hình đủ 3 ngưỡng (BUS-19), nếu chưa → chặn với thông báo "chương trình chưa cấu hình đầy đủ".
5. `academic_status` mặc định `STUDYING` nếu học viên chưa có giá trị (ví dụ lần gán đầu tiên).
6. Ghi nhận — không có bước "duyệt", hiệu lực ngay (staff-only action).
7. **Đổi chương trình/khóa sau lần gán đầu (BUS-26):** RPC kiểm tra học viên chưa có `enrollments`/`enrollment_grades`/`theses` nào; nếu đã có, từ chối với thông báo "học viên đã có dữ liệu học tập, không thể đổi chương trình/khóa".

### G.2 Nhập điểm và cập nhật tiến độ (UC-15 → UC-16)
1. Staff chọn học viên + môn học (trong danh sách môn của chương trình học viên).
2. Hệ thống kiểm tra: đã có `attempt` nào `passed=true` cho môn này chưa → nếu có, chặn (BUS-22 hệ quả).
3. Nếu chưa, tạo dòng `enrollment_grades` mới với `attempt_no` kế tiếp, `score` nhập vào.
4. Hệ thống tự tính `passed = (score >= programs.pass_score_min)`.
5. Ghi `graded_at`, `graded_by`.
6. Tiến độ tín chỉ của học viên (view/RPC tổng hợp) tự cập nhật theo thời gian thực khi truy vấn — không cần bước "cập nhật" riêng vì không lưu counter.

### G.3 Học lại (UC-15, lần 2+)
1. Điều kiện: tồn tại `attempt` gần nhất của môn đó với `passed=false` (không có `attempt` nào `passed=true`).
2. Staff tạo dòng điểm mới cho học kỳ sau: `attempt_no = max(attempt_no đã có) + 1`.
3. Lần học trước giữ nguyên, không sửa/xoá (append-only, giống `enrollment_history` MVP).
4. Nếu lần học lại đạt → tín chỉ được cộng (lần đầu tiên đạt), các lần sau (nếu học viên vẫn tiếp tục học dù đã đạt — không nên xảy ra do bị chặn ở G.2 bước 2).

### G.4 Phân công luận văn (UC-19)
1. Staff chọn học viên → hệ thống hiển thị tổng tín chỉ tích lũy hiện tại (tính real-time) so với `thesis_credits_min` của chương trình học viên.
2. Nếu chưa đủ → nút "Tạo đề tài" bị vô hiệu hoá / gọi RPC sẽ trả lỗi rõ ràng.
3. Nếu đủ và học viên chưa có đề tài `NOT_STARTED`/`IN_PROGRESS` → staff nhập tiêu đề, chọn giảng viên hướng dẫn từ danh mục `advisors`.
4. Lưu `theses` với `status = NOT_STARTED`.
5. Staff có thể cập nhật trạng thái theo tiến độ thực tế (`IN_PROGRESS` → `COMPLETED`/`CANCELLED`).

---

## H. Migration plan

Nguyên tắc: **không sửa 0000–0014**; migration mới bắt đầu từ **0015**, mỗi file một mối quan tâm, header comment trích BUS-code, theo đúng convention hiện tại. **Cập nhật quan trọng (DECIDED, áp dụng từ Batch 1 trở đi):** RLS cho các bảng mới ship **trong cùng batch** với bảng đó, không dồn vào một migration RLS tổng hợp cuối cùng như bản thiết kế trước — batch nào tạo bảng, batch đó cũng bật RLS + policy cho đúng các bảng mình tạo. Điều này làm dịch số thứ tự các migration RPC/luận văn/điểm số về phía sau một bước so với bản thiết kế trước, phản ánh đúng ở bảng dưới.

### H.1 Batch 1 — ĐÃ TRIỂN KHAI (local-only, chưa áp Supabase Cloud)

| # | File | Nội dung |
|---|---|---|
| 0015 | `0015_programs_and_cohorts.sql` | Bảng `programs`, `cohorts` + `set_updated_at` triggers + check constraints (BUS-17, BUS-19) |
| 0016 | `0016_program_courses.sql` | Bảng `program_courses`, quan hệ nhiều-nhiều `courses`↔`programs`, unique `(program_id, course_id)` (BUS-18) |
| 0017 | `0017_rls_academic_catalog.sql` | Bật RLS + policy cho cả 3 bảng trên trong cùng batch: Training Staff full read/write, **Student chưa có quyền đọc** (quyết định phạm vi Batch 1 — khác với giả định "student SELECT danh mục" ở bản thiết kế trước; xem L.1 mục 7) |

### H.2 Batch 2–6 — dự kiến, số thứ tự dịch lại do RLS đã tách theo batch ở Batch 1

| # | File dự kiến | Nội dung |
|---|---|---|
| 0018 | `0018_profiles_academic_extension.sql` | `ALTER TABLE profiles ADD COLUMN program_id, cohort_id, academic_status` (nullable trước); **backfill** `academic_status` cho toàn bộ role=STUDENT theo `student_status` (`ACTIVE`→`STUDYING`, `INACTIVE`→`SUSPENDED`); sau backfill đặt `academic_status NOT NULL`; trigger kiểm tra `cohort_id` thuộc đúng `program_id`; trigger sync một chiều `academic_status` → `student_status` (BUS-25) |
| 0019 | `0019_rls_profiles_academic_extension.sql` | RLS cho các cột mới trên `profiles` (student chỉ đọc hồ sơ của chính mình, đã có sẵn từ 0007; không cần policy mới trừ khi thêm bảng phụ) |
| 0020 | `0020_enrollment_grades.sql` | Bảng `enrollment_grades`, `enrollment_id` **NOT NULL + unique** FK → `enrollments`, check score 0–10, unique `(student_id, course_id, attempt_no)`, trigger tự tính `passed`, trigger chặn UPDATE/DELETE cho dòng đã có `graded_at` |
| 0021 | `0021_rls_enrollment_grades.sql` | RLS cho `enrollment_grades`: Training Staff toàn quyền, student chỉ SELECT dòng của chính mình |
| 0022 | `0022_rpc_register_for_class_academic_status.sql` | Sửa **thân hàm** `register_for_class` (`CREATE OR REPLACE FUNCTION` cùng tên, không sửa file 0008 gốc) để bổ sung điều kiện `academic_status = 'STUDYING'` (BUS-16) |
| 0023 | `0023_rpc_student_credit_progress.sql` | RPC `get_student_credit_progress(p_student_id)` (BUS-22) |
| 0024 | `0024_rpc_record_course_grade.sql` | RPC `record_course_grade(p_student_id, p_course_id, p_score)` (BUS-20/21/22) |
| 0025 | `0025_advisors.sql` | Bảng `advisors` |
| 0026 | `0026_theses.sql` | Bảng `theses`, partial unique index (BUS-24) |
| 0027 | `0027_rls_advisors_and_theses.sql` | RLS cho `advisors` (Training Staff toàn quyền) và `theses` (Training Staff toàn quyền, student chỉ SELECT của chính mình) |
| 0028 | `0028_rpc_assign_thesis.sql` | RPC `assign_thesis(p_student_id, p_advisor_id, p_title)` (BUS-23/24) |
| 0029 | `0029_rpc_update_thesis_status.sql` | RPC `update_thesis_status(p_thesis_id, p_status)` |
| 0030 | `0030_rpc_assign_student_program.sql` | RPC `assign_student_to_program(p_student_id, p_program_id, p_cohort_id)` — kiểm tra BUS-19, BUS-26 |

**Impact với dữ liệu seed/QA hiện có (Batch 1):**
- Migrations 0015–0017 chỉ thêm bảng mới (`programs`, `cohorts`, `program_courses`), không có FK ngược vào bảng MVP (`profiles`, `enrollments`, ...) → không ảnh hưởng dữ liệu MVP hiện có.
- `supabase/seed.sql` được cập nhật với 1 chương trình mẫu (`CS-MASTER`), 1 khóa mẫu (`K2026`), và gán 4 môn học demo sẵn có (`CS601`/`CS602`/`CS603` bắt buộc, `MG601` tự chọn) vào chương trình — idempotent (`on conflict ... do nothing`), **chưa áp dụng lên Supabase Cloud** trong lượt này.
- Migrations 0018+ (backfill `academic_status`, sửa RPC lõi) thuộc Batch 2/4, ngoài phạm vi Batch 1 này.

**RLS (Batch 1):** đã ship trong 0017, ngay trong cùng batch với 0015/0016 — không còn dồn về một migration RLS cuối. Tuân thủ pattern hiện tại: mọi ghi dữ liệu qua route Express dùng user-scoped Supabase client (không dùng service role); RLS là lớp phòng thủ thứ hai, Express `requireRole('TRAINING_STAFF')` là lớp kiểm tra độc lập ở tầng API.

---

## I. API và UI plan

### I.1 API endpoints — Batch 1 ĐÃ TRIỂN KHAI (`apps/api/src/routes/academic.ts`, `requireRole('TRAINING_STAFF')`)

- `GET /staff/programs`, `GET /staff/programs/:id`, `POST /staff/programs`, `PATCH /staff/programs/:id`
- `GET /staff/cohorts?programId=`, `POST /staff/cohorts`, `PATCH /staff/cohorts/:id`
- `GET /staff/program-courses?programId=`, `POST /staff/program-courses`, `PATCH /staff/program-courses/:id` (đổi REQUIRED ⇄ ELECTIVE)

Không có endpoint DELETE cho cả 3 tài nguyên (không hard delete, theo quyết định chốt). Không có endpoint nào cho Student trong Batch 1 (student chưa có quyền đọc danh mục này — quyết định phạm vi Batch 1, xem H.1/L.1 mục 7).

### I.1b API endpoints — dự kiến các batch sau (chưa triển khai)

**Staff** (`/api/staff/*`, `requireRole('TRAINING_STAFF')`):
- `GET /staff/students`, `POST /staff/students/:id/assign-program` → RPC `assign_student_to_program`
- `PATCH /staff/students/:id/academic-status`
- `GET /staff/students/:id/grades`, `POST /staff/students/:id/grades` → RPC `record_course_grade`
- `GET /staff/students/:id/credit-progress` → RPC `get_student_credit_progress`
- `GET/POST /staff/advisors`, `PATCH /staff/advisors/:id`
- `GET /staff/theses`, `POST /staff/theses` → RPC `assign_thesis`
- `PATCH /staff/theses/:id/status` → RPC `update_thesis_status`

**Student** (`/api/student/*`, `requireRole('STUDENT')`):
- `GET /student/profile` (bao gồm chương trình, khóa, trạng thái)
- `GET /student/grades` (toàn bộ lịch sử điểm, kể cả học lại)
- `GET /student/credit-progress`
- `GET /student/thesis`

### I.2 Trang Student mới
- **"Chương trình của tôi"** — hiển thị chương trình, khóa, trạng thái học tập, danh sách môn bắt buộc/tự chọn (read-only).
- **"Kết quả học tập"** — bảng điểm theo môn, đánh dấu lần học lại, tổng tín chỉ bắt buộc/tự chọn đã đạt vs. tối thiểu cần.
- **"Luận văn của tôi"** — đề tài, giảng viên hướng dẫn, trạng thái (nếu chưa có đề tài: empty state giải thích điều kiện tín chỉ còn thiếu).

### I.3 Trang Staff

- **"Chương trình đào tạo"** (`/staff/programs`, `StaffPrograms.tsx`) — **ĐÃ TRIỂN KHAI (Batch 1)**: danh sách chương trình + tạo mới với đủ 4 cấu hình (tín chỉ bắt buộc/tự chọn tối thiểu, điểm đạt tối thiểu, tín chỉ tối thiểu luận văn); không có delete.
- **Chi tiết chương trình** (`/staff/programs/:id`, `StaffProgramDetail.tsx`) — **ĐÃ TRIỂN KHAI (Batch 1)**: sửa cấu hình chương trình; danh sách + tạo khóa thuộc chương trình; danh sách + gán môn học (chọn REQUIRED/ELECTIVE) + đổi phân loại; không có delete cho khóa hay môn đã gán.
- **"Khóa học"** — không có trang danh sách khóa độc lập trong Batch 1; quản lý khóa nằm trong trang chi tiết chương trình (một khóa luôn thuộc đúng một chương trình, BUS-17).
- **"Học viên"** — chưa triển khai (Batch 2).
- **"Giảng viên hướng dẫn"** — chưa triển khai (Batch 5).
- **"Luận văn"** — chưa triển khai (Batch 5).

### I.4 Loading/error/empty states (bắt buộc cho tất cả trang trên, theo pattern hiện có trong `StaffCourseClasses.tsx`/`StudentClasses.tsx`)
- Loading: skeleton/spinner nhất quán với UI hiện tại, không chặn nav.
- Error: hiển thị message từ `utils/response.ts` error envelope hiện có, có nút "Thử lại".
- Empty states cụ thể:
  - Học viên chưa gán chương trình → "Bạn chưa được gán chương trình đào tạo, liên hệ nhân viên đào tạo."
  - Chưa có điểm nào → "Chưa có kết quả học tập."
  - Chưa đủ tín chỉ luận văn (staff view) → hiện rõ "còn thiếu N tín chỉ" thay vì ẩn nút.
  - Chưa có đề tài luận văn (student view) → thông báo trung tính, không suy đoán lý do nếu do staff chưa tạo (khác với "chưa đủ điều kiện").

---

## J. Test plan

### J.1 Business rule (BUS-16..26)
- Học viên `SUSPENDED`/`WITHDRAWN`/`GRADUATED` không đăng ký được lớp (BUS-16) — cả qua RPC trực tiếp lẫn qua API.
- Trùng `program.code`/`cohort.code` trong cùng chương trình bị chặn (BUS-17).
- Gán 1 môn vừa REQUIRED vừa ELECTIVE trong cùng chương trình bị chặn (BUS-18).
- Gán học viên vào chương trình chưa đủ 3 ngưỡng cấu hình bị chặn (BUS-19).
- Nhập điểm ngoài [0,10] bị từ chối; điểm hợp lệ tự tính đúng `passed` theo ngưỡng chương trình (BUS-20).
- Học lại sau khi không đạt tạo đúng `attempt_no` kế tiếp, giữ nguyên lịch sử (BUS-21).
- Đã đạt 1 lần → không cho tạo thêm lần học cho cùng môn (BUS-21/22).
- Tín chỉ chỉ cộng 1 lần dù có nhiều lần học đạt (không nên xảy ra do bị chặn, nhưng cần test phòng thủ ở tầng tính toán) (BUS-22).
- Gán luận văn khi thiếu tín chỉ bị từ chối với thông báo đúng (BUS-23).
- Tạo đề tài thứ 2 khi đề tài 1 đang `IN_PROGRESS` bị chặn; tạo được sau khi đề tài 1 `CANCELLED` (BUS-24).
- Đổi `academic_status` chỉ staff làm được; học viên gọi thẳng RPC (nếu có JWT) bị RLS chặn; sau khi đổi, `student_status` tự cập nhật đúng chiều (`STUDYING`→`ACTIVE`, còn lại→`INACTIVE`) và không có chiều ngược (sửa `student_status` trực tiếp không ảnh hưởng `academic_status`) (BUS-25).
- Backfill migration 0018 (`profiles_academic_extension`): mọi học viên có `student_status=ACTIVE` trước migration → `academic_status=STUDYING` sau migration; `student_status=INACTIVE` → `academic_status=SUSPENDED`; không còn học viên nào có `academic_status IS NULL` sau migration (constraint NOT NULL phải reject insert thiếu giá trị) (BUS-16 tiền đề).
- Đổi `program_id`/`cohort_id` của học viên đã có `enrollments`/`enrollment_grades`/`theses` bị chặn ở mọi đường (RPC, RLS); đổi được khi học viên chưa có dữ liệu nào ở cả ba nguồn (BUS-26).

### J.2 RBAC/RLS
- Student không gọi được bất kỳ RPC/endpoint staff-only nào (403 ở Express + RLS deny ở DB nếu bypass Express).
- Student chỉ SELECT được `enrollment_grades`/`theses` của chính mình, không thấy của học viên khác (test bằng 2 JWT khác nhau).
- **Batch 1 (đã triển khai, cập nhật so với dự thảo ban đầu):** `programs`/`cohorts`/`program_courses` **không có** policy SELECT cho student — chỉ Training Staff đọc/ghi được (xem H.1). Test đã xác nhận qua route-level `requireRole('TRAINING_STAFF')`; xác minh RLS-level (student JWT gọi trực tiếp Supabase) còn nằm trong mục "chưa thể test do không có local Supabase" của báo cáo Batch 1.
- Danh mục `advisors` (Batch 5): dự kiến Training Staff toàn quyền; quyết định có cho student SELECT hay không sẽ chốt cùng lúc với Batch 5.

### J.3 Data integrity
- Unique constraints: `(program_id, course_id)`, `(student_id, course_id, attempt_no)`, partial unique `theses(student_id) WHERE status IN (...)`.
- Trigger chặn UPDATE/DELETE trên `enrollment_grades` sau khi đã chấm (append-only).
- `cohort_id` của một `profiles` luôn thuộc đúng `program_id` của chính hồ sơ đó (trigger cross-column check).
- Cascade behavior: xoá `advisors` khi đang gán cho `theses` hiệu lực → nên chặn (RESTRICT), không cascade xoá đề tài.

### J.4 Regression cho module đăng ký học phần cũ (bắt buộc do 0022 sửa RPC lõi)
- Toàn bộ 33 test case hiện có trong `08_Test_Cases.md` áp cho BUS-01..15 phải PASS lại, đặc biệt: đăng ký thành công điều kiện thường (BUS-01/03/04/05/06/07), self-cancel (BUS-08), lịch sử (BUS-09), hủy lớp bởi staff (BUS-10/11), lịch nhiều buổi (BUS-12), 1 đợt/kỳ (BUS-13), lớp phải thuộc đúng 1 đợt (BUS-14), display status derive đúng lúc (BUS-15).
- Test case bổ sung: chạy migration 0018 trên bản sao dữ liệu QA hiện có, xác nhận 100% học viên có `academic_status` xác định (không NULL) và giá trị đúng theo mapping backfill trước khi 0022 được áp dụng.
- Concurrency test lại theo `docs/DB_CONCURRENCY_TEST_PLAN.md` cho `register_for_class` sau khi sửa thân hàm.

### J.5 Batch 1 — test đã bổ sung (local, không cần Supabase)
- `apps/api/src/schemas/academic.test.ts` (chạy bằng `npm run test --workspace apps/api`, dùng `node:test`): xác nhận Zod schema chặn `requiredCreditsMin<=0`, `electiveCreditsMin<0`, `passScoreMin` ngoài [0,10], `thesisCreditsMin<0`, mã/tên rỗng (BUS-19 tiền đề); `programId` phải là UUID (BUS-17); `requirementType` chỉ nhận `REQUIRED`/`ELECTIVE` (BUS-18).
- Các luật cần DB thật để verify đầy đủ (unique constraint, RLS deny cho student, FK) nằm trong mục "chưa thể test do không có local Supabase" của báo cáo Batch 1 bên dưới.

---

## K. Phased implementation plan (batch nhỏ, review/test độc lập)

1. **Batch 1 — Danh mục nền tảng — ĐÃ TRIỂN KHAI (local-only, chưa áp Supabase Cloud):** migrations 0015–0017 (`programs`, `cohorts`, `program_courses` + RLS cùng batch) + staff CRUD API (`apps/api/src/routes/academic.ts`) + UI (`StaffPrograms.tsx`, `StaffProgramDetail.tsx`) cho chương trình/khóa/gán môn. Không đụng gì của MVP. Test: schema-level cho BUS-17/18/19 (`academic.test.ts`); DB-level (unique constraint, RLS deny) chưa verify được, xem báo cáo cuối.
2. **Batch 2 — Hồ sơ học viên mở rộng:** migration 0018 (`profiles` + 3 cột) + staff UI gán chương trình/khóa + đổi trạng thái học tập + student "Chương trình của tôi". Test: BUS-19/25/26, RLS cho cột mới.
3. **Batch 3 — Điểm & tiến độ tín chỉ:** migrations 0020, 0021, 0023, 0024 + staff nhập điểm UI + student "Kết quả học tập". Test: BUS-20/21/22 đầy đủ, không đụng RPC MVP.
4. **Batch 4 — Ràng buộc BUS-16 vào RPC đăng ký:** migration 0022 riêng biệt, kèm full regression suite J.4 trước khi merge. Phụ thuộc Batch 2 (backfill `academic_status` ở 0018 phải đã chạy và xác nhận không còn NULL) — vẫn là batch rủi ro cao nhất do sửa RPC lõi MVP, nhưng không còn phụ thuộc quyết định nghiệp vụ mở, chỉ còn phụ thuộc trình tự migration.
5. **Batch 5 — Luận văn:** migrations 0025, 0026, 0027, 0028, 0029 (thesis + advisors + RLS + RPC) + staff "Giảng viên hướng dẫn" + "Luận văn" + student "Luận văn của tôi". Phụ thuộc Batch 3 (cần tiến độ tín chỉ để tính BUS-23).
6. ~~Batch 6 — RLS tổng hợp~~ — **đã loại bỏ (DECIDED):** RLS ship trong từng batch cùng với bảng nó bảo vệ (đã áp dụng từ Batch 1, migration 0017), không còn migration RLS tổng hợp cuối cùng.

Mỗi batch: 1 PR, có migration + RLS + RPC + API + UI + test cho đúng phạm vi batch đó, không phụ thuộc ngược vào batch sau.

---

## L. Assumptions — decided vs. open

### L.1 DECIDED (đã chốt trong lượt cập nhật này)

1. ~~`academic_status` cho học viên dữ liệu cũ~~ — **DECIDED:** enum `STUDYING`/`SUSPENDED`/`GRADUATED`/`WITHDRAWN`; backfill bắt buộc từ `student_status` (`ACTIVE`→`STUDYING`, `INACTIVE`→`SUSPENDED`); cột `NOT NULL` sau backfill, không còn học viên nào NULL.
2. ~~Đồng bộ `student_status` ↔ `academic_status`~~ — **DECIDED:** `academic_status` là nguồn nghiệp vụ chính; chỉ sync **một chiều** `academic_status` → `student_status` (`STUDYING`→`ACTIVE`; còn lại→`INACTIVE`), không có cơ chế sync ngược. Mọi rule/RPC nghiệp vụ mới (kể cả BUS-16 trong `register_for_class`) phải kiểm tra `academic_status`, không dùng `student_status`.
3. ~~Đổi chương trình/khóa sau khi đã gán~~ — **DECIDED:** cho phép đổi **chỉ khi** học viên chưa có bất kỳ `enrollments`/`enrollment_grades`/`theses` nào liên kết (BUS-26); ngay khi có dữ liệu ở một trong ba nguồn, `program_id`/`cohort_id` bất biến.
4. ~~Môn học dùng chung nhiều chương trình~~ — **DECIDED:** `courses` và `programs` là quan hệ nhiều-nhiều qua `program_courses`; một môn có thể vừa bắt buộc ở chương trình A vừa tự chọn ở chương trình B.
5. ~~`enrollment_id` bắt buộc hay tuỳ chọn~~ — **DECIDED:** bắt buộc (NOT NULL) và unique — mỗi lần học trong `enrollment_grades` phải gắn đúng một `enrollment` MVP, không cho nhập điểm rời rạc không qua đăng ký lớp.
6. ~~RLS staff giới hạn theo chương trình phụ trách~~ — **DECIDED:** không giới hạn; Training Staff quản lý toàn bộ dữ liệu học viên/chương trình trong MVP này, không có khái niệm "phụ trách chương trình X".
7. ~~RLS ship theo batch hay dồn Batch 6~~ — **DECIDED:** RLS ship trong cùng batch với bảng nó bảo vệ, ngay từ Batch 1 (migration 0017); không còn "Batch 6 RLS tổng hợp" (xem K, mục 6).
8. ~~Seed mẫu cho Batch 1~~ — **DECIDED (phạm vi seed, không phải cloud action):** `supabase/seed.sql` đã có 1 chương trình mẫu, 1 khóa mẫu, và 4 môn học gán vào chương trình, idempotent; seed này **chưa được áp dụng lên Supabase Cloud** — chỉ tồn tại dưới dạng file, chờ người vận hành cloud tự quyết định thời điểm chạy.

### L.2 Còn mở (chưa quyết định, không tự bịa)

Không còn assumption nào chặn việc tiếp tục Batch 2 trở đi tại thời điểm này. Các quyết định UI/UX chi tiết cho Batch 2+ (ví dụ: gán chương trình có cần bước xác nhận riêng hay không) sẽ được nêu lại khi bắt đầu batch tương ứng, không suy đoán trước.

---

## Verdict

**BATCH 1 IMPLEMENTED (local-only) — READY FOR BATCH 2**

Batch 1 (danh mục `programs`/`cohorts`/`program_courses` + RLS cùng batch + API + UI + seed + test schema) đã triển khai đầy đủ ở phạm vi local: migrations 0015–0017, `apps/api/src/routes/academic.ts` + `apps/api/src/schemas/academic.ts`, trang `StaffPrograms.tsx`/`StaffProgramDetail.tsx`, mục nav "Chương trình đào tạo", `supabase/seed.sql` cập nhật, test `academic.test.ts` (11/11 pass). Toàn bộ 6 quyết định chốt ở lượt trước loại bỏ mọi blocker nghiệp vụ đã nêu, bao gồm cả blocker từng chặn Batch 4. Chưa có Supabase Cloud/local nào được áp dụng — xem báo cáo cuối cho danh sách cloud action cần xác nhận riêng trước khi Batch 1 có thể chạy được trên môi trường thật.

### Đề xuất batch code tiếp theo
**Batch 2 — Hồ sơ học viên mở rộng** (migration 0018 `profiles_academic_extension` với backfill `academic_status`): phụ thuộc Batch 1 đã có `programs`/`cohorts` để `profiles.program_id`/`cohort_id` tham chiếu tới.
