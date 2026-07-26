# Full-Stack Audit & Upgrade Plan — graduate-course-registration-system

Ngày thực hiện: 2026-07-26
Người thực hiện: Claude Code (Tech Lead / Principal Full-stack / Security Reviewer / QA Lead session)
Phạm vi: Giai đoạn 1–2 của quy trình audit — đọc toàn bộ repo, chạy typecheck/lint/build/test, không chạy migration/seed/RPC ghi dữ liệu, không đổi gì trên Supabase Cloud.

Ghi chú quan trọng: một báo cáo QA trước đó (`docs/QA_RELEASE_REPORT.md`, 2026-07-25) đã thực hiện một vòng audit + smoke test tương tự và kết luận **READY WITH LIMITATIONS**, với 1 blocker P1 (migration drift 0012) đã được resolve. Báo cáo này là một vòng audit độc lập, mới, đọc lại toàn bộ mã nguồn hiện tại (bao gồm 3 file đang có thay đổi chưa commit: `StudentClasses.tsx`, `StudentHistory.tsx`, `styles.css`) để xác nhận lại và tìm thêm các vấn đề còn sót.

---

## 0. Verdict

**READY WITH LIMITATIONS**

Codebase có chất lượng kỹ thuật cao hơn hẳn mức trung bình của một dự án CV/portfolio: kiến trúc bảo mật đúng đắn (JWT verify thật, RLS luôn có hiệu lực, secret key tách biệt hoàn toàn khỏi server runtime), toàn bộ business rule bắt buộc đều được cài đặt đúng ở tầng RPC/RLS với concurrency-safety thật (row locking), typecheck/lint/build/test đều sạch. Không phát hiện lỗi P0 nào ảnh hưởng đến 11 nghiệp vụ bắt buộc hoặc gây lộ secret/bypass bảo mật.

Vẫn còn một số điểm P1/P2 nên sửa trước khi đưa vào CV (rò rỉ chi tiết lỗi Postgres ra client, một số trạng thái loading/error frontend chưa hoàn thiện, thiếu test tự động cho RPC, chưa từng deploy thật lên Render/Vercel) — đây là lý do verdict dừng ở READY WITH LIMITATIONS chứ chưa phải READY TO DEPLOY.

## 1. Điểm số /10

| Hạng mục | Điểm | Ghi chú ngắn |
|---|---|---|
| Business rules (1–11 bắt buộc) | 9.5/10 | Toàn bộ 11 quy tắc đã VERIFIED đúng ở RPC/RLS/DB constraint. Trừ điểm nhẹ vì rule "không trùng môn cùng học kỳ" chỉ có hard-constraint ở mức unique-per-class, không phải unique-per-course (khoảng trống defense-in-depth, hiện được RLS chặn hoàn toàn nên chưa exploit được). |
| Database / RLS | 9/10 | RLS bật đầy đủ trên 8 bảng, mọi SECURITY DEFINER function có `search_path` an toàn (trừ 1 hàm trigger, P3), append-only history có cả grant-revoke lẫn trigger chặn UPDATE/DELETE, row locking đúng thứ tự tránh deadlock. |
| Security (auth/CORS/secrets) | 9/10 | JWT verify qua `auth.getUser()` thật (không tự decode), CORS origin cố định (không wildcard), secret key không có trong server runtime. Trừ điểm vì lỗi Postgres thô bị forward nguyên văn ra client (information disclosure nhẹ). |
| Backend/API | 8/10 | Middleware mounting đúng thứ tự, Zod validate mọi input ghi, status code chuẩn REST, RLS luôn có hiệu lực do dùng client scoped theo JWT người gọi. Trừ điểm vì error handler không có generic message riêng cho production. |
| Frontend/UI/UX | 7.5/10 | Double-submit được chặn ở mọi action ghi, loading/error/empty state có ở hầu hết trang, đã có UX cải tiến (dialog xác nhận, toast) trong bản WIP chưa commit. Trừ điểm vì `RequireRole` điều hướng sai-role về `/login` thay vì trang chủ đúng role, `api.ts` không guard `response.json()` khi response không phải JSON, thiếu timeout cho fetch. |
| Testing | 5/10 | Chỉ có 1 file vitest (3 test) cho một hàm thuần phía frontend; không có test cho RPC/business logic (chỉ có test plan thủ công), không có test cho Express routes. |
| Deployment | 7/10 | render.yaml, vercel.json, DEPLOYMENT.md đều chuẩn bị kỹ và đúng kỹ thuật (bind 0.0.0.0, đọc PORT, rewrite SPA, không có secret trong config). Trừ điểm vì **chưa từng deploy thật** — mọi thứ mới dừng ở "sẵn sàng deploy", chưa có bằng chứng chạy trên môi trường production thật. |
| Documentation | 8.5/10 | README, SETUP_SUPABASE, DEPLOYMENT, DB_CONCURRENCY_TEST_PLAN, QA_RELEASE_REPORT đều chi tiết, có traceability rule → migration → test. Trừ điểm vì thiếu tài liệu API (endpoint list/response shape) tập trung một chỗ. |

