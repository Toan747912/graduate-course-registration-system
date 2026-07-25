# Hướng dẫn Deploy Production

Kiến trúc deploy đã chốt:
- **Frontend** (React/Vite, `apps/web`) → **Vercel**
- **Backend** (Express/TypeScript, `apps/api`) → **Render Free Web Service**
- **Database/Auth** → **Supabase Cloud** (đã hoạt động, không tạo project mới)

Tài liệu này chỉ mô tả **các bước cần làm sau này** để deploy thật. Tại thời điểm viết tài liệu này, **chưa có bước nào ở dưới được thực hiện** — repo mới chỉ được chuẩn bị Git cục bộ (xem `git log` local), chưa push GitHub, chưa tạo service Render/Vercel nào.

Không có secret/token/password/DB URL nào được ghi trong tài liệu này. Mọi giá trị thật chỉ được nhập trực tiếp vào Dashboard của Render/Vercel/Supabase khi thực hiện, không bao giờ commit vào repo.

---

## a. Tạo GitHub repository private

1. Đăng nhập github.com, tạo repository mới:
   - Tên gợi ý: `graduate-course-registration-system`
   - Visibility: **Private**
   - Không khởi tạo README/`.gitignore`/license từ GitHub (repo local đã có sẵn, tránh xung đột lịch sử).
2. Ghi lại URL remote (dạng `git@github.com:<org-hoặc-user>/graduate-course-registration-system.git` hoặc HTTPS tương ứng) để dùng ở bước (b).

## b. Push branch main

Từ thư mục gốc repo local (đã có commit đầu tiên trên branch `main`):

```bash
git remote add origin <URL-repo-vua-tao>
git push -u origin main
```

Kiểm tra lại trên GitHub rằng:
- Không có file `.env` (chỉ `.env.example`) nào bị commit.
- Không có `node_modules/`, `dist/` nào bị commit.

## c. Deploy Render từ GitHub

1. Đăng nhập Render Dashboard → **New** → **Blueprint**.
2. Chọn repository GitHub vừa push ở bước (b). Render sẽ đọc `render.yaml` ở gốc repo và đề xuất tạo service `gcrs-api` (Free Web Service, Node runtime).
3. Xác nhận:
   - **Build Command**: `npm install && npm run build --workspace apps/api`
   - **Start Command**: `npm run start --workspace apps/api`
   - Node version: Render tự đọc `.nvmrc`/`engines.node` (đã pin `22.22.0`) trong repo.
4. Ở bước cấu hình Environment Variables, Render sẽ yêu cầu nhập giá trị cho 3 biến khai báo trong `render.yaml` (không có giá trị sẵn, phải nhập tay):
   - `SUPABASE_URL` — lấy từ Supabase Dashboard → Project Settings → API.
   - `SUPABASE_PUBLISHABLE_KEY` — Publishable key (**không phải** Secret key) từ cùng trang.
   - `CORS_ORIGIN` — tạm thời để giá trị bất kỳ hợp lệ (ví dụ `http://localhost:5173`), sẽ cập nhật lại đúng ở bước (f) sau khi có URL Vercel thật.
5. Deploy. Chờ build xong, service Free có thể ở trạng thái "cold start" vài chục giây cho lần gọi đầu tiên sau khi ngủ (xem mục "Giới hạn đã biết" bên dưới).
6. Gọi thử `GET https://<ten-service>.onrender.com/api/health` để xác nhận service chạy được (kỳ vọng trả về JSON `{"ok":true,...}`).

## d. Lấy Render URL, điền `VITE_API_BASE_URL` bên Vercel

1. Copy URL service Render vừa deploy, ví dụ dạng `https://gcrs-api-xxxx.onrender.com`.
2. `VITE_API_BASE_URL` phía Vercel phải là URL đó **cộng thêm `/api`**, ví dụ: `https://gcrs-api-xxxx.onrender.com/api` (khớp với cách `apps/web/.env.example` định nghĩa `VITE_API_BASE_URL=http://localhost:4000/api` ở local — luôn có hậu tố `/api`).
3. Giữ giá trị này lại để nhập ở bước (e).

## e. Deploy Vercel với Root Directory `apps/web`

1. Đăng nhập Vercel Dashboard → **Add New** → **Project** → chọn repository GitHub đã push.
2. Trong bước cấu hình project:
   - **Root Directory**: `apps/web` (bắt buộc — đây là lý do `apps/web/vercel.json` được đặt bên trong thư mục này chứ không phải ở gốc repo).
   - **Framework Preset**: Vite (Vercel thường tự nhận diện).
   - **Build Command**: mặc định (`vite build` / `npm run build`, đã có sẵn trong `apps/web/package.json`).
   - **Output Directory**: mặc định `dist`.
