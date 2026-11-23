// /img/<id>  — phục vụ ảnh upload từ Admin (lưu trong D1, bảng images).
// Sau này chuyển sang R2: thay phần đọc DB bằng env.IMAGES.get(...), URL không đổi.
export async function onRequestGet({ env, params }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id)) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?1').bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=31536000, immutable', // id không bao giờ đổi nội dung
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
