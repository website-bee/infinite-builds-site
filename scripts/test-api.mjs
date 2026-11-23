// Kiểm thử backend: node scripts/test-api.mjs
// Dùng database SQLite trong bộ nhớ (nạp schema + seed), gọi trực tiếp các hàm xử lý của API.
import assert from 'node:assert/strict';
import { makeEnv } from './verify.mjs';
import { hydrateProduct, editorToStored, storedToEditor, productPage, collectionPage, ValidationError } from '../functions/_lib.js';
import * as middleware from '../functions/api/admin/_middleware.js';
import * as adminProducts from '../functions/api/admin/products.js';
import * as adminUpload from '../functions/api/admin/upload.js';
import * as adminCategories from '../functions/api/admin/categories.js';
import * as publicProducts from '../functions/api/products.js';
import * as img from '../functions/img/[id].js';

let pass = 0;
const test = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ✓', name);
  } catch (e) {
    console.log('  ✗', name, '\n   ', (e.stack || e).toString().split('\n').slice(0, 4).join('\n    '));
    process.exitCode = 1;
  }
};

const env = makeEnv();
env.DEV_AUTH_BYPASS = '1';
const URL0 = 'http://localhost';
const req = (path, init = {}) =>
  new Request(URL0 + path, { ...init, headers: { 'X-Admin-Request': '1', 'Content-Type': 'application/json', ...(init.headers || {}) } });
const call = async (mod, method, path, body) => {
  const request = req(path, { method, body: body ? JSON.stringify(body) : undefined });
  const ctx = { env, request, data: {}, params: {}, next: async () => mod['onRequest' + method[0] + method.slice(1).toLowerCase()]({ env, request, params: {} }) };
  return middleware.onRequest(ctx);
};
const json = async (res) => res.json();

console.log('Dữ liệu cũ đi qua form Admin');
await test('lưu lại cả 95 sản phẩm KHÔNG làm đổi dữ liệu nào (ảnh, màu, giá, key giỏ hàng)', async () => {
  const { results } = await env.DB.prepare('SELECT * FROM products').all();
  assert.equal(results.length, 95);
  for (const row of results) {
    const p = hydrateProduct(row);
    const s = editorToStored(storedToEditor(p), p.slug, p);
    assert.deepEqual(s.variants, p.variants, `variants ${p.slug}`);
    assert.deepEqual(s.options, p.options, `options ${p.slug}`);
    assert.deepEqual(s.images, p.images, `images ${p.slug}`);
    assert.equal(s.title, p.title);
    assert.equal(s.description, p.description, `description ${p.slug}`);
    assert.equal(s.category, p.category);
    assert.equal(s.seo_title, p.seo_title);
    assert.equal(s.seo_description, p.seo_description);
  }
});

console.log('Bảo mật');
await test('không có đăng nhập -> 401', async () => {
  const e2 = { ...env, DEV_AUTH_BYPASS: undefined };
  const r = await middleware.onRequest({ env: e2, request: new Request(URL0 + '/api/admin/products'), data: {}, next: async () => new Response('x') });
  assert.equal(r.status, 401);
});
await test('bypass chỉ có tác dụng ở localhost', async () => {
  const r = await middleware.onRequest({ env, request: new Request('https://shop.example.com/api/admin/products'), data: {}, next: async () => new Response('x') });
  assert.equal(r.status, 401);
});
await test('JWT giả / chưa cấu hình Access -> 401', async () => {
  const e2 = { ...env, DEV_AUTH_BYPASS: undefined, ACCESS_TEAM_DOMAIN: 'a.cloudflareaccess.com', ACCESS_AUD: 'x' };
  const r = await middleware.onRequest({
    env: e2,
    request: new Request('https://shop.example.com/api/admin/products', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } }),
    data: {},
    next: async () => new Response('x'),
  });
  assert.equal(r.status, 401);
});
await test('request ghi thiếu header X-Admin-Request -> 403', async () => {
  const r = await middleware.onRequest({ env, request: new Request(URL0 + '/api/admin/products', { method: 'POST', body: '{}' }), data: {}, next: async () => new Response('x') });
  assert.equal(r.status, 403);
});
await test('Origin khác domain -> 403', async () => {
  const r = await middleware.onRequest({
    env,
    request: new Request(URL0 + '/api/admin/products', { method: 'POST', body: '{}', headers: { 'X-Admin-Request': '1', Origin: 'https://evil.example' } }),
    data: {},
    next: async () => new Response('x'),
  });
  assert.equal(r.status, 403);
});