3. Environment Variables (chỉ 3 biến, nhập tay giá trị thật, không có sẵn trong repo):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_API_BASE_URL` — dùng giá trị đã chuẩn bị ở bước (d).
4. Deploy. `apps/web/vercel.json` đã cấu hình rewrite toàn bộ route về `/index.html`, nên khi người dùng bấm F5/refresh trực tiếp ở `/student/...` hoặc `/staff/...`, Vercel sẽ không trả 404 — React Router phía client tự xử lý route.
5. Ghi lại URL Vercel thật (ví dụ `https://gcrs-web.vercel.app`) để dùng ở bước (f).

## f. Cập nhật `CORS_ORIGIN` trên Render bằng URL Vercel thật

1. Vào lại Render Dashboard → service `gcrs-api` → Environment.
2. Sửa `CORS_ORIGIN` thành đúng origin Vercel thật ở bước (e) — **chỉ origin** (scheme + host, không có dấu `/` ở cuối), ví dụ `https://gcrs-web.vercel.app`.
3. Lưu ý: middleware CORS phía backend (`apps/api/src/index.ts`) chỉ nhận **một origin duy nhất** từ biến này, không bao giờ dùng `"*"` — nếu domain Vercel đổi (ví dụ thêm custom domain), phải cập nhật lại biến này.
4. Render sẽ tự redeploy sau khi lưu biến môi trường.

## g. Cập nhật Supabase Auth Site URL/Redirect URLs (nếu cần)

Nếu tính năng auth có dùng email confirmation/magic link/redirect (hiện dự án dùng email+password nên ít bị ảnh hưởng, nhưng vẫn nên rà lại cho chắc):

1. Supabase Dashboard → Authentication → URL Configuration.
2. Cập nhật **Site URL** thành URL Vercel thật (bước e).
3. Thêm URL Vercel thật vào **Redirect URLs** nếu có luồng nào redirect sau khi xác thực.
4. Bước này **không đụng tới RLS, RPC, migration hay dữ liệu** — chỉ là cấu hình Auth URL trên Dashboard.

## h. Checklist smoke test production

Sau khi hoàn tất (a)–(g), thực hiện smoke test thủ công trên **URL Vercel thật**, dùng tài khoản demo hiện có (không tạo tài khoản thật, không thao tác trên dữ liệu QA/production nhạy cảm nếu có):

- [ ] Đăng nhập **student** demo → vào được `Danh sách lớp`/`Lịch sử đăng ký`, không lỗi console, không lỗi CORS.
- [ ] Đăng nhập **staff** demo → vào được `Đợt đăng ký`/`Lớp học phần`/chi tiết lớp, không lỗi console, không lỗi CORS.
- [ ] Student **đăng ký** một lớp còn chỗ → nhận kết quả CONFIRMED hoặc lý do từ chối hợp lệ (không lỗi 5xx).
- [ ] Student **tự hủy** một enrollment đang CONFIRMED → chuyển đúng sang CANCELLED_BY_STUDENT.
- [ ] Staff **hủy lớp** (chọn một lớp test riêng, không phải lớp có sinh viên thật) → toàn bộ enrollment CONFIRMED của lớp chuyển đúng sang CANCELLED_BY_SCHOOL, lý do hiển thị đúng.
- [ ] Refresh trực tiếp (F5) tại `/student/classes`, `/student/history`, `/staff/course-classes` → không bị 404 (xác nhận rewrite Vercel hoạt động).
- [ ] Gọi trực tiếp `GET <Render-URL>/api/health` → trả về 200.

### Giới hạn đã biết (Render Free)

- **Cold start**: Render Free Web Service tự động ngủ (sleep) sau một khoảng thời gian không có traffic. Request đầu tiên sau khi ngủ có thể mất **vài chục giây đến ~1 phút** để service khởi động lại trước khi trả response. Đây là giới hạn cố hữu của gói Free, không phải lỗi cấu hình — cần thông báo trước cho người dùng/stakeholder, không phải việc cần "sửa" trong lần deploy đầu.

---

## Ghi chú kỹ thuật đã chuẩn bị sẵn trong repo (đã làm, không cần lặp lại)

- `apps/api/src/index.ts`: `app.listen(env.PORT, '0.0.0.0', ...)` — bind đúng host `0.0.0.0` và dùng `process.env.PORT` (qua `env.PORT`, có coerce + default cho local dev), không hard-code port cho production.
- `apps/api/src/config/env.ts`: schema production **không yêu cầu** `SUPABASE_SECRET_KEY` — biến này chỉ tồn tại trong schema riêng của `apps/api/src/scripts/seedDemoUsers.ts`, không bao giờ được server runtime đọc.
- `package.json` (root, `apps/api`, `apps/web`): đã thêm `"engines": { "node": "22.22.0" }`, khớp `.nvmrc` ở gốc repo — pin đúng version Node đang chạy trong workspace hiện tại.
- `render.yaml` (gốc repo): Blueprint build/start command chạy từ root repo bằng `--workspace apps/api` (không dùng `rootDir` riêng vì đây là npm workspaces monorepo, cần `package-lock.json`/`node_modules` gốc).
- `apps/web/vercel.json`: rewrite toàn bộ path về `/index.html` để React Router xử lý client-side routing, tránh 404 khi refresh sâu route.
