// Chốt chặn cho cả thư mục /admin/ (giao diện quản trị).
// Chưa đăng nhập -> chuyển về /admin/login. Chỉ trang đăng nhập và file CSS của nó được mở công khai.
// (Dữ liệu thật nằm ở /api/admin/*, nơi luôn tự kiểm tra quyền riêng.)
import { verifyAdmin } from '../_lib.js';

const OPEN = new Set(['/admin/login', '/admin/login.html', '/admin/admin.css']);

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (OPEN.has(path)) return next();
  if (await verifyAdmin(request, env)) return next();
  return Response.redirect(new URL('/admin/login', request.url), 302);
}
