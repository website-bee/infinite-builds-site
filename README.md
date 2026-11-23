# Infinite Builds Studio

Website bán hàng trên **Cloudflare Pages**. Sản phẩm, danh mục và blog nằm trong database **D1**;
chủ shop quản lý ở trang **/admin**, bấm Lưu là website tự cập nhật — không cần sửa HTML hay Git push.

```
public/        Website (thư mục Cloudflare deploy)
  templates/     Khung trang dùng chung: layout.html, product.html, collection.html, post.html
  admin/         Trang quản trị (index.html + admin.js + admin.css)
  _astro/        JS giỏ hàng, tìm kiếm… (giữ nguyên, các trang đang dùng)
functions/     Backend (chạy trên Cloudflare, cùng domain với website)
  _lib.js        Mọi hàm dùng chung: template, truy vấn D1, kiểm tra quyền (đọc mục lục ở đầu file)
  products/ collections/ blog/   Dựng trang từ database
  api/products.js                Danh sách sản phẩm công khai (cho ô tìm kiếm)
  api/auth.js, api/admin/        Đăng nhập; API trang quản trị — luôn tự kiểm tra đăng nhập
  admin/_middleware.js           Chặn /admin/ khi chưa đăng nhập
  img/[id].js                    Phục vụ ảnh upload
db/            schema.sql (cấu trúc bảng) và seed.sql (dữ liệu chuyển từ HTML cũ, tự sinh)
scripts/       migrate.py (HTML cũ -> seed.sql) và các bài kiểm thử
legacy/        Bản HTML cũ để đối chiếu / quay lại. Xóa khi đã chạy ổn định.
```

## Cài đặt lần đầu (làm một lần)

Cần Node.js. Mọi lệnh chạy ở thư mục gốc của project.

1. **Đăng nhập Cloudflare:** `npx wrangler login`
2. **Tạo bảng và nạp dữ liệu vào D1 thật:**
   ```
   npx wrangler d1 execute infinite-builds-db --remote --file=db/schema.sql
   npx wrangler d1 execute infinite-builds-db --remote --file=db/seed.sql
   ```
   Chạy lại seed bất cứ lúc nào cũng an toàn: không ghi đè những gì bạn đã sửa trong Admin.
3. **Cloudflare Pages → project → Settings → Builds:** Build command để trống, **Build output directory = `public`**.
4. **Đặt mật khẩu Admin (Cloudflare Pages → project → Settings → Variables and secrets → Add):**
   loại **Secret**, tên `ADMIN_PASSWORD`, giá trị là mật khẩu dài (tối thiểu 10 ký tự, nên là một câu dài dễ nhớ).
   Sau đó bấm Retry/Redeploy (hoặc push code) để mật khẩu có hiệu lực. Đổi mật khẩu = mọi phiên đăng nhập cũ bị đăng xuất.
   Đăng nhập tại `/admin/login`. Sai quá 8 lần/15 phút từ một IP thì IP đó bị khóa tạm.
   *(Có Cloudflare Access thì dùng được thay thế: điền `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` vào `vars` trong `wrangler.jsonc`.)*
5. Push lên GitHub như bình thường. Vào `https://tên-miền/admin/`.

Trong lúc chưa làm bước 2, website vẫn chạy bằng các file HTML cũ nằm trong `public/products|collections|blog`.
Sau bước 2, trang động tự thay thế chúng (chúng chỉ còn là phương án dự phòng, có thể xóa sau khi chạy ổn).

## Chạy thử trên máy (không đụng vào dữ liệu thật)

```
npx wrangler d1 execute infinite-builds-db --local --file=db/schema.sql
npx wrangler d1 execute infinite-builds-db --local --file=db/seed.sql
npx wrangler pages dev            # mở http://localhost:8788  và  http://localhost:8788/admin/
```
File `.dev.vars` (`DEV_AUTH_BYPASS=1`) cho phép vào Admin không cần đăng nhập, **chỉ khi truy cập bằng `localhost`**. Muốn thử màn hình đăng nhập: thêm dòng `ADMIN_PASSWORD=mat-khau-thu-nghiem` và mở bằng `http://127.0.0.1:8788/admin/`. Không bao giờ đưa file này lên Cloudflare.

## Kiểm thử

```
node scripts/verify.mjs                          # dựng lại cả 116 trang từ database, so với HTML cũ
node scripts/test-api.mjs                        # API admin, quyền truy cập, upload, thêm/sửa/xóa
node scripts/test-e2e.mjs http://localhost:8788  # như trên nhưng qua HTTP thật (khi đang chạy pages dev)
```
Chạy lại `python3 -I scripts/migrate.py` sẽ sinh lại `db/seed.sql` từ `legacy/`.

## Chỉnh sửa thường gặp

| Muốn | Sửa ở |
|---|---|
| Giao diện trang sản phẩm / danh mục / blog | `public/templates/*.html` |
| Menu, chân trang chung | `public/templates/layout.html` (menu danh mục tự lấy từ database) |
| Thêm màu có ô tròn chọn màu | `COLOR_MAP` trong `functions/_lib.js` và `PRESET_COLORS`/`SWATCH` trong `public/admin/admin.js` |
| Quy tắc hiển thị giá ("From", "Sale %") | `cardView()` / `productView()` trong `functions/_lib.js` |
| Lưu ảnh sang R2 thay vì D1 | `saveImage()` trong `functions/api/admin/upload.js` và `functions/img/[id].js` |

## Lưu ý

- **Slug sản phẩm không đổi được** sau khi tạo: đó là URL và là khóa giỏ hàng của khách.
- Mô tả sản phẩm được lọc bỏ `<script>`, `<iframe>`, `on...=` khi lưu.
- Ảnh upload được tự nén trong trình duyệt (tối đa 1600px, dưới 1.2MB) và lưu trong D1. Ảnh cũ vẫn dùng link Shopify CDN cho đến khi bạn thay.
