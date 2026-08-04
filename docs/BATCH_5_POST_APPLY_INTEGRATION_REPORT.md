# Batch 5 Post-Apply Integration Test — True Concurrency + CSV HTTP

**Ngày:** 2026-08-04
**Phạm vi:** hai bài test còn lại từ `docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md` verdict `BATCH 5 APPLIED — POST-APPLY CONCURRENCY AND CSV HTTP TEST REQUIRED` — (A) true two-connection concurrency của `staff_confirm_graduation` trên chính schema Cloud đã apply, (B) CSV export ở tầng HTTP thật qua API đang chạy. Cả hai đều **không thể test được trước khi apply** (yêu cầu DDL đã commit/visible cho session/process thứ hai) — nay Batch 5 (0039–0049) đã apply vĩnh viễn (`docs/BATCH_5_PRE_APPLY_SECURITY_REVIEW.md`, mục "PERMANENT APPLY"), hai test này thực hiện được.

**Ghi chú permanent write duy nhất trong lượt test này:** xác nhận tốt nghiệp thật (`staff_confirm_graduation`) cho đúng 1 QA student fixture có sẵn (`QATMP-B5-FIX-9da3ce-*`, `student_id = 4100f37e-480d-4c4c-a220-7efa1f43fa35`), theo đúng phạm vi được cho phép. Đây là ghi dữ liệu vĩnh viễn duy nhất, không rollback (khác toàn bộ test trước đó trong review gốc, vốn luôn `BEGIN…ROLLBACK`).

---

## A. True concurrency test — `staff_confirm_graduation`

### A.1 Preflight (read-only)
- `supabase migration list`: remote = local = `0000`–`0049` đầy đủ. **Confirmed.**
- QA student (`4100f37e…`): `academic_status=STUDYING`, `student_status=ACTIVE`. **Confirmed.**
- `select count(*) from graduation_records where student_id=<QA>`: `0` trước khi test. **Confirmed.**
- `select * from public._compute_graduation_eligibility('<QA>')`: `eligibility_status=ELIGIBLE`, `reasons=[]`, đầy đủ snapshot field (`program_id`, `thesis_id=d99ad306…`, `thesis_completed_at=2026-08-04 08:06:47…`). **Confirmed.** Baseline đúng như yêu cầu — tiếp tục test, không BLOCKED.
- Staff profile dùng để impersonate qua `request.jwt.claims`: TRAINING_STAFF `a28e4daa-9d04-4867-83af-e38d1f5510c7` (profile có sẵn, không tạo mới, không đổi mật khẩu — chỉ dùng `id` cho `set local request.jwt.claims`, không cần JWT thật ở lớp SQL này, giống pattern `docs/DB_CONCURRENCY_TEST_PLAN.md`).

### A.2 Phương pháp
Hai kết nối `psql "$SUPABASE_DB_URL"` **độc lập, thật, đã commit** (không phải `BEGIN…ROLLBACK` như mọi test trước đây trong review gốc) — vì mục tiêu lần này chính là để lộ hành vi thật vĩnh viễn của lock/constraint trên schema đã apply:

- **Session A**: `BEGIN` → `set local role authenticated` + `set local request.jwt.claims` (staff) → gọi `staff_confirm_graduation(<QA>)` → **giữ transaction mở 15 giây** (`pg_sleep(15)`) trước khi `COMMIT`.
- **Session B**: khởi động ~vài giây sau khi A đã gọi xong RPC của nó (A đang trong lúc `pg_sleep`) → `BEGIN` → cùng role/claims staff → gọi cùng `staff_confirm_graduation(<QA>)` cho cùng QA student → `ROLLBACK` (B không ghi gì, chỉ đọc kết quả RPC).

Không dùng SQL trực tiếp để set `GRADUATED` hay insert `graduation_records` — toàn bộ ghi dữ liệu đi qua đúng RPC `staff_confirm_graduation`.

### A.3 Bằng chứng block thật (lock contention)