console.log('Thêm / sửa / xóa sản phẩm');
let newId, newSlug;
await test('tạo sản phẩm mới (nhiều màu, giá riêng một màu) -> hiện đúng trên trang', async () => {
  const r = await call(adminProducts, 'POST', '/api/admin/products', {
    title: "Test Shelf & Co's \"Mini\"",
    description: '<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(1)>',
    category: 'mini-planter',
    status: 'published',
    images: ['https://cdn.shopify.com/s/files/1/x/files/a.png?v=1', '/img/5'],
    options: [{ name: 'Color', values: ['White', 'Pink', 'Custom Blue'] }],
    price: 20.9, compareAt: 31.35, sku: 'T1',
    variants: [{ opts: ['Custom Blue'], price: 25, compareAt: 31.35, sku: 'T1-B' }],
  });
  const j = await json(r);
  assert.equal(r.status, 201, JSON.stringify(j));
  newId = j.id;
  newSlug = j.slug;
  assert.equal(newSlug, 'test-shelf-co-s-mini');
  const html = await productPage(env, new Request(URL0 + '/'), newSlug);
  assert.ok(html.includes('Test Shelf &amp; Co&#39;s &quot;Mini&quot;'), 'tiêu đề escape đúng');
  assert.ok(html.includes('From</span>') === false, 'trang sản phẩm không có chữ From');
  assert.ok(!html.includes('<script>alert(1)'), 'script trong mô tả bị gỡ');
  assert.ok(!/onerror/i.test(html), 'onerror bị gỡ');
  assert.ok(html.includes('data-handle="test-shelf-co-s-mini"'));
  const vj = JSON.parse(html.match(/id="variants-json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(vj.map((v) => [v.key, v.price]), [['test-shelf-co-s-mini::white', 20.9], ['test-shelf-co-s-mini::pink', 20.9], ['test-shelf-co-s-mini::custom-blue', 25]]);
  assert.ok(html.includes('src="/img/5"'), 'ảnh upload dùng URL /img/');
});
await test('sản phẩm mới đứng đầu danh mục và đầu /collections/all', async () => {
  const cat = await collectionPage(env, new Request(URL0 + '/'), 'mini-planter');
  assert.ok(cat.indexOf(newSlug) < cat.indexOf('bulb-round-plant-pot'));
  const all = await collectionPage(env, new Request(URL0 + '/'), 'all');
  assert.ok(all.indexOf(newSlug) > 0 && all.indexOf(newSlug) < all.indexOf('5-tier-3-tier-shelf-connector'));
  assert.ok(all.includes('96 products'));
});
await test('slug trùng -> lỗi 400; danh mục không tồn tại -> lỗi 400; giá âm -> lỗi 400', async () => {
  const base = { title: 'A', price: 1, options: [] };
  let r = await call(adminProducts, 'POST', '/api/admin/products', { ...base, slug: newSlug });
  assert.equal(r.status, 400);
  r = await call(adminProducts, 'POST', '/api/admin/products', { ...base, category: 'khong-co' });
  assert.equal(r.status, 400);
  r = await call(adminProducts, 'POST', '/api/admin/products', { ...base, price: -5 });
  assert.equal(r.status, 400);
  r = await call(adminProducts, 'POST', '/api/admin/products', { ...base, images: ['javascript:alert(1)'] });
  assert.equal(r.status, 400);
});
await test('sửa sản phẩm: đổi giá, thêm màu mới; slug và key cũ giữ nguyên', async () => {
  const cur = (await json(await call(adminProducts, 'GET', `/api/admin/products?id=${newId}`))).product;
  const r = await call(adminProducts, 'PUT', `/api/admin/products?id=${newId}`, {
    ...cur,
    slug: 'toi-co-doi-slug',
    price: 19.9,
    options: [{ name: 'Color', values: ['White', 'Pink', 'Custom Blue', 'Mint'] }],
    variants: [],
  });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const html = await productPage(env, new Request(URL0 + '/'), newSlug);
  assert.ok(html, 'URL cũ vẫn còn');
  const vj = JSON.parse(html.match(/id="variants-json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(vj.map((v) => v.key), ['white', 'pink', 'custom-blue', 'mint'].map((x) => `${newSlug}::${x}`));
  assert.equal(vj[3].price, 19.9);
  assert.ok(html.includes('From') === false);
});
await test('chuyển sang nháp -> trang biến mất (404), danh sách công khai không còn', async () => {
  const cur = (await json(await call(adminProducts, 'GET', `/api/admin/products?id=${newId}`))).product;
  await call(adminProducts, 'PUT', `/api/admin/products?id=${newId}`, { ...cur, status: 'draft' });
  assert.equal(await productPage(env, new Request(URL0 + '/'), newSlug), null);
  const pub = await json(await publicProducts.onRequestGet({ env, request: new Request(URL0 + '/api/products') }));
  assert.ok(!pub.products.some((p) => p.slug === newSlug));
  assert.equal(pub.products.length, 95);
  const adm = await json(await call(adminProducts, 'GET', '/api/admin/products'));
  assert.ok(adm.products.some((p) => p.slug === newSlug && p.status === 'draft'));
});
await test('xóa sản phẩm', async () => {
  const r = await call(adminProducts, 'DELETE', `/api/admin/products?id=${newId}`);
  assert.equal(r.status, 200);
  assert.equal((await call(adminProducts, 'DELETE', `/api/admin/products?id=${newId}`)).status, 404);
});
await test('sản phẩm KHÔNG có tùy chọn (Default Title) tạo và đọc đúng', async () => {
  const r = await call(adminProducts, 'POST', '/api/admin/products', { title: 'Plain Thing', price: 9, compareAt: 12, images: [], options: [] });
  assert.equal(r.status, 201);
  const html = await productPage(env, new Request(URL0 + '/'), 'plain-thing');
  assert.ok(html && !html.includes('variant-picker'));
  const vj = JSON.parse(html.match(/id="variants-json">(.*?)<\/script>/s)[1]);
  assert.equal(vj[0].key, 'plain-thing::Default Title');
  await env.DB.prepare("DELETE FROM products WHERE slug='plain-thing'").run();
});

console.log('Upload ảnh');
await test('upload PNG hợp lệ -> phục vụ lại đúng nội dung & cache', async () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.set('file', new File([png], 'x.png', { type: 'image/png' }));
  const request = new Request(URL0 + '/api/admin/upload', { method: 'POST', body: fd, headers: { 'X-Admin-Request': '1' } });
  const res = await middleware.onRequest({ env, request, data: {}, next: () => adminUpload.onRequestPost({ env, request }) });
  const j = await res.json();
  assert.equal(res.status, 201, JSON.stringify(j));
  const out = await img.onRequestGet({ env, params: { id: j.url.split('/').pop() } });
  assert.equal(out.headers.get('Content-Type'), 'image/png');
  assert.match(out.headers.get('Cache-Control'), /immutable/);
  assert.deepEqual(new Uint8Array(await out.arrayBuffer()), png);
});
await test('upload file giả mạo (HTML đặt tên .png) -> 415', async () => {
  const fd = new FormData();
  fd.set('file', new File(['<script>alert(1)</script>'], 'x.png', { type: 'image/png' }));
  const request = new Request(URL0 + '/api/admin/upload', { method: 'POST', body: fd, headers: { 'X-Admin-Request': '1' } });
  const res = await adminUpload.onRequestPost({ env, request });
  assert.equal(res.status, 415);
});
await test('/img/<id> không tồn tại -> 404', async () => {
  assert.equal((await img.onRequestGet({ env, params: { id: '99999' } })).status, 404);
  assert.equal((await img.onRequestGet({ env, params: { id: 'abc' } })).status, 404);
});

console.log('Danh mục');
await test('thêm danh mục -> hiện ở menu & trang /collections; xóa -> sản phẩm về "không danh mục"', async () => {
  let r = await call(adminCategories, 'POST', '/api/admin/categories', { name: 'Test Cat' });
  assert.equal(r.status, 201);
  const html = await collectionPage(env, new Request(URL0 + '/'), '');
  assert.ok(html.includes('collections/test-cat'));
  assert.ok((await collectionPage(env, new Request(URL0 + '/'), 'test-cat')).includes('0 products'));
  await env.DB.prepare("UPDATE products SET category='test-cat' WHERE slug='plain-thing' OR id=1").run();
  r = await call(adminCategories, 'DELETE', '/api/admin/categories?slug=test-cat');
  assert.equal(r.status, 200);
  const row = await env.DB.prepare('SELECT category FROM products WHERE id=1').first();
  assert.equal(row.category, null);
  assert.equal(await collectionPage(env, new Request(URL0 + '/'), 'test-cat'), null);
});

console.log(`\n${pass} kiểm thử đạt${process.exitCode ? ', CÓ LỖI' : ''}`);
