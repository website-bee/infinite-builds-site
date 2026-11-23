// /blog           -> danh sách bài viết
// /blog/<slug>    -> một bài viết
import { blogPage, htmlResponse, notFoundOrNext } from '../_lib.js';

export async function onRequestGet({ env, request, params, next }) {
  const raw = [].concat(params.slug || []).join('/');
  const slug = raw.replace(/\.html$/, '');
  if (slug === 'index' || slug !== raw) {
    return Response.redirect(new URL(slug === 'index' ? '/blog' : `/blog/${slug}`, request.url), 301);
  }
  try {
    const html = await blogPage(env, request, slug);
    if (html) return htmlResponse(html);
    return notFoundOrNext(env, request, next);
  } catch (err) {
    console.error('blogPage', slug, err);
  }
  return next(); // lỗi bất ngờ -> để Pages xử lý (file tĩnh cũ nếu còn)
}