| Mốc thời gian | Session A | Session B |
|---|---|---|
| `staff_confirm_graduation` call — thời gian thực thi | **41.578 ms** (`\timing`) | **1448.878 ms** (`\timing`) — chậm hơn A ~35 lần dù cùng RPC, cùng dữ liệu |
| Thời điểm hoàn tất câu lệnh | `a_after_confirm_holding_open = 14:12:48.639403+00` | `b_after_confirm_returned = 14:13:03.823025+00` |
| `COMMIT` của A hoàn tất lúc | `a_after_commit = 14:13:03.819323+00` | — |

**B's confirm call chỉ trả về 4 ms sau khi A's COMMIT hoàn tất** (`14:13:03.823025` vs `14:13:03.819323`) — không phải trùng hợp: B's câu lệnh khác trong cùng session (`BEGIN`/`SET`) chỉ mất 33–40 ms, nên độ trễ 1448.878 ms riêng cho câu gọi RPC chỉ giải thích được bằng việc B đang chờ lock `for update` trên dòng `profiles` mà A giữ (`0045_rpc_staff_confirm_graduation.sql:32`), và được giải phóng đúng lúc A `COMMIT`. Đây là bằng chứng runtime trực tiếp, không phải suy luận tĩnh.

### A.4 Kết quả sau khi lock giải phóng
- Session A: `staff_confirm_graduation` trả về `{"success":true,"graduation_record":{...}}` với snapshot đầy đủ (program/cohort/credits/thesis/`confirmed_by`/`confirmed_at`/`eligibility_rules_version`). Commit thành công.
- Session B: `staff_confirm_graduation` trả về `{"reason":"already_graduated","success":false}` — **đúng theo thiết kế**, không tạo dòng thứ hai, không lỗi, không deadlock. `ROLLBACK` (B không ghi gì cả, ngay cả khi RPC nó gọi có thể ghi — thực tế RPC B gọi trả `success:false` nên tự nó không ghi; `ROLLBACK` chỉ để đóng session sạch sẽ).

### A.5 Hậu kiểm chỉ-đọc (post-test)
| Check | Kết quả |
|---|---|
| Số dòng `graduation_records` cho QA student | **1** (đúng 1, không trùng) |
| Tổng số dòng `graduation_records` toàn DB | **1** (không có dòng nào khác bị tạo ngoài ý muốn) |
| Snapshot record | `program_code=QATMP-B5-FIX-9da3ce-PROG`, `cohort_code=QATMP-B5-FIX-9da3ce-COHORT`, `thesis_code=LV-2026-0012`, `required_credits_min=1`, `elective_credits_min=0`, `required_credits_earned=3`, `elective_credits_earned=0`, `thesis_completed_at=2026-08-04 08:06:47.258047+00`, `confirmed_by=a28e4daa…` (đúng staff profile dùng để test), `eligibility_rules_version=v1` |
| `profiles.academic_status` / `student_status` của QA student | `GRADUATED` / `INACTIVE` (đúng trigger 0018 tự động sync qua `academic_status` update trong RPC) |
| `theses` của QA student | không đổi — vẫn 1 dòng, `status=COMPLETED`, `completed_at` giữ nguyên |

### A.6 Kết luận mục A
**PASS.** `FOR UPDATE` lock trên `profiles` (0045) hoạt động đúng như thiết kế dưới concurrency thật, không phải suy luận tĩnh: Session B thực sự bị chặn (thời gian thực thi bất thường, thời điểm trả về khớp gần như tuyệt đối với thời điểm A commit), không có race tạo 2 `graduation_records`, không deadlock. `UNIQUE(student_id)` constraint không cần can thiệp (logic RPC đã chặn trước khi tới bước insert) — cả hai lớp phòng thủ (lock + constraint) nhất quán với review gốc.

---

## B. CSV HTTP test

