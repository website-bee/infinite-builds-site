// GET /api/products            -> danh sách sản phẩm đã publish (cho ô tìm kiếm trên header)
// GET /api/products?category=x -> chỉ một danh mục
import { listProducts, jsonResponse, sized, money } from '../_lib.js';

export async function onRequestGet({ env, request }) {
  const category = new URL(request.url).searchParams.get('category') || null;
  const rows = await listProducts(env.DB, { category });
  const products = rows.map((p) => {
    const prices = p.variants.map((v) => v.price);
    return {
      slug: p.slug,
      title: p.title,
      category: p.category,
      image: sized(p.images[0], 120),
      price: money(prices.length ? Math.min(...prices) : 0),
    };
  });
  return jsonResponse({ products }, 200, { 'Cache-Control': 'public, max-age=60' });
}
