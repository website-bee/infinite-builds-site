// Chạy trước MỌI request tới /api/admin/*.
// Tự kiểm tra đăng nhập ở chính API (cookie phiên từ /admin/login, hoặc JWT của Cloudflare Access) — không tin gì từ bên ngoài.
import { verifyAdmin, jsonResponse } from '../../_lib.js';

export async function onRequest({ request, env, data, next }) {
  const user = await verifyAdmin(request, env);
  if (!user) return jsonResponse({ error: 'Không có quyền truy cập' }, 401);

  // Chống CSRF: request ghi dữ liệu phải có header riêng (trình duyệt không tự gắn từ trang khác)
  // và, nếu có Origin, phải đúng domain này.
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers.get('X-Admin-Request') !== '1') return jsonResponse({ error: 'Thiếu X-Admin-Request' }, 403);
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: 'Origin không hợp lệ' }, 403);
  }
  data.user = user;
  try {
    return await next();
  } catch (err) {
    console.error('api/admin', err);
    return jsonResponse({ error: 'Lỗi máy chủ (database đã nạp schema.sql và seed.sql chưa?)' }, 500);
  }
}