## 2. Danh sách lỗi/rủi ro theo mức độ

Chú thích trạng thái bằng chứng: **[Đã xác minh]** = đọc trực tiếp code và xác nhận; **[Rủi ro suy luận]** = có dấu hiệu rõ nhưng cần thêm ngữ cảnh runtime để chắc chắn 100%; **[Chưa thể kiểm chứng]** = không thể xác minh qua đọc code tĩnh (cần môi trường thật).

### P0 — Không có

Không phát hiện lỗi P0 nào (không có business rule nào bị vi phạm, không có RLS bị tắt, không có secret rò rỉ, không có auth bypass, không có build/typecheck/lint/test fail).

### P1

**P1-1. Lỗi Postgres/PostgREST thô bị forward nguyên văn ra client trên các nhánh lỗi chung** — **[Đã xác minh]**
- File: `apps/api/src/middleware/errorHandler.ts:15,17`; và 16 điểm gọi `sendError(res, 400, 'QUERY_ERROR'|'RPC_ERROR'|'INSERT_ERROR', error.message)` rải rác trong `apps/api/src/routes/staff.ts` (11 chỗ) và `apps/api/src/routes/student.ts` (5 chỗ).
- Bằng chứng: `errorHandler.ts:15` — `const message = err instanceof Error ? err.message : 'Unexpected error';` rồi gửi thẳng `message` này về client ở dòng 17 (`sendError(res, 500, 'INTERNAL_ERROR', message)`), không phân biệt môi trường dev/production.
- Tác động: Một lỗi nội bộ bất kỳ (constructor Supabase client lỗi, lỗi network, lỗi driver) có thể trả nguyên văn message về client — có thể lộ tên bảng/cột/constraint nội bộ hoặc chi tiết hạ tầng, hỗ trợ kẻ tấn công trong việc do thám (reconnaissance). Không lộ secret/token, nhưng vi phạm nguyên tắc "không leak internal detail" trong yêu cầu audit.
- Cách sửa: Thêm nhánh production-safe generic message ở `errorHandler.ts` cho lỗi 500 không xác định (giữ nguyên log server-side đầy đủ qua `console.error`), đồng thời rà lại các `sendError(..., error.message)` ở `staff.ts`/`student.ts` để chỉ forward message khi đã được map qua danh sách lỗi nghiệp vụ đã biết (như đã làm tốt cho `23505`/`23514`), fallback về message chung cho các mã lỗi Postgres khác.

**P1-2. `RequireRole` điều hướng người dùng sai-role về `/login` thay vì trang phù hợp với vai trò của họ** — **[Đã xác minh]**
- File: `apps/web/src/routes/RequireRole.tsx:26-27`
- Bằng chứng: `if (!profile || !allow.includes(profile.role)) { return <Navigate to="/login" replace />; }` — một student đã đăng nhập nhưng vô tình vào route `/staff/...` sẽ bị đá về `/login` (nơi họ đã đăng nhập rồi), gây cảm giác "bị đăng xuất" hoặc lỗi, thay vì được đưa về trang chủ đúng vai trò của họ.
- Tác động: UX gây nhầm lẫn khi demo cho nhà tuyển dụng/stakeholder (một liên kết sai role trông giống như một bug đăng nhập). Không phải lỗ hổng bảo mật (route guard chỉ là UX convenience, đã có comment xác nhận `apps/api` mới là security boundary thật).
- Cách sửa: Khi có `profile` nhưng role không nằm trong `allow`, điều hướng về trang chủ đúng role (`/student/classes` hoặc `/staff/registration-periods`) thay vì `/login`.

