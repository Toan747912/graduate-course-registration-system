# Full-Stack Upgrade Report — graduate-course-registration-system

Ngày thực hiện: 2026-07-26
Người thực hiện: Claude Code
Tài liệu nguồn: [`docs/FULL_STACK_AUDIT_AND_UPGRADE_PLAN.md`](FULL_STACK_AUDIT_AND_UPGRADE_PLAN.md) (Giai đoạn 1–2 của phiên này)

---

## 1. Các lỗi đã sửa

| # | Mức | Trước | Sau | File | Lý do |
|---|---|---|---|---|---|
| P1-1 | P1 | `errorHandler.ts` forward nguyên văn `err.message` của mọi lỗi 500 chưa xác định ra client, không phân biệt môi trường | Khi `NODE_ENV=production`, trả message chung "Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau."; chi tiết đầy đủ vẫn được log server-side qua `console.error` | `apps/api/src/middleware/errorHandler.ts` | Tránh lộ chi tiết nội bộ (tên bảng/cột/constraint, thông tin driver) qua response lỗi không xác định trước |
| P1-2 | P1 | `RequireRole` đẩy người dùng sai-role về `/login` (nơi họ đã đăng nhập) | Đẩy về đúng trang chủ theo role thật của họ (`/student/classes` hoặc `/staff`) qua bảng `HOME_PATH_BY_ROLE` | `apps/web/src/routes/RequireRole.tsx` | Tránh trải nghiệm gây hiểu lầm "bị đăng xuất" khi vào nhầm route, quan trọng khi demo cho stakeholder/CV |
| P2-1 | P2 | `apiFetch` gọi `response.json()` không guard — response không phải JSON (vd. lỗi proxy/502 dạng HTML) ném `SyntaxError` thô | Bọc trong try/catch, ném `ApiRequestError` với message tiếng Việt rõ ràng ("Máy chủ trả về dữ liệu không hợp lệ...") | `apps/web/src/lib/api.ts` | Đảm bảo mọi lỗi response luôn đi qua cùng một loại lỗi (`ApiRequestError`) mà UI đã biết cách hiển thị |
| P2-2 | P2 | `apiFetch` không có timeout — request treo vô thời hạn trên cold-start Render Free, nút bấm kẹt ở "Đang gửi…" mãi | Thêm `AbortController` với timeout 30s; timeout/lỗi mạng đều trả `ApiRequestError` message rõ ràng | `apps/web/src/lib/api.ts` | Tránh UI bị kẹt vô thời hạn khi backend cold-start hoặc mất mạng |
| P3-1 | P3 | `<html lang="en">` trong khi 100% nội dung UI là tiếng Việt | Đổi thành `<html lang="vi">` | `apps/web/index.html` | Đúng accessibility/SEO cho nội dung tiếng Việt |
| P3-2 | P3 | `signOut()` chỉ gọi `supabase.auth.signOut()`, không xóa `profile`/`session` state ngay lập tức (chờ listener bất đồng bộ); nút "Đăng xuất" ở `StaffNav`/`StudentNav` không bắt lỗi nếu `signOut()` reject, có thể im lặng không điều hướng | `signOut()` xóa `profile`/`profileStatus`/`session` ngay trước khi gọi Supabase; `handleLogout` ở cả hai Nav dùng `try/finally` để luôn điều hướng về `/login` dù `signOut()` có lỗi hay không | `apps/web/src/context/AuthContext.tsx`, `apps/web/src/components/StaffNav.tsx`, `apps/web/src/components/StudentNav.tsx` | Đăng xuất phải phản ánh ngay lập tức trên UI, không phụ thuộc network |

Toàn bộ 6 mục trên đều là sửa code frontend/backend cục bộ (React/TypeScript/Express), **không đụng đến migration, RLS, RPC hay bất kỳ dữ liệu/cấu hình nào trên Supabase Cloud**, đúng ràng buộc "Sửa có kiểm soát".

## 2. Những lỗi chưa sửa và lý do

