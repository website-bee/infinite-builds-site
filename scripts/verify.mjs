// Kiểm thử: dựng lại từng trang từ database và so với HTML cũ trong legacy/.
// Chạy:  node scripts/verify.mjs
// Không cần mạng, không cần Cloudflare: dùng SQLite có sẵn trong Node và nạp db/seed.sql.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productPage, collectionPage, blogPage } from '../functions/_lib.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

export function makeEnv() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(read('db/schema.sql'));
  sql.exec(read('db/seed.sql'));
  // Bọc SQLite thành giao diện giống D1: prepare().bind().all()/first()/run()
  const DB = {
    prepare(q) {
      let args = [];
      const stmt = {
        bind: (...a) => ((args = a), stmt),
        all: async () => ({ results: sql.prepare(q).all(...args).map((r) => ({ ...r })) }),
        first: async () => {
          const r = sql.prepare(q).get(...args);
          return r ? { ...r } : null;
        },
        run: async () => {
          const r = sql.prepare(q).run(...args);
          return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
        },
      };
      return stmt;
    },
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  };
  const ASSETS = {
    fetch: async (req) => {
      const f = join(ROOT, 'public', new URL(req.url).pathname);
      return existsSync(f) ? new Response(readFileSync(f, 'utf8')) : new Response('nf', { status: 404 });
    },
  };
  return { DB, ASSETS, sql };
}

// So sánh: gom khoảng trắng liên tiếp thành 1, và bỏ khoảng trắng ngay trước thẻ đóng khối
// (Astro sinh khoảng trắng thừa ở những chỗ này, không ảnh hưởng hiển thị).
const norm = (h) =>
  h
    .replace(/\s+/g, ' ')
    .replace(/ <\/(div|section|p|main|article)>/g, '</$1>')
    .trim();

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `tại ký tự ${i}\n   mới: …${a.slice(Math.max(0, i - 60), i + 90)}\n   cũ : …${b.slice(Math.max(0, i - 60), i + 90)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = makeEnv();
  const req = (path) => new Request('http://localhost' + path);
  const results = { products: [0, 0], collections: [0, 0], blog: [0, 0] };
  const fails = [];
  const check = async (group, path, legacyFile, render) => {
    results[group][1]++;
    let html;
    try {
      html = await render();
    } catch (e) {
      fails.push(`${path}: LỖI ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
      return;
    }
    if (html == null) return fails.push(`${path}: trả về 404`);
    const a = norm(html);
    const b = norm(read(legacyFile));
    if (a === b) results[group][0]++;
    else fails.push(`${path}: KHÁC ${firstDiff(a, b)}`);
  };

  for (const f of readdirSync(join(ROOT, 'legacy/products')).sort()) {
    const slug = f.replace(/\.html$/, '');
    await check('products', `/products/${slug}`, `legacy/products/${f}`, () => productPage(env, req('/'), slug));
  }
  await check('collections', '/collections', 'legacy/collections/index.html', () => collectionPage(env, req('/'), ''));
  for (const f of readdirSync(join(ROOT, 'legacy/collections')).sort()) {
    if (f === 'index.html') continue;
    const slug = f.replace(/\.html$/, '');
    await check('collections', `/collections/${slug}`, `legacy/collections/${f}`, () => collectionPage(env, req('/'), slug));
  }
  await check('blog', '/blog', 'legacy/blog/index.html', () => blogPage(env, req('/'), ''));
  for (const f of readdirSync(join(ROOT, 'legacy/blog')).sort()) {
    if (f === 'index.html') continue;
    const slug = f.replace(/\.html$/, '');
    await check('blog', `/blog/${slug}`, `legacy/blog/${f}`, () => blogPage(env, req('/'), slug));
  }

  for (const [g, [ok, total]] of Object.entries(results)) console.log(`${g.padEnd(12)} ${ok}/${total} giống hệt bản cũ`);
  if (fails.length) {
    console.log(`\n${fails.length} trang khác:`);
    for (const x of fails.slice(0, 12)) console.log(' -', x);
    process.exitCode = 1;
  }
}
