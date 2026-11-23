// /products/<slug>  — dựng trang sản phẩm từ database.
// Không có trong database (hoặc đang là bản nháp) -> 404.
import { productPage, htmlResponse, notFoundOrNext } from '../_lib.js';

export async function onRequestGet({ env, request, params, next }) {
  const raw = String(params.slug || '');
  const slug = raw.replace(/\.html$/, '');
  if (slug !== raw) return Response.redirect(new URL(`/products/${slug}`, request.url), 301);
  try {
    const html = await productPage(env, request, slug);
    if (html) return htmlResponse(html);
    return notFoundOrNext(env, request, next);
  } catch (err) {
    console.error('productPage', slug, err);
  }
  return next(); // lỗi bất ngờ -> để Pages xử lý (file tĩnh cũ nếu còn)
}