| # | Mức | Vấn đề | Lý do chưa sửa trong phiên này |
|---|---|---|---|
| P2-3 | P2 | Rule "không trùng môn cùng học kỳ" chỉ có unique constraint theo lớp, không theo môn — chỉ được bảo vệ bởi logic RPC + RLS chặn ghi trực tiếp, chưa có hard constraint ở DB | Cần **migration mới** (trigger hoặc exclusion constraint join qua `course_classes`). Theo đúng quy tắc nhiệm vụ, migration mới phải được viết ra, giải thích tác động, và **dừng chờ xác nhận riêng** trước khi áp dụng lên Supabase Cloud — chưa thực hiện bước áp dụng trong phiên này. Hiện tại không phải lỗ hổng đang bị khai thác (RLS đã chặn ghi trực tiếp vào `enrollments`), nên mức độ khẩn cấp thấp, phù hợp để chờ xác nhận. |
| P2-4 | P2 | Không có test tự động cho business logic RPC (đăng ký/hủy/hủy lớp/race condition tín chỉ-chỗ) | Cần hạ tầng test riêng (kết nối `supabase start` local hoặc pgTAP) — là một khoản đầu tư hạ tầng test đáng kể hơn phạm vi "sửa nhanh" của phiên này; đã ghi vào audit plan là việc nên làm (nhóm C, nice-to-have) cho một phiên làm việc riêng. |
| P2-5 | P2 | `handle_new_auth_user()` dùng `search_path = public` thay vì `pg_catalog, public` (không nhất quán, rủi ro thấp) | Cũng cần **migration mới** — cùng lý do như P2-3, chờ xác nhận riêng trước khi áp dụng lên cloud. |
| P3-3 | P3 | `CORS_ORIGIN` chỉ hỗ trợ 1 origin | Là giới hạn thiết kế phù hợp với kiến trúc deploy hiện tại (1 domain Vercel duy nhất), không phải bug; không cần sửa trừ khi kiến trúc deploy thay đổi. |
| P3-4 | P3 | CSS bảng có `min-width: 720px` mặc định, chỉ override cho `.classes-table` | Hiện chưa gãy thực tế vì chỉ có 1 bảng dùng style khác; rủi ro chỉ phát sinh nếu thêm bảng mới trong tương lai — ghi nhận, không sửa để tránh thay đổi CSS ngoài phạm vi cần thiết. |
| P3-5 | — | Staff hủy lớp không giải phóng chỗ cho lớp khác | Đã xác nhận là **thiết kế có chủ đích** (comment trong migration 0010), không phải bug — không sửa. |

Không có lỗi P0 nào được phát hiện trong Giai đoạn 1, nên không có mục nào ở nhóm "bắt buộc sửa trước deploy" còn tồn đọng.

## 3. Kết quả typecheck/lint/build/test (sau khi sửa)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` (api + web) | **PASS** — sạch, không lỗi |
| `npm run lint` (api + web) | **PASS** — 0 lỗi; 1 warning cũ không đổi (`react-refresh/only-export-components` ở `AuthContext.tsx`, không phải lỗi, không ảnh hưởng production) |
| `npm run build` (api + web) | **PASS** — `tsc` + `vite build` thành công, output `dist/` tạo đúng (`index.html`, CSS 6.32 kB, JS 410.77 kB / gzip 117.02 kB) |
| `npm run test --workspace apps/web` (vitest) | **PASS** — 3/3 test pass, không có test nào bị đổi hành vi |

Không có lệnh nào fail. Không có warning/lỗi mới phát sinh sau khi sửa so với trước khi sửa (baseline trước sửa cũng đã sạch 100% với đúng 1 warning y hệt).

## 4. Các thay đổi có thể ảnh hưởng business rule

**Không có thay đổi nào trong phiên này ảnh hưởng đến 11 nghiệp vụ bắt buộc.** Toàn bộ 6 mục đã sửa đều thuộc về:
- Hardening bảo mật tầng response lỗi (P1-1) — không đổi logic nghiệp vụ, chỉ đổi *nội dung message* trả về khi có lỗi hệ thống không xác định.
- UX điều hướng route guard (P1-2) — chỉ là "convenience" tầng frontend, không phải security boundary (đã có comment xác nhận trong code gốc); không ảnh hưởng đến việc `apps/api` re-verify JWT/role trên mọi request.
- Độ bền của lớp gọi API (P2-1, P2-2, P3-2) — không đổi endpoint, không đổi payload, không đổi RPC nào được gọi.
- 1 thuộc tính HTML tĩnh (P3-1).

Không có migration nào được áp dụng, không có RLS/RPC nào bị sửa, không có business rule nào bị nới lỏng hay thắt chặt.

## 5. Migration/cloud action cần xác nhận riêng

Hai mục sau **cần migration file mới** và **cần xác nhận riêng của người dùng trước khi áp dụng lên Supabase Cloud** — chưa có file migration nào được tạo hay áp dụng trong phiên này:

1. **P2-3** — Thêm ràng buộc DB-level (không chỉ RPC-level) cho rule "không đăng ký trùng môn trong cùng học kỳ", ví dụ qua trigger `BEFORE INSERT/UPDATE` trên `enrollments` kiểm tra join `course_classes.course_id` trùng lặp trong cùng `registration_period_id` với status `CONFIRMED`. Tác động: chỉ bổ sung một lớp bảo vệ thứ hai (defense-in-depth), không thay đổi hành vi hiện tại của RPC `register_for_class` (đã chặn đúng ở tầng logic).
2. **P2-5** — Chuẩn hóa `search_path` của `handle_new_auth_user()` từ `public` thành `pg_catalog, public` để nhất quán với các SECURITY DEFINER function khác. Tác động: không đổi hành vi (hàm không có toán tử/cast mơ hồ phụ thuộc search_path), chỉ là hardening phòng ngừa.

