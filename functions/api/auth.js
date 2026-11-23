// Đăng nhập / đăng xuất trang quản trị bằng mật khẩu (ADMIN_PASSWORD).
//   GET    /api/auth   -> { configured, loggedIn }
//   POST   /api/auth   { password }  -> đặt cookie phiên (HttpOnly, Secure, SameSite=Strict, 7 ngày)
//   DELETE /api/auth   -> xóa cookie
// Chống dò mật khẩu: sai quá 8 lần trong 15 phút từ cùng một IP -> khóa IP đó tạm thời.
import {
  jsonResponse, adminPasswordReady, passwordMatches, createSession, verifyAdmin, SESSION_COOKIE,
} from '../_lib.js';

const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;

const ip = (request) => request.headers.get('CF-Connecting-IP') || 'local';
const cookie = (value, maxAge) =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function ensureTable(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)').run();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestGet({ env, request }) {
  return jsonResponse({ configured: adminPasswordReady(env), loggedIn: !!(await verifyAdmin(request, env)) });
}

export async function onRequestPost({ env, request }) {
  if (request.headers.get('X-Admin-Request') !== '1') return jsonResponse({ error: 'Yêu cầu không hợp lệ' }, 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: 'Origin không hợp lệ' }, 403);
  if (!adminPasswordReady(env)) {
    return jsonResponse({ error: 'Chưa cài mật khẩu admin hợp lệ (ADMIN_PASSWORD: tối thiểu 12 ký tự, không lặp một ký tự) trên Cloudflare.' }, 503);
  }

  const who = ip(request);
  const now = Date.now();
  await ensureTable(env.DB);
  await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?1').bind(now - WINDOW_MS).run();
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?1').bind(who).first();
  if (n >= MAX_FAILS) return jsonResponse({ error: 'Sai quá nhiều lần. Hãy thử lại sau 15 phút.' }, 429);

  let body = {};
  try { body = await request.json(); } catch { /* để trống */ }

  if (!(await passwordMatches(env, body.password))) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?1, ?2)').bind(who, now).run();
    await sleep(700); // làm chậm việc đoán mật khẩu
    return jsonResponse({ error: 'Mật khẩu không đúng' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?1').bind(who).run();
  const s = await createSession(env);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': cookie(s.value, s.maxAge) });
}

export async function onRequestDelete({ request }) {
  if (request.headers.get('X-Admin-Request') !== '1') return jsonResponse({ error: 'Yêu cầu không hợp lệ' }, 403);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}