### P2

**P2-1. `api.ts` không guard `response.json()` khi response không phải JSON hợp lệ** — **[Đã xác minh]**
- File: `apps/web/src/lib/api.ts:40` — `const body = (await response.json()) as ApiSuccessBody<T> | ApiErrorBody;`
- Tác động: Nếu API trả về HTML (ví dụ trang lỗi 502 từ Render khi cold-start timeout, hoặc lỗi proxy), `response.json()` ném `SyntaxError` thô, không được bọc thành `ApiRequestError`. UI vẫn không crash (catch ở tầng gọi vẫn bắt được exception và hiện fallback text), nhưng message hiển thị cho người dùng sẽ chung chung/khó hiểu thay vì thông báo lỗi mạng rõ ràng.
- Cách sửa: Bọc `response.json()` trong try/catch, nếu parse lỗi thì ném `ApiRequestError` với message rõ ràng kiểu "Không thể kết nối máy chủ, vui lòng thử lại."

**P2-2. Không có timeout/AbortController cho `apiFetch`** — **[Đã xác minh]**
- File: `apps/web/src/lib/api.ts:31-38`
- Tác động: Trên Render Free (có cold-start ~vài chục giây đến 1 phút, đã ghi nhận trong `DEPLOYMENT.md`), nếu request treo lâu hơn dự kiến hoặc mạng lỗi, nút bấm (Đăng ký/Hủy) sẽ ở trạng thái "Đang gửi…" vô thời hạn, không có cách nào cho người dùng biết nên thử lại.
- Cách sửa: Thêm `AbortController` với timeout hợp lý (ví dụ 20–30s, cao hơn cold-start dự kiến), hiện thông báo lỗi timeout rõ ràng.

**P2-3. Rule "không trùng môn học cùng học kỳ" chỉ có unique constraint theo lớp (class), không theo môn (course)** — **[Rủi ro suy luận, hiện được RLS chặn]**
- File: `supabase/migrations/0005_enrollments.sql:28-30` — `create unique index enrollments_unique_confirmed_per_class on public.enrollments (student_id, course_class_id) where (status = 'CONFIRMED')`.
- Tác động: Quy tắc "không đăng ký trùng môn trong cùng học kỳ" (2 lớp khác nhau của cùng 1 môn) hiện chỉ được kiểm tra trong logic RPC (`0008_rpc_register_for_class.sql:72-81`), không có ràng buộc cứng ở tầng DB. RLS hiện tại không cấp quyền INSERT/UPDATE trực tiếp trên `enrollments` cho `authenticated`, nên hiện tại không có đường bypass thực tế. Nhưng nếu sau này có thêm 1 policy ghi trực tiếp (ví dụ tính năng staff thêm enrollment thủ công), rule này sẽ không còn được DB tự bảo vệ.
- Cách sửa (migration mới, cần xác nhận riêng trước khi áp dụng cloud): thêm constraint/exclusion hoặc partial unique index theo `(student_id, course_id, registration_period_id) where status = 'CONFIRMED'` — cần join qua `course_classes` nên phải dùng trigger hoặc computed column, không phải unique index đơn giản. Đây là việc "nên làm" (defense-in-depth), không phải bug đang bị khai thác.