Nếu người dùng xác nhận muốn thực hiện, bước tiếp theo sẽ là: viết file migration mới (không sửa file cũ đã apply), giải thích chính xác câu lệnh SQL sẽ chạy, rồi dừng chờ xác nhận lần nữa trước khi chạy `supabase db push` hoặc bất kỳ lệnh ghi nào lên Supabase Cloud — đúng quy trình bắt buộc của nhiệm vụ.

Không có hành động nào khác cần xác nhận cloud (không seed, không tạo/hủy enrollment test, không đổi credentials/CORS_ORIGIN/env trên Render hay Vercel, không push GitHub, không deploy).

## 6. Verdict mới

**READY WITH LIMITATIONS** (không đổi so với Giai đoạn 2, vì các mục còn lại là P2/P3 không chặn deploy)

So với trước khi sửa: 2 lỗi P1 đã được xử lý dứt điểm (không còn lỗi P1 nào tồn đọng), 4 mục P2/P3 có tác động rõ tới demo/CV đã được xử lý. Các mục còn lại (P2-3, P2-4, P2-5, P3-3, P3-4) đều thuộc nhóm "nên làm sau" hoặc "cần xác nhận cloud riêng", không phải blocker.

Lý do chưa đạt READY TO DEPLOY: (a) hai mục cần migration cloud (P2-3, P2-5) chưa được áp dụng vì đang chờ xác nhận; (b) chưa có test tự động cho RPC (P2-4); (c) theo `docs/QA_RELEASE_REPORT.md`, dự án **chưa từng được deploy thật** lên Render/Vercel — mọi thứ mới ở trạng thái "sẵn sàng deploy", chưa có bằng chứng chạy trên production thật.

## 7. Checklist chính xác cần làm tiếp để deploy

**Trước khi deploy (không bắt buộc, nhưng khuyến nghị xác nhận):**
- [ ] Quyết định có áp dụng migration P2-3 (hard constraint chống trùng môn) và P2-5 (chuẩn hóa search_path) lên Supabase Cloud hay không — nếu có, yêu cầu tôi viết migration file mới và trình bày trước khi chạy.

**Để deploy thật (theo đúng `docs/DEPLOYMENT.md`, chưa bước nào được thực hiện):**
- [ ] (a) Tạo GitHub repository private, push branch `main`.
- [ ] (b) Xác nhận trên GitHub: không có `.env` thật, không có `node_modules/`/`dist/` bị commit (đã kiểm tra local qua `.gitignore` + `git status`/diff scan trong phiên này — sạch).
- [ ] (c) Deploy Render từ Blueprint (`render.yaml`), điền `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGIN` tạm thời.
- [ ] (d) Lấy URL Render, chuẩn bị `VITE_API_BASE_URL` (thêm hậu tố `/api`).
- [ ] (e) Deploy Vercel với Root Directory `apps/web`, điền `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`.
- [ ] (f) Cập nhật `CORS_ORIGIN` trên Render bằng URL Vercel thật.
- [ ] (g) Kiểm tra lại Supabase Auth Site URL/Redirect URLs nếu cần.
- [ ] (h) Chạy checklist smoke test production trong `DEPLOYMENT.md` mục h (đăng nhập 2 role, đăng ký, tự hủy, staff hủy lớp, F5 deep-link, health check).

**Sau khi có bằng chứng deploy thật (để nâng verdict lên READY TO DEPLOY):**
- [ ] Set `NODE_ENV=production` trên Render (để P1-1 phát huy đúng — trả generic message thay vì chi tiết lỗi) — kiểm tra biến này có tự động được Render set hay cần khai báo thủ công.
- [ ] Dọn dữ liệu QA (`ZZTEST-01`, `QA-CANCEL-02`) khỏi Supabase Cloud nếu project này dùng làm production thật (đã ghi nhận trong `QA_RELEASE_REPORT.md`, chưa xử lý).
- [ ] Cân nhắc bổ sung test tự động cho RPC (P2-4) trước khi đưa vào CV để có bằng chứng test coverage mạnh hơn.

---

Không có secret/token/password/DB URL nào được in trong báo cáo này. Không có file migration/seed nào được tạo hay áp dụng lên Supabase Cloud trong phiên này. Không có commit/push/deploy nào được thực hiện.
