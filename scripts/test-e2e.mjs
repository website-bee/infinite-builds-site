// Kiểm thử qua HTTP thật (server đang chạy). Dùng cho máy local hoặc sau khi deploy:
//   npx wrangler pages dev            # cửa sổ 1
//   node scripts/test-e2e.mjs http://127.0.0.1:8788   # cửa sổ 2
// Với site thật (có Cloudflare Access) các bước Admin sẽ bị bỏ qua vì không có đăng nhập.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const norm = (h) => h.replace(/\s+/g, ' ').replace(/ <\/(div|section|p|main|article)>/g, '</$1>').trim();
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  ✗', msg); } return c; };

console.log(`Trang công khai so với bản cũ (${BASE})`);
const groups = [['products', '/products/'], ['collections', '/collections/'], ['blog', '/blog/']];
for (const [dir, prefix] of groups) {
  let good = 0, total = 0;
  for (const f of readdirSync(join(ROOT, 'legacy', dir))) {
    const slug = f.replace(/\.html$/, '');
    const url = BASE + (slug === 'index' ? prefix.slice(0, -1) : prefix + slug);
    total++;
    const res = await fetch(url);
    const body = await res.text();
    if (res.status === 200 && norm(body) === norm(readFileSync(join(ROOT, 'legacy', dir, f), 'utf8'))) good++;
    else console.log('  ✗', url, res.status);
  }
  console.log(`  ${dir.padEnd(12)} ${good}/${total} giống hệt`);
  if (good !== total) fails++;
}

console.log('URL cũ');
for (const [path, expect] of [['/products/5-tier-3-tier-shelf-connector.html', '/products/5-tier-3-tier-shelf-connector'], ['/blog/index.html', '/blog'], ['/collections/index.html', '/collections']]) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  ok([301, 308].includes(r.status) && new URL(r.headers.get('location'), BASE).pathname === expect, `${path} -> ${expect} (nhận ${r.status} ${r.headers.get('location')})`);
}
ok((await fetch(BASE + '/products/khong-ton-tai')).status === 404, '/products/khong-ton-tai phải 404');
ok((await fetch(BASE + '/collections/khong-ton-tai')).status === 404, '/collections/khong-ton-tai phải 404');
ok((await fetch(BASE + '/blog/khong-ton-tai')).status === 404, '/blog/khong-ton-tai phải 404');
for (const p of ['/', '/cart', '/about', '/contact', '/checkout/success', '/checkout/cancel', '/policies/privacy-policy', '/policies/terms-of-service', '/policies/shipping-and-refund-policy']) {
  ok((await fetch(BASE + p)).status === 200, `${p} phải 200`);
}
const rp = await fetch(BASE + '/policies/refund-policy', { redirect: 'manual' });
ok(rp.status === 301 && rp.headers.get('location').endsWith('/policies/shipping-and-refund-policy'), 'refund-policy vẫn 301');

console.log('API công khai');
const pub = await (await fetch(BASE + '/api/products')).json();
ok(Array.isArray(pub.products) && pub.products.length > 0, '/api/products có dữ liệu');
console.log('  ', pub.products.length, 'sản phẩm; ví dụ:', JSON.stringify(pub.products[0]).slice(0, 150));

console.log('Admin');
const H = { 'X-Admin-Request': '1', 'Content-Type': 'application/json' };
const probe = await fetch(BASE + '/api/admin/products');
if (probe.status === 401) {
  console.log('  (bị chặn 401 — đúng với site có Access. Bỏ qua các bước Admin.)');
} else {
  const A = async (p, m = 'GET', b) => fetch(BASE + '/api/admin' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const create = await A('/products', 'POST', { title: 'E2E Test Item', price: 10, compareAt: 15, category: 'mini-planter', status: 'published',
    images: ['https://cdn.shopify.com/s/files/1/0962/4138/5545/files/a.png?v=1'], options: [{ name: 'Color', values: ['White', 'Black'] }] });
  const c = await create.json();
  ok(create.status === 201, 'tạo sản phẩm: ' + JSON.stringify(c));
  let page = await fetch(BASE + '/products/e2e-test-item');
  let html = await page.text();
  ok(page.status === 200 && html.includes('E2E Test Item') && html.includes('$10.00') && html.includes('Sale 33%'), 'trang sản phẩm mới hiện ngay, không cần deploy');
  ok(html.includes('class="swatch"') || html.includes('ib-swatches'), 'có script chọn màu');
  const all = await (await fetch(BASE + '/collections/all')).text();
  ok(all.includes('e2e-test-item') && all.includes('96 products'), 'xuất hiện trong /collections/all');
  const api = await (await fetch(BASE + '/api/products')).json();
  ok(api.products.some((p) => p.slug === 'e2e-test-item'), 'xuất hiện trong /api/products (tìm kiếm)');

  const cur = (await (await A('/products?id=' + c.id)).json()).product;
  cur.price = 12;
  cur.variants.forEach((v) => (v.price = 12)); // giao diện Admin cũng áp giá chung cho các dòng biến thể
  cur.status = 'published';
  const up = await A('/products?id=' + c.id, 'PUT', cur);
  ok(up.status === 200, 'sửa giá');
  html = await (await fetch(BASE + '/products/e2e-test-item')).text();
  ok(html.includes('$12.00'), 'giá mới hiện ngay');

  // upload ảnh thật (PNG 1x1)
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const fd = new FormData();
  fd.set('file', new File([png], 'a.png', { type: 'image/png' }));
  const upr = await fetch(BASE + '/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Request': '1' }, body: fd });
  const upj = await upr.json();
  ok(upr.status === 201 && /^\/img\/\d+$/.test(upj.url), 'upload ảnh: ' + JSON.stringify(upj));
  const im = await fetch(BASE + upj.url);
  ok(im.status === 200 && im.headers.get('content-type') === 'image/png', 'ảnh upload xem được qua /img/…');

  const noHeader = await fetch(BASE + '/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  ok(noHeader.status === 403, 'thiếu X-Admin-Request bị chặn 403');

  const del = await A('/products?id=' + c.id, 'DELETE');
  ok(del.status === 200, 'xóa');
  ok((await fetch(BASE + '/products/e2e-test-item')).status === 404, 'trang sản phẩm đã xóa -> 404');
  const all2 = await (await fetch(BASE + '/collections/all')).text();
  ok(all2.includes('95 products') && !all2.includes('e2e-test-item'), 'danh mục trở lại 95 sản phẩm');
}
console.log(fails ? `\n${fails} nhóm LỖI` : '\nTất cả đạt');
process.exitCode = fails ? 1 : 0;