**P2-4. Không có test tự động cho business logic RPC (đăng ký/hủy/hủy lớp)** — **[Đã xác minh]**
- Bằng chứng: chỉ có `apps/web/src/lib/enrollmentMatching.test.ts` (3 test, kiểm tra hàm thuần phía frontend). `docs/DB_CONCURRENCY_TEST_PLAN.md` là kế hoạch test thủ công qua `psql`, không phải test tự động chạy được trong CI.
- Tác động: Không có lưới an toàn tự động khi refactor RPC sau này; rủi ro regression âm thầm trên các rule tín chỉ/trùng lịch/seat-race.
- Cách sửa: Bổ sung test tự động — có thể dùng `vitest`/`node:test` gọi trực tiếp RPC qua Supabase client kết nối tới local `supabase start` instance (không đụng cloud), hoặc pgTAP. Việc này không đổi migration, chỉ thêm test.

**P2-5. `handle_new_auth_user()` dùng `search_path = public` thay vì `pg_catalog, public`** — **[Đã xác minh, rủi ro thấp]**
- File: `supabase/migrations/0001_profiles.sql:44`
- Tác động: Không nhất quán với toàn bộ các SECURITY DEFINER function khác trong repo (đều dùng `pg_catalog, public`). Rủi ro khai thác thực tế thấp (hàm này chỉ chạy như trigger trên `auth.users`, thân hàm không có toán tử/cast mơ hồ), nhưng nên chuẩn hóa cho nhất quán defense-in-depth.
- Cách sửa (migration mới, cần xác nhận trước khi áp dụng cloud): `CREATE OR REPLACE FUNCTION ... SET search_path = pg_catalog, public`.

### P3

**P3-1. `<html lang="en">` trong khi toàn bộ UI là tiếng Việt** — **[Đã xác minh]** — `apps/web/index.html:3`. Ảnh hưởng nhẹ tới accessibility (screen reader đọc sai ngữ điệu) và SEO. Sửa thành `lang="vi"`.

**P3-2. `signOut()` không xóa `profile`/`profileStatus` đồng bộ, phụ thuộc vào listener bất đồng bộ** — **[Đã xác minh, ảnh hưởng thấp]** — `apps/web/src/context/AuthContext.tsx:71-73`. Trong thực tế `onAuthStateChange` trigger lại effect xóa profile ngay sau đó nên không quan sát được lỗi rõ ràng trong UI, nhưng có một khung thời gian rất ngắn dữ liệu cũ vẫn còn trong state. Có thể xóa `profile`/`profileStatus` ngay trong `signOut()` trước khi gọi `supabase.auth.signOut()` để chắc chắn tức thời.
- Nav components (`StaffNav.tsx:9-12`, `StudentNav.tsx:9-12`) không bắt lỗi nếu `supabase.auth.signOut()` reject — nút "Đăng xuất" có thể im lặng không làm gì khi mất mạng. Nên thêm try/catch + thông báo lỗi.

**P3-3. `CORS_ORIGIN` chỉ hỗ trợ đúng 1 origin** — **[Đã xác minh, hạn chế thiết kế không phải bug]** — `apps/api/src/config/env.ts:13`. Nếu sau này cần nhiều origin (staging + prod, apex + www), cần sửa code để hỗ trợ danh sách phân tách bằng dấu phẩy. Không cần sửa ngay vì kiến trúc deploy hiện tại (1 Vercel domain) chỉ cần 1 origin.

**P3-4. Bảng trong CSS có `min-width: 720px` mặc định, chỉ được override cho `.classes-table`** — **[Đã xác minh, hiện chưa gãy vì chỉ có 1 bảng dùng class khác]** — `apps/web/src/styles.css:190-193`. Rủi ro nếu thêm bảng mới sau này quên thêm override responsive. Nên đổi rule mặc định thay vì chỉ override theo class riêng lẻ.

**P3-5. Staff hủy lớp không giải phóng chỗ cho lớp khác** — **[Xác nhận là thiết kế có chủ đích, không phải bug]** — `supabase/migrations/0010_rpc_cancel_course_class.sql:4-5` có comment giải thích rõ: lớp CANCELLED không nhận đăng ký mới nữa nên "giải phóng chỗ" không có ý nghĩa. Không cần sửa, chỉ ghi nhận để tránh hiểu nhầm khi review.

## 3. Phân loại theo hành động

