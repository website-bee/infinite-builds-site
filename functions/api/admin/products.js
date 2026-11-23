// API quản lý sản phẩm (đã qua _middleware.js: chỉ admin mới tới được đây).
//   GET    /api/admin/products            danh sách (kể cả bản nháp) + danh mục
//   GET    /api/admin/products?id=12      một sản phẩm, dạng form sửa
//   POST   /api/admin/products            tạo mới
//   PUT    /api/admin/products?id=12      sửa (slug không đổi)
//   DELETE /api/admin/products?id=12      xóa
import {
  jsonResponse, listProducts, getCategories, hydrateProduct,
  editorToStored, storedToEditor, adminRow, slugify, isValidSlug, ValidationError,
} from '../../_lib.js';

const idOf = (request) => {
  const n = parseInt(new URL(request.url).searchParams.get('id'), 10);
  return Number.isInteger(n) ? n : null;
};

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Dữ liệu gửi lên không hợp lệ');
  }
}

async function checkCategory(db, slug) {
  if (!slug) return;
  const c = await db.prepare('SELECT 1 FROM categories WHERE slug = ?1').bind(slug).first();
  if (!c) throw new ValidationError('Danh mục không tồn tại');
}

/** Đặt sản phẩm lên đầu danh sách (mới nhất trước). */
async function topOrder(db, category) {
  const a = await db.prepare('SELECT COALESCE(MIN(sort_all), 0) - 1 AS n FROM products').first();
  const b = await db.prepare('SELECT COALESCE(MIN(sort_cat), 0) - 1 AS n FROM products WHERE category IS ?1').bind(category).first();
  return { sort_all: a.n, sort_cat: b.n };
}

const COLS = 'title, description, category, status, images, options, variants, seo_title, seo_description, og_image';
const valuesOf = (s) => [
  s.title, s.description, s.category, s.status,
  JSON.stringify(s.images), JSON.stringify(s.options), JSON.stringify(s.variants),
  s.seo_title, s.seo_description, s.og_image,
];

export async function onRequestGet({ env, request }) {
  const id = idOf(request);
  if (id != null) {
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first();
    if (!row) return jsonResponse({ error: 'Không tìm thấy sản phẩm' }, 404);
    return jsonResponse({ product: storedToEditor(hydrateProduct(row)) });
  }
  const [products, categories] = await Promise.all([listProducts(env.DB, { drafts: true }), getCategories(env.DB)]);
  return jsonResponse({ products: products.map(adminRow), categories });
}

export async function onRequestPost({ env, request }) {
  try {
    const body = await readBody(request);
    const slug = body.slug ? String(body.slug).trim() : slugify(body.title || '');
    if (!isValidSlug(slug)) throw new ValidationError('Slug (đường dẫn) không hợp lệ: chỉ dùng a-z, 0-9 và dấu gạch ngang');
    if (await env.DB.prepare('SELECT 1 FROM products WHERE slug = ?1').bind(slug).first()) {
      throw new ValidationError(`Slug "${slug}" đã có sản phẩm khác dùng`);
    }
    const s = editorToStored(body, slug, null);
    await checkCategory(env.DB, s.category);
    const o = await topOrder(env.DB, s.category);
    const r = await env.DB
      .prepare(`INSERT INTO products (slug, ${COLS}, sort_all, sort_cat) VALUES (?1, ?2,?3,?4,?5,?6,?7,?8,?9,?10,?11, ?12, ?13)`)
      .bind(slug, ...valuesOf(s), o.sort_all, o.sort_cat)
      .run();
    return jsonResponse({ ok: true, id: r.meta.last_row_id, slug }, 201);
  } catch (err) {
    return fail(err);
  }
}

export async function onRequestPut({ env, request }) {
  try {
    const id = idOf(request);
    if (id == null) throw new ValidationError('Thiếu id');
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?1').bind(id).first();
    if (!row) return jsonResponse({ error: 'Không tìm thấy sản phẩm' }, 404);
    const existing = hydrateProduct(row);
    const body = await readBody(request);
    const s = editorToStored(body, existing.slug, existing); // slug KHÔNG đổi: URL cũ + giỏ hàng giữ nguyên
    await checkCategory(env.DB, s.category);
    const sortCat = s.category !== existing.category ? (await topOrder(env.DB, s.category)).sort_cat : existing.sort_cat;
    await env.DB
      .prepare(
        `UPDATE products SET title=?1, description=?2, category=?3, status=?4, images=?5, options=?6, variants=?7,
         seo_title=?8, seo_description=?9, og_image=?10, sort_cat=?11, updated_at=datetime('now') WHERE id=?12`
      )
      .bind(...valuesOf(s), sortCat, id)
      .run();
    return jsonResponse({ ok: true, id, slug: existing.slug });
  } catch (err) {
    return fail(err);
  }
}

export async function onRequestDelete({ env, request }) {
  const id = idOf(request);
  if (id == null) return jsonResponse({ error: 'Thiếu id' }, 400);
  const r = await env.DB.prepare('DELETE FROM products WHERE id = ?1').bind(id).run();
  if (!r.meta.changes) return jsonResponse({ error: 'Không tìm thấy sản phẩm' }, 404);
  return jsonResponse({ ok: true });
}

function fail(err) {
  if (err instanceof ValidationError) return jsonResponse({ error: err.message }, 400);
  console.error(err);
  return jsonResponse({ error: 'Lỗi máy chủ' }, 500);
}