### B.1 Server
Một tiến trình API local (`node.exe`, PID quan sát được, chạy `apps/api` qua `tsx watch src/index.ts`, cổng `4000`) **đã chạy sẵn từ trước phiên làm việc này** (không phải do phiên này khởi động — nỗ lực tự chạy `npm run dev` bị lỗi `EADDRINUSE` vì cổng đã bận). Xác nhận đây đúng là API của dự án qua `GET /api/health` → `{"ok":true,"data":{"status":"ok","service":"gcrs-api"}}`, và `GET /api/staff/graduation/export.csv` không token → `401` (route tồn tại, yêu cầu auth — đúng route Batch 5). Vì tiến trình này không do phiên này khởi động, phiên này **không dừng nó** ở bước cuối (chỉ dừng những gì tự mình khởi động — không có tiến trình nào khác do phiên này khởi động cần dừng).

### B.2 Đăng nhập TRAINING_STAFF
Password grant thật qua Supabase Auth REST (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`) dùng `DEMO_STAFF_EMAIL`/`DEMO_STAFF_PASSWORD` có sẵn trong `apps/api/.env` — **không seed, không tạo/reset Auth user**. Access token nhận được, ghi tạm ra file scratch (ngoài repo), **không bao giờ in ra output**, và bị xóa ngay sau khi dùng xong test.

### B.3 Kết quả HTTP
| Check | Kết quả |
|---|---|
| `GET /api/staff/graduation/export.csv` (không filter) | **HTTP 200** |
| `Content-Type` | `text/csv; charset=utf-8` ✓ |
| `Content-Disposition` | `attachment; filename="graduation-export.csv"` ✓ (filename cố định, không nội suy dữ liệu) |
| UTF-8 BOM ở đầu response | ✓ — 3 byte đầu `EF BB BF` xác nhận bằng `xxd` |
| Số cột | **10/10** đúng thiết kế: `mã học viên, họ tên, chương trình, khóa, academic status, eligibility status, tín chỉ bắt buộc đạt, tín chỉ tự chọn đạt, luận văn hoàn thành, điều kiện còn thiếu` |
| RFC 4180 parse | ✓ — parser tự viết (quote/escape/CRLF-aware) parse sạch 5 dòng (1 header + 4 data), không có dòng gãy, kể cả field chứa dấu tiếng Việt và field `điều kiện còn thiếu` nối bằng `; ` |
| QA student (đã GRADUATED) xuất hiện đúng | ✓ — dòng `QATMP-B5-FIX-9da3ce-STU, QATMP-B5-FIX-9da3ce-Student, "", "", GRADUATED, NOT_APPLICABLE, "", "", "", not_studying` — khớp đúng finding P3 #5 đã ghi nhận trong review gốc (`academic_status≠STUDYING` → `NOT_APPLICABLE`/`reasons=[not_studying]`, hành vi đã biết trước, không phải bug mới) |
| Filter `?academic_status=GRADUATED` | ✓ — trả đúng **1 dòng** (chỉ QA student), không lộ học viên khác |
| Không có Authorization header (anon thật) | **HTTP 401** ✓ |
| Bearer token rác/không hợp lệ | **HTTP 401** ✓ |

### B.4 Giới hạn thật (không tô hồng)
- **Không verify được 403 cho một JWT STUDENT hợp lệ** (phân biệt "không có role đúng" khỏi "không xác thực được") — cả hai tài khoản demo student có sẵn trong `.env` (`DEMO_STUDENT1_*`, `DEMO_STUDENT2_*`) trả `invalid_credentials` khi đăng nhập thật (mật khẩu trong `.env` hiện không khớp Cloud, có thể đã bị đổi ở một lần chạy trước). Theo đúng ràng buộc của task này (không được reset mật khẩu/tạo Auth user), không có cách hợp lệ nào để lấy JWT STUDENT thật trong phạm vi cho phép. Đã verify **anon thật (không token) → 401** và **token rác → 401** — cả hai đều đúng hành vi mong đợi của `requireAuth` middleware. Việc route còn có thêm `requireRole('TRAINING_STAFF')` (chặn STUDENT có JWT hợp lệ nhưng sai role) **chỉ được xác nhận ở tầng static review** (`graduation.ts:23`, đã ghi trong review gốc mục 6), **chưa được re-verify bằng JWT STUDENT thật ở lượt test này** — ghi nhận đây là giới hạn thật, không tuyên bố đã test.
- **Formula injection tại tầng HTTP: không test với payload thật.** Theo đúng ràng buộc "không sửa dữ liệu thành chuỗi độc hại chỉ để test", lượt test này **không** tạo/sửa bất kỳ field nào (`full_name`, v.v.) thành giá trị bắt đầu bằng `=`/`+`/`-`/`@`. Cơ chế escaping (`escapeCsvField`, `apps/api/src/lib/csv.ts:16-25`) đã được xác nhận qua static review (review gốc mục 5) và có unit test nguồn (`csv.test.ts`, theo implementation report) bao phủ đúng case này. Lượt test HTTP này **chỉ xác nhận transport/BOM/RFC4180/header thật với dữ liệu hiện hữu** (không có field nào trong dữ liệu QA/demo hiện tại bắt đầu bằng các ký tự đó) — **không** tuyên bố đã runtime-test hành vi chống formula-injection với payload độc hại thật.

### B.5 Kết luận mục B
**PASS** cho toàn bộ phần trong phạm vi cho phép (HTTP 200, header, BOM, 10 cột, RFC4180, filter, anon/invalid-token 401). Hai giới hạn ở B.4 là giới hạn thật của lượt test này (không phải thất bại của tính năng) — được ghi trung thực, không che giấu.

---

## Phạm vi thay đổi Cloud vĩnh viễn từ lượt test này

**Duy nhất một thay đổi dữ liệu vĩnh viễn**, đúng phạm vi được cho phép:
- 1 dòng `graduation_records` mới cho QA student `QATMP-B5-FIX-9da3ce-*` (`id=faeb7976-a5ab-4ec6-b41a-15fda9ed75f0`).
- `profiles.academic_status` của QA student: `STUDYING` → `GRADUATED`.
- `profiles.student_status` của QA student: `ACTIVE` → `INACTIVE` (tự động qua trigger `profiles_academic_guard`, 0018 — không có thao tác thủ công nào).

Không có migration mới, không `db push`, không migration repair, không seed/`seedDemoUsers`, không Admin API, không tạo/reset Auth user, không thay đổi dữ liệu QA/nghiệp vụ nào khác ngoài đúng 1 QA student được cho phép ở trên. Không commit/push/deploy — `graduate-course-registration-system` (và thư mục cha) không phải git repository.

---

## Verdict

**`READY FOR BATCH 5 COMMIT AND DEPLOY`**

Cả hai test còn lại từ verdict trước (`BATCH 5 APPLIED — POST-APPLY CONCURRENCY AND CSV HTTP TEST REQUIRED`) đã hoàn tất và **PASS**:
- **Concurrency**: `staff_confirm_graduation`'s `FOR UPDATE` lock đã được chứng minh chặn request thứ hai bằng bằng chứng thời gian thực (không phải suy luận tĩnh), không tạo trùng `graduation_records`, không deadlock.
- **CSV HTTP**: export endpoint trả đúng `200`, header, BOM, 10 cột, parse RFC4180 sạch, filter đúng phạm vi, và chặn đúng truy cập không xác thực.

Hai giới hạn trung thực còn lại (ghi rõ ở B.4, không phải blocker cho verdict này vì nằm ngoài phạm vi được phép của lượt test): (1) 403-cho-STUDING-JWT-hợp-lệ chưa re-verify bằng JWT thật (chỉ có static review), do không có credential demo student hợp lệ trong phạm vi cho phép; (2) formula-injection chỉ có bằng chứng static/unit-test, chưa có bằng chứng runtime HTTP với payload thật, theo đúng ràng buộc "không tạo dữ liệu độc hại chỉ để test" của task này.