### A. Bắt buộc sửa trước deploy
- P1-1 (rò rỉ lỗi Postgres thô ra client) — production security hardening tối thiểu trước khi public.
- P1-2 (RequireRole điều hướng sai) — tránh trải nghiệm gây hiểu lầm khi demo cho stakeholder/nhà tuyển dụng.

### B. Nên sửa trước khi đưa vào CV
- P2-1 (guard `response.json()`)
- P2-2 (timeout cho `apiFetch`)
- P3-1 (`lang="vi"`)
- P3-2 (signOut đồng bộ + bắt lỗi)

### C. Nice-to-have
- P2-3 (hard constraint defense-in-depth cho duplicate-course) — cần migration mới, đề xuất viết migration nhưng **dừng lại chờ xác nhận trước khi áp dụng lên cloud**, đúng theo ràng buộc của nhiệm vụ.
- P2-4 (test tự động cho RPC)
- P2-5 (chuẩn hóa `search_path` cho `handle_new_auth_user`) — cũng cần migration mới, dừng chờ xác nhận.
- P3-3, P3-4, P3-5 — ghi nhận, không bắt buộc sửa.

## 4. Những gì đã xác minh là làm ĐÚNG (không cần sửa)

- 11/11 quy tắc nghiệp vụ bắt buộc: cài đặt đúng, có concurrency-safety thật (`SELECT ... FOR UPDATE` theo thứ tự cố định profile→class, tránh deadlock, đã có test plan thủ công chứng minh).
- RLS bật trên toàn bộ 8 bảng nghiệp vụ, không có bảng nào bị tắt RLS.
- `enrollment_history` append-only thật (grant revoke UPDATE/DELETE + trigger chặn, không chỉ dựa vào 1 lớp bảo vệ).
- JWT được verify thật qua `supabase.auth.getUser()` (round-trip tới Supabase), không tự decode/tin tưởng token.
- Không route nào lộ ra ngoài mà thiếu `requireAuth`/`requireRole`.
- CORS khóa đúng 1 origin từ env, không có `*`, không kết hợp sai với credentials.
- Secret key (`SUPABASE_SECRET_KEY`) không tồn tại trong schema env của server runtime — chỉ được đọc trong script seed dev-only, tách biệt hoàn toàn.
- Mọi request tới Supabase từ API dùng client scoped theo JWT của người gọi (không dùng service-role client) → RLS luôn có hiệu lực, không có đường bypass qua tầng API.
- Zod validate mọi input ghi; lỗi validate trả 400 với chi tiết field, không crash 500.
- Double-submit được chặn ở toàn bộ 6 action ghi (đăng ký, hủy, tạo lớp, hủy lớp, tạo đợt đăng ký...) bằng disable nút khi đang pending.
- `vercel.json` có rewrite SPA đúng, tránh 404 khi F5 ở deep link.
- `render.yaml`/`env.ts` bind đúng `0.0.0.0`/`process.env.PORT`, không hard-code port.
- Không có `any`, `@ts-ignore`, `eslint-disable` nào trong toàn bộ `apps/api/src` và `apps/web/src`.
- Toàn bộ UI là tiếng Việt, rõ ràng (trừ 1 chỗ `lang="en"` ở P3-1).
- Lý do hủy lớp của staff hiển thị đúng cho student ở `StudentHistory.tsx`.

## 5. Việc KHÔNG được làm trong giai đoạn audit này (đã tuân thủ)

Không có migration/seed/RPC ghi dữ liệu nào được chạy trong phiên này. Không có thao tác nào trên Supabase Cloud. Toàn bộ phát hiện trên chỉ từ đọc mã nguồn tĩnh + chạy `npm run typecheck`/`lint`/`build`/`test` cục bộ.

## 6. Bước tiếp theo

Chuyển sang Giai đoạn 3: sửa các mục ở nhóm A (P1-1, P1-2) và một phần nhóm B (P2-1, P2-2, P3-1, P3-2) — toàn bộ đều là thay đổi code frontend/backend cục bộ, không đụng migration/cloud. Các mục cần migration mới (P2-3, P2-5) sẽ được viết ra dưới dạng file migration mới nhưng **không áp dụng lên cloud**, chờ xác nhận riêng theo đúng yêu cầu.
