// /collections            -> trang danh sách danh mục
// /collections/all        -> tất cả sản phẩm
// /collections/<slug>     -> sản phẩm của một danh mục
import { collectionPage, htmlResponse, notFoundOrNext } from '../_lib.js';

export async function onRequestGet({ env, request, params, next }) {
  const raw = [].concat(params.slug || []).join('/');
  const slug = raw.replace(/\.html$/, '');
  if (slug === 'index' || slug !== raw) {
    return Response.redirect(new URL(slug === 'index' ? '/collections' : `/collections/${slug}`, request.url), 301);
  }
  try {
    const html = await collectionPage(env, request, slug);
    if (html) return htmlResponse(html);
    return notFoundOrNext(env, request, next);
  } catch (err) {
    console.error('collectionPage', slug, err);
  }
  return next(); // lỗi bất ngờ -> để Pages xử lý (file tĩnh cũ nếu còn)
}
