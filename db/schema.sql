-- Infinite Builds Studio — cấu trúc database D1
-- Chạy:  npx wrangler d1 execute infinite-builds-db --remote --file=db/schema.sql
-- An toàn khi chạy lại nhiều lần (IF NOT EXISTS), không xóa dữ liệu.

-- Danh mục (collection). "All products" không nằm trong bảng này, nó luôn tự có.
CREATE TABLE IF NOT EXISTS categories (
  slug        TEXT PRIMARY KEY,            -- phần cuối URL: /collections/<slug>
  name        TEXT NOT NULL,
  image       TEXT,                        -- ảnh đại diện (URL gốc, chưa gắn ?width=)
  sort        INTEGER NOT NULL DEFAULT 0   -- thứ tự hiện trong menu và trang /collections
);

-- Sản phẩm. Màu/tùy chọn/biến thể/ảnh lưu dạng JSON trong chính dòng sản phẩm
-- (shop nhỏ ~100 sản phẩm, gom một chỗ cho dễ sửa và không cần JOIN).
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,    -- phần cuối URL: /products/<slug>  (KHÔNG đổi sau khi tạo)
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',-- HTML
  category        TEXT REFERENCES categories(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft')),

  -- JSON: ["https://cdn.shopify.com/...png?v=1", "/img/12", ...]  ảnh đầu tiên là ảnh chính
  images          TEXT NOT NULL DEFAULT '[]',
  -- JSON: [{"name":"Color","values":[{"v":"white","t":"White"}, ...]}, ...]  tối đa 3 nhóm
  options         TEXT NOT NULL DEFAULT '[]',
  -- JSON: [{"key","label","option1","option2","option3","price","compareAt","sku","image"}, ...]
  -- variants[0] là biến thể mặc định: giá/giá gốc/SKU hiện trên trang lấy từ đây
  variants        TEXT NOT NULL DEFAULT '[]',

  -- SEO. NULL = dùng mặc định của site
  seo_title       TEXT,
  seo_description TEXT,
  og_image        TEXT,

  sort_all        INTEGER NOT NULL DEFAULT 0,  -- thứ tự trong /collections/all
  sort_cat        INTEGER NOT NULL DEFAULT 0,  -- thứ tự trong trang danh mục của nó
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, status, sort_cat);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status, sort_all);

-- Bài blog
CREATE TABLE IF NOT EXISTS posts (
  slug            TEXT PRIMARY KEY,        -- /blog/<slug>
  title           TEXT NOT NULL,
  excerpt         TEXT NOT NULL DEFAULT '',-- đoạn trích hiện ở trang /blog
  content         TEXT NOT NULL DEFAULT '',-- HTML
  cover           TEXT,                    -- ảnh bìa (URL gốc)
  author          TEXT,
  published_at    TEXT NOT NULL,           -- YYYY-MM-DD
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft')),
  seo_description TEXT,                    -- NULL = dùng excerpt
  og_image        TEXT                     -- NULL = dùng cover
);
CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(status, published_at DESC);

-- Ảnh upload từ trang Admin (lưu base64, phục vụ qua /img/<id>).
-- Sau này nếu dùng R2: đổi hàm lưu ảnh trong functions/api/admin/upload.js, bảng này có thể bỏ.
CREATE TABLE IF NOT EXISTS images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        TEXT NOT NULL,               -- base64
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
