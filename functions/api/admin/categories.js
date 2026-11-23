// Quản lý danh mục (collection).
//   GET    /api/admin/categories
//   POST   /api/admin/categories             { name, slug?, image? }
//   PUT    /api/admin/categories?slug=x      { name, image? }   (slug không đổi)
//   DELETE /api/admin/categories?slug=x      sản phẩm của danh mục chuyển về "không danh mục"
import { jsonResponse, getCategories, slugify, isValidSlug, cleanUrl } from '../../_lib.js';

const slugOf = (request) => new URL(request.url).searchParams.get('slug');
const err = (m, s = 400) => jsonResponse({ error: m }, s);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestGet({ env }) {
  return jsonResponse({ categories: await getCategories(env.DB) });
}

export async function onRequestPost({ env, request }) {
  const b = await body(request);
  if (!b) return err('Dữ liệu không hợp lệ');
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) return err('Tên danh mục không hợp lệ');
  const slug = b.slug ? String(b.slug).trim() : slugify(name);
  if (!isValidSlug(slug) || slug === 'all' || slug === 'index') return err('Slug không hợp lệ');
  if (await env.DB.prepare('SELECT 1 FROM categories WHERE slug = ?1').bind(slug).first()) return err('Slug đã tồn tại');
  let image = null;
  try {
    image = b.image ? cleanUrl(b.image) : null;
  } catch (e) {
    return err(e.message);
  }
  const next = await env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM categories').first();
  await env.DB.prepare('INSERT INTO categories (slug, name, image, sort) VALUES (?1, ?2, ?3, ?4)').bind(slug, name, image, next.n).run();
  return jsonResponse({ ok: true, slug }, 201);
}

export async function onRequestPut({ env, request }) {
  const slug = slugOf(request);
  const b = await body(request);
  if (!slug || !b) return err('Dữ liệu không hợp lệ');
  const name = String(b.name || '').trim();
  if (!name || name.length > 80) return err('Tên danh mục không hợp lệ');
  let image = null;
  try {
    image = b.image ? cleanUrl(b.image) : null;
  } catch (e) {
    return err(e.message);
  }
  const r = await env.DB.prepare('UPDATE categories SET name = ?1, image = ?2 WHERE slug = ?3').bind(name, image, slug).run();
  return r.meta.changes ? jsonResponse({ ok: true }) : err('Không tìm thấy danh mục', 404);
}

export async function onRequestDelete({ env, request }) {
  const slug = slugOf(request);
  if (!slug) return err('Thiếu slug');
  // chuyển sản phẩm sang "không danh mục" rõ ràng, không phụ thuộc vào cấu hình khóa ngoại
  await env.DB.prepare('UPDATE products SET category = NULL WHERE category = ?1').bind(slug).run();
  const r = await env.DB.prepare('DELETE FROM categories WHERE slug = ?1').bind(slug).run();
  return r.meta.changes ? jsonResponse({ ok: true }) : err('Không tìm thấy danh mục', 404);
}
