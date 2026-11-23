// POST /api/admin/upload  (multipart, trường "file") -> { url: "/img/12" }
// Hiện lưu ảnh trong D1 (bảng images). Muốn chuyển sang R2: thay hàm saveImage() bên dưới,
// trả về URL mới là xong — phần còn lại của hệ thống không phải đổi.
import { jsonResponse } from '../../_lib.js';

const MAX_BYTES = 1_300_000; // base64 phình ~33% và D1 giới hạn ~2MB mỗi dòng. Trình duyệt tự nén trước khi gửi.
const TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'image/avif': 1 };

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Kiểm tra "chữ ký" đầu file, không tin vào Content-Type do client gửi
function sniff(b) {
  const u = new Uint8Array(b.slice(0, 16));
  const ascii = (a, z) => String.fromCharCode(...u.slice(a, z));
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
  if (ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 16))) return 'image/avif';
  return null;
}

async function saveImage(env, mime, buf) {
  const r = await env.DB
    .prepare('INSERT INTO images (mime, size, data) VALUES (?1, ?2, ?3)')
    .bind(mime, buf.byteLength, toBase64(buf))
    .run();
  return `/img/${r.meta.last_row_id}`;
}

export async function onRequestPost({ env, request }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'Dữ liệu upload không hợp lệ' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return jsonResponse({ error: 'Thiếu file' }, 400);
  if (file.size > MAX_BYTES) return jsonResponse({ error: 'Ảnh quá lớn sau khi nén (tối đa 1.3MB)' }, 413);
  const buf = await file.arrayBuffer();
  const mime = sniff(buf);
  if (!mime || !TYPES[mime]) return jsonResponse({ error: 'Chỉ nhận ảnh JPG, PNG, WebP, GIF, AVIF' }, 415);
  return jsonResponse({ url: await saveImage(env, mime, buf) }, 201);
}
