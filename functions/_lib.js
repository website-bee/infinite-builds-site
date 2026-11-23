// Hàm dùng chung cho toàn bộ backend. Mục lục:
//   1. Template engine nhỏ     ({{x}}, {{{x}}}, #if, #each, partial)
//   2. Tiện ích                (escape, URL ảnh, giá, slug, JSON)
//   3. Truy vấn D1             (categories, products, posts)
//   4. Dựng dữ liệu cho trang  (product, collection, blog)
//   5. Render trang            (ghép template + dữ liệu)
//   6. Xác thực Cloudflare Access

// ═════════════════════════════════════════════════════════════════════════════
// 1. TEMPLATE ENGINE
// ═════════════════════════════════════════════════════════════════════════════
//   {{ten}}            in ra, tự escape chữ (& < >)
//   {{ten|attr}}       escape cho giá trị thuộc tính HTML (alt="...", content="...")
//   {{ten|url}}        escape cho URL (giữ nguyên dấu &)
//   {{{ten}}}          in nguyên văn, KHÔNG escape (chỉ dùng cho HTML đã dựng sẵn)
//   {{a.b}}            đọc thuộc tính lồng nhau
//   {{#if x}}..{{else}}..{{/if}}
//   {{#each ds}}..{{/each}}   trong vòng lặp có {{@n}} (đếm từ 1) và {{@index}} (từ 0)
//   {{> ten}}          chèn mẫu con (partial) có tên "ten"
// Template file chia thành các phần bằng dòng <!--@ten-->.

function parseTemplate(src) {
  const re = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;
  const root = [];
  const stack = [{ nodes: root }];
  let last = 0;
  let m;
  const push = (n) => stack[stack.length - 1].nodes.push(n);
  while ((m = re.exec(src))) {
    if (m.index > last) push({ t: 'text', v: src.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1] !== undefined) {
      push({ t: 'var', path: m[1].trim(), raw: true });
      continue;
    }
    const tag = m[2].trim();
    if (tag.startsWith('#if ') || tag.startsWith('#each ')) {
      const isIf = tag.startsWith('#if ');
      const node = { t: isIf ? 'if' : 'each', path: tag.slice(isIf ? 4 : 6).trim(), yes: [], no: [] };
      push(node);
      stack.push({ node, nodes: node.yes });
    } else if (tag === 'else') {
      const top = stack[stack.length - 1];
      top.nodes = top.node.no;
    } else if (tag === '/if' || tag === '/each') {
      stack.pop();
    } else if (tag.startsWith('>')) {
      push({ t: 'part', name: tag.slice(1).trim() });
    } else {
      const [path, filter] = tag.split('|').map((x) => x.trim());
      push({ t: 'var', path, filter });
    }
  }
  if (last < src.length) push({ t: 'text', v: src.slice(last) });
  return root;
}

function lookup(scopes, path) {
  if (path.startsWith('@')) {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i] && path in scopes[i]) return scopes[i][path];
    return undefined;
  }
  const parts = path.split('.');
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s && typeof s === 'object' && parts[0] in s) {
      let v = s;
      for (const p of parts) v = v == null ? undefined : v[p];
      return v;
    }
  }
  return undefined;
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

function renderNodes(nodes, scopes, partials) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') {
      const v = lookup(scopes, n.path);
      const s = v == null ? '' : String(v);
      out += n.raw ? s : n.filter === 'attr' ? escAttr(s) : n.filter === 'url' ? escUrl(s) : escText(s);
    } else if (n.t === 'if') {
      out += renderNodes(truthy(lookup(scopes, n.path)) ? n.yes : n.no, scopes, partials);
    } else if (n.t === 'each') {
      const list = lookup(scopes, n.path) || [];
      list.forEach((item, i) => {
        const frame = typeof item === 'object' && item ? { ...item } : { this: item };
        frame['@index'] = i;
        frame['@n'] = i + 1;
        out += renderNodes(n.yes, [...scopes, frame], partials);
      });
    } else if (n.t === 'part') {
      const p = partials[n.name];
      if (p) out += renderNodes(p, scopes, partials);
    }
  }
  return out;
}

const compiled = new Map();
/** Tách file template thành các phần <!--@ten--> và biên dịch từng phần. */
export function compileFile(src) {
  if (compiled.has(src)) return compiled.get(src);
  const parts = {};
  const pieces = src.split(/^<!--@([a-z_]+)-->\r?\n?/m);
  // pieces = [trước-phần-đầu, ten1, noidung1, ten2, noidung2, ...]
  for (let i = 1; i < pieces.length; i += 2) parts[pieces[i]] = parseTemplate(pieces[i + 1].replace(/\r?\n$/, ''));
  compiled.set(src, parts);
  return parts;
}

/** Render phần `name` của một file template, với các partial lấy từ mọi file đã nạp. */
export function renderPart(files, name, data) {
  const partials = Object.assign({}, ...files);
  return renderNodes(partials[name], [data], partials);
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. TIỆN ÍCH
// ═════════════════════════════════════════════════════════════════════════════
export const SITE_NAME = 'Infinite Builds Studio';
export const DEFAULT_DESC =
  'Infinite Builds Studio — 3D printed & laser-cut dollhouse miniatures, Smiski & Sonny Angel display shelves.';
export const LOGO =
  'https://cdn.shopify.com/s/files/1/0962/4138/5545/files/Infi_Logo_from_Material_Shopify.png?height=112';

/** Màu có sẵn để hiện ô tròn chọn màu. Tên màu (không phân biệt hoa thường) -> màu CSS.
 *  Muốn thêm màu mới: thêm một dòng vào đây. Nhóm tùy chọn nào có đủ màu trong bảng này sẽ hiện ô tròn. */
export const COLOR_MAP = {
  'pink': '#e8a7b8',
  'silver': 'linear-gradient(135deg,#e4e4e8,#8d8c94 55%,#d0d0d6)',
  'morandi purple': '#c4848a',
  'dark grey': '#3d4559',
  'strawberry red': '#e0505f',
  'matte green': '#7fbf98',
  'olive green': '#6b7340',
  'matcha green': '#7cbf45',
  'morandi green': '#2f6b72',
  'lilac purple': '#d9bfe3',
  'gold': 'linear-gradient(135deg,#e3cf8a,#b99e55 55%,#d8c27c)',
  'black': '#1f2120',
  'red': '#ee3b2c',
  'grey': '#8a8a8a',
  'orange': '#d9481f',
  'blue': '#8fc6dc',
  'brown': '#8c7064',
  'white': '#f6f6f3',
  'yellow': '#dbe78f',
  'beige': '#c5b5a6',
  'green': '#3f8f4e',
  'wood': '#b98a5a',
  'clear acrylic': 'linear-gradient(135deg,#fff,#d5e8ef)',
  'barbie - pink': '#ec5fa4',
  'barbie - black': '#1f2120',
};
// Giữ đúng định dạng JSON cũ của trang (có dấu cách sau dấu : và ,)
const colorMapJS = () => JSON.stringify(COLOR_MAP).replace(/":"/g, '": "').replace(/","/g, '", "');

export const escText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const escAttr = (s) => String(s).replace(/&/g, '&#38;').replace(/"/g, '&#34;');
export const escUrl = (s) => String(s).replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\s/g, '%20');

/** URL ảnh theo kích thước. Ảnh Shopify CDN gắn width=; ảnh khác (vd /img/12) giữ nguyên. */
export function sized(url, width) {
  if (!url) return url;
  if (!/^https?:\/\/cdn\.shopify\.com\//.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'width=' + width;
}

export const money = (n) => '$' + Number(n).toFixed(2);
export const onSale = (price, compareAt) => compareAt != null && compareAt > price;
export const salePercent = (price, compareAt) => Math.round((1 - price / compareAt) * 100);

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseJSON(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** JSON an toàn để nhúng trong <script>: không để lọt "</script>" hay "<!--". */
export const safeJSON = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

export function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}
export function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. TRUY VẤN D1
// ═════════════════════════════════════════════════════════════════════════════
export function hydrateProduct(row) {
  if (!row) return null;
  return {
    ...row,
    images: parseJSON(row.images, []),
    options: parseJSON(row.options, []),
    variants: parseJSON(row.variants, []),
  };
}

export async function getCategories(db) {
  const { results } = await db.prepare('SELECT slug, name, image, sort FROM categories ORDER BY sort, slug').all();
  return results;
}

export async function getProduct(db, slug, { drafts = false } = {}) {
  const row = await db
    .prepare(`SELECT * FROM products WHERE slug = ?1 ${drafts ? '' : "AND status = 'published'"}`)
    .bind(slug)
    .first();
  return hydrateProduct(row);
}

/** Danh sách sản phẩm theo đúng thứ tự trang: danh mục -> sort_cat, tất cả -> sort_all. */
export async function listProducts(db, { category = null, drafts = false, limit = 1000 } = {}) {
  const where = [];
  const args = [];
  if (!drafts) where.push("status = 'published'");
  if (category) {
    where.push('category = ?' + (args.push(category), args.length));
  }
  const order = category ? 'sort_cat, id' : 'sort_all, id';
  const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit | 0}`;
  const { results } = await db.prepare(sql).bind(...args).all();
  return results.map(hydrateProduct);
}

export async function countByCategory(db) {
  const { results } = await db
    .prepare("SELECT category, COUNT(*) AS n FROM products WHERE status = 'published' GROUP BY category")
    .all();
  const map = {};
  let total = 0;
  for (const r of results) {
    total += r.n;
    if (r.category) map[r.category] = r.n;
  }
  return { map, total };
}

export async function listPosts(db, { drafts = false } = {}) {
  const { results } = await db
    .prepare(`SELECT * FROM posts ${drafts ? '' : "WHERE status = 'published'"} ORDER BY published_at DESC, rowid`)
    .all();
  return results;
}
export async function getPost(db, slug, { drafts = false } = {}) {
  return db
    .prepare(`SELECT * FROM posts WHERE slug = ?1 ${drafts ? '' : "AND status = 'published'"}`)
    .bind(slug)
    .first();
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. DỰNG DỮ LIỆU CHO TRANG
// ═════════════════════════════════════════════════════════════════════════════
const seoOf = (title, description, image) => ({
  seo_title: title,
  seo_description: description,
  og_image: image,
});

/** Biến thể rẻ nhất (nếu bằng giá thì lấy biến thể đứng trước). */
const cheapest = (variants) =>
  variants.reduce((best, v) => (best == null || v.price < best.price ? v : best), null) || { price: 0, compareAt: null };
const hasPriceRange = (variants) => new Set(variants.map((v) => v.price)).size > 1;

/** Thẻ sản phẩm (dùng ở lưới danh mục và mục "You may also like").
 *  Hiện giá thấp nhất; nếu các biến thể khác giá thì thêm chữ "From". */
export function cardView(p, width) {
  const v = cheapest(p.variants);
  const sale = onSale(v.price, v.compareAt);
  return {
    slug: p.slug,
    title: p.title,
    img: sized(p.images[0], width),
    sale,
    from: hasPriceRange(p.variants),
    badge: sale ? `Sale ${salePercent(v.price, v.compareAt)}%` : '',
    now: money(v.price),
    was: sale ? money(v.compareAt) : '',
  };
}

export function productView(p, category, related, categories) {
  const v0 = p.variants[0] || { price: 0, compareAt: null, sku: '' };
  // Trang hiện sẵn giá thấp nhất (kèm giá gốc của biến thể đầu); JS trong trình duyệt sẽ cập nhật khi chọn màu.
  const lowest = cheapest(p.variants).price;
  const sale = onSale(lowest, v0.compareAt);
  const mainImage = p.images[0];
  const variantsOut = p.variants.map((v) => ({
    key: v.key,
    label: v.label,
    option1: v.option1 ?? null,
    option2: v.option2 ?? null,
    option3: v.option3 ?? null,
    price: v.price,
    sku: v.sku ?? '',
    image: v.image ? sized(v.image, 1000) : null,
    cartImage: sized(v.image || mainImage, 300),
    compareAt: v.compareAt ?? null,
  }));
  return {
    ...seoOf(
      p.seo_title || `${p.title} — ${SITE_NAME}`,
      p.seo_description || DEFAULT_DESC,
      p.og_image || LOGO
    ),
    slug: p.slug,
    title: p.title,
    cat_slug: category ? category.slug : 'all',
    cat_name: category ? category.name : 'Products',
    main_image: sized(mainImage, 1000),
    images: p.images.map((u) => ({ big: sized(u, 1000), small: sized(u, 160) })),
    sale,
    price: money(lowest),
    compare: sale ? money(v0.compareAt) : '',
    badge: sale ? `Sale ${salePercent(lowest, v0.compareAt)}%` : '',
    has_options: p.options.length > 0,
    color_map: colorMapJS(),
    options: p.options.map((o) => ({ name: o.name, values: o.values })),
    sku: v0.sku || '—',
    description: p.description,
    related: related.map((r) => cardView(r, 400)),
    variants_json: safeJSON(variantsOut),
    nav_collections: navCollections(categories),
  };
}

export function navCollections(categories) {
  return categories
    .map((c) => `<a href="collections/${escUrl(c.slug)}">${escText(c.name)}</a>`)
    .join('');
}

export function collectionView(category, products, categories, counts) {
  const isAll = !category;
  const name = isAll ? 'All Products' : category.name;
  return {
    ...seoOf(`${name} — ${SITE_NAME}`, DEFAULT_DESC, LOGO),
    is_index: false,
    is_all: isAll,
    name,
    count: `${products.length} product${products.length === 1 ? '' : 's'}`,
    products: products.map((p) => cardView(p, 600)),
    nav_collections: navCollections(categories),
  };
}

export function collectionIndexView(categories, counts) {
  return {
    ...seoOf(`Collections — ${SITE_NAME}`, DEFAULT_DESC, LOGO),
    is_index: true,
    tiles: categories.map((c) => ({
      slug: c.slug,
      name: c.name,
      img: sized(c.image, 600),
      count: `${counts.map[c.slug] || 0} product${(counts.map[c.slug] || 0) === 1 ? '' : 's'}`,
    })),
    all_count: `${counts.total} product${counts.total === 1 ? '' : 's'}`,
    nav_collections: navCollections(categories),
  };
}

export function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function blogIndexView(posts, categories) {
  return {
    ...seoOf(`Blog — ${SITE_NAME}`, DEFAULT_DESC, LOGO),
    is_index: true,
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      date: formatDate(p.published_at),
      thumb: sized(p.cover, 600),
    })),
    nav_collections: navCollections(categories),
  };
}

export function postView(p, categories) {
  const date = formatDate(p.published_at);
  return {
    ...seoOf(
      `${p.title} — ${SITE_NAME}`,
      p.seo_description || p.excerpt || DEFAULT_DESC,
      p.og_image || (p.cover ? sized(p.cover, 1200) : LOGO)
    ),
    is_index: false,
    title: p.title,
    byline: p.author ? `${date} · ${p.author}` : date,
    cover: p.cover ? sized(p.cover, 1200) : '',
    content: p.content,
    nav_collections: navCollections(categories),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. RENDER TRANG
// ═════════════════════════════════════════════════════════════════════════════
async function loadTemplateFiles(env, request, names) {
  const files = [];
  for (const name of ['layout', ...names]) {
    const url = new URL(`/templates/${name}.html`, request.url);
    const res = await env.ASSETS.fetch(new Request(url));
    if (!res.ok) throw new Error(`Không đọc được template ${name}.html (${res.status})`);
    files.push(compileFile(await res.text()));
  }
  return files;
}

/** Ghép trang hoàn chỉnh: nội dung `main` của template trang + khung layout. */
export async function renderPage(env, request, templateName, data) {
  const files = await loadTemplateFiles(env, request, templateName ? [templateName] : []);
  const has = (n) => files.some((f) => f[n]);
  const part = (n) => (has(n) ? renderPart(files, n, data) : '');
  return renderPart(files, 'layout', {
    ...data,
    style: part('style'),
    main: has('main') ? part('main') : data.main_html || '',
    scripts: part('scripts'),
    after: part('after'),
  });
}

/** Trang sản phẩm. Trả về chuỗi HTML, hoặc null nếu không có (hoặc đang là bản nháp). */
export async function productPage(env, request, slug) {
  const p = await getProduct(env.DB, slug);
  if (!p) return null;
  const categories = await getCategories(env.DB);
  const category = categories.find((c) => c.slug === p.category) || null;
  const related = category
    ? (await listProducts(env.DB, { category: category.slug })).filter((x) => x.slug !== p.slug).slice(0, 4)
    : [];
  return renderPage(env, request, 'product', productView(p, category, related, categories));
}

/** Trang danh mục. slug rỗng = trang /collections, "all" = tất cả sản phẩm. */
export async function collectionPage(env, request, slug) {
  const categories = await getCategories(env.DB);
  if (!slug) {
    return renderPage(env, request, 'collection', collectionIndexView(categories, await countByCategory(env.DB)));
  }
  if (slug === 'all') {
    return renderPage(env, request, 'collection', collectionView(null, await listProducts(env.DB), categories));
  }
  const category = categories.find((c) => c.slug === slug);
  if (!category) return null;
  const products = await listProducts(env.DB, { category: slug });
  return renderPage(env, request, 'collection', collectionView(category, products, categories));
}

/** Trang blog. slug rỗng = danh sách bài. */
export async function blogPage(env, request, slug) {
  const categories = await getCategories(env.DB);
  if (!slug) return renderPage(env, request, 'post', blogIndexView(await listPosts(env.DB), categories));
  const post = await getPost(env.DB, slug);
  if (!post) return null;
  return renderPage(env, request, 'post', postView(post, categories));
}

/** Khi route không tìm thấy trang: nếu database đã có dữ liệu -> trả 404 thật (kèm menu);
 *  nếu database trống/lỗi (chưa seed) -> chuyển cho file tĩnh cũ để site không bị hỏng. */
export async function notFoundOrNext(env, request, next) {
  let seeded = false;
  try {
    seeded = !!(await env.DB.prepare('SELECT 1 AS x FROM products LIMIT 1').first());
  } catch {
    /* chưa có bảng */
  }
  if (!seeded) return next();
  const html = await renderPage(env, request, null, {
    ...seoOf(`Page not found — ${SITE_NAME}`, DEFAULT_DESC, LOGO),
    nav_collections: navCollections(await getCategories(env.DB)),
    main_html:
      '<section class="wrap" style="padding:72px 0;text-align:center"><h1>Page not found</h1>' +
      '<p>The page you are looking for does not exist or is no longer available.</p>' +
      '<p><a href="./">Back to home</a> · <a href="collections/all">Shop all products</a></p></section>',
  });
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. ADMIN: KIỂM TRA VÀ CHUYỂN ĐỔI DỮ LIỆU SẢN PHẨM
// ═════════════════════════════════════════════════════════════════════════════
// Dạng "editor" (Admin gửi/nhận):
//   { title, description, category, status, images:[url],
//     options:[{name, values:["White","Grey"]}],            // tối đa 3 nhóm
//     price, compareAt, sku,                                 // mặc định cho mọi biến thể
//     variants:[{opts:["White"], price, compareAt, sku, image}],  // chỉ cần ghi khi muốn khác mặc định
//     seo_title, seo_description, og_image }
// Dạng "stored" (lưu trong D1): xem db/schema.sql.

export class ValidationError extends Error {}
const bad = (msg) => {
  throw new ValidationError(msg);
};

const URL_OK = /^(https:\/\/[^\s"'<>\\]+|\/img\/\d+)$/;
export function cleanUrl(u, what = 'Link ảnh') {
  const v = String(u ?? '').trim();
  if (!URL_OK.test(v)) bad(`${what} không hợp lệ: ${v.slice(0, 80)}`);
  return v;
}
function text(v, max, name, { required = false } = {}) {
  const t = String(v ?? '').trim();
  if (required && !t) bad(`${name} không được để trống`);
  if (t.length > max) bad(`${name} dài quá ${max} ký tự`);
  return t;
}
const optText = (v, max, name) => text(v, max, name) || null;
function money2(v, name, { allowNull = false } = {}) {
  if ((v === '' || v == null) && allowNull) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) bad(`${name} không hợp lệ`);
  return Math.round(n * 100) / 100;
}

/** Bỏ script, iframe, thuộc tính on...= và javascript: khỏi HTML mô tả/bài viết. */
export function cleanHtml(html) {
  return String(html ?? '')
    .replace(/<\s*(script|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

export function isValidSlug(s) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 200;
}

const MAX_VARIANTS = 400;

/** Chuyển dữ liệu editor -> dữ liệu lưu trữ. `existing` là sản phẩm đã hydrate (khi sửa), null khi tạo mới. */
export function editorToStored(input, slug, existing = null) {
  const title = text(input.title, 200, 'Tiêu đề', { required: true });
  const out = {
    title,
    description: cleanHtml(text(input.description, 100000, 'Mô tả')),
    category: input.category ? String(input.category) : null,
    status: input.status === 'draft' ? 'draft' : 'published',
    seo_title: optText(input.seo_title, 200, 'SEO title'),
    seo_description: optText(input.seo_description, 400, 'SEO description'),
    og_image: input.og_image ? cleanUrl(input.og_image, 'Ảnh chia sẻ') : null,
  };

  // Ảnh
  const imgs = [...new Set((Array.isArray(input.images) ? input.images : []).map((u) => cleanUrl(u)))];
  if (imgs.length > 40) bad('Tối đa 40 ảnh mỗi sản phẩm');
  out.images = imgs;

  // Tùy chọn (màu, size...). Giữ nguyên "v" của giá trị cũ để key giỏ hàng không đổi.
  const rawOpts = Array.isArray(input.options) ? input.options : [];
  if (rawOpts.length > 3) bad('Tối đa 3 nhóm tùy chọn');
  const oldOpts = existing ? existing.options : [];
  const options = rawOpts.map((o, gi) => {
    const name = text(o.name, 40, 'Tên nhóm tùy chọn', { required: true });
    const old = (oldOpts[gi] && oldOpts[gi].values) || [];
    const seen = new Set();
    const taken = new Set();
    const values = [];
    for (const raw of Array.isArray(o.values) ? o.values : []) {
      const t = text(raw, 80, `Giá trị của "${name}"`);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      values.push({ t, v: (old.find((x) => x.t === t) || {}).v });
    }
    if (!values.length) bad(`Nhóm "${name}" cần ít nhất 1 giá trị`);
    if (values.length > 100) bad(`Nhóm "${name}" có quá nhiều giá trị (tối đa 100)`);
    values.forEach((x) => x.v && taken.add(x.v));
    values.forEach((x, i) => {
      if (x.v) return;
      const base = slugify(x.t) || `opt-${i + 1}`;
      let v = base;
      for (let n = 1; taken.has(v); n++) v = `${base}-${n}`;
      taken.add(v);
      x.v = v;
    });
    return { name, values: values.map(({ v, t }) => ({ v, t })) };
  });
  out.options = options;

  // Biến thể: tạo đủ tổ hợp các tùy chọn. Giữ các tổ hợp đã có; chỉ thêm tổ hợp mới nếu nó chứa giá trị mới.
  const defPrice = money2(input.price, 'Giá bán');
  const defCompare = money2(input.compareAt, 'Giá gốc', { allowNull: true });
  const defSku = text(input.sku, 60, 'SKU');
  const given = new Map();
  for (const v of Array.isArray(input.variants) ? input.variants : []) {
    given.set((v.opts || []).map((x) => String(x).trim()).join('\u0001'), v);
  }
  const oldByCombo = new Map();
  (existing ? existing.variants : []).forEach((v) =>
    oldByCombo.set([v.option1, v.option2, v.option3].filter((x) => x != null).join('\u0001'), v)
  );
  const oldValueSet = oldOpts.map((g) => new Set((g.values || []).map((x) => x.v)));

  let combos = [[]];
  for (const g of options) combos = combos.flatMap((c) => g.values.map((val) => [...c, val]));
  if (combos.length > MAX_VARIANTS) bad(`Quá nhiều biến thể (${combos.length}). Tối đa ${MAX_VARIANTS}.`);

  const variants = [];
  for (const combo of combos) {
    const vals = combo.map((x) => x.v);
    const key = vals.join('\u0001');
    const old = oldByCombo.get(key);
    const isNew = !old && (!existing || options.length === 0 || existing.options.length === 0 || combo.some((x, gi) => !(oldValueSet[gi] && oldValueSet[gi].has(x.v))));
    if (existing && existing.variants.length && !old && !isNew) continue; // tổ hợp cũ đã bị bỏ trước đó: giữ nguyên là không bán
    const g = given.get(combo.map((x) => x.t).join('\u0001')) || {};
    const label = options.length ? combo.map((x) => x.t).join(' / ') : 'Default Title';
    const o = options.length ? vals : ['Default Title'];
    variants.push({
      key: (old && old.key) || `${slug}::${o.join(' / ')}`,
      label,
      option1: o[0] ?? null,
      option2: o[1] ?? null,
      option3: o[2] ?? null,
      price: g.price !== undefined && g.price !== '' ? money2(g.price, `Giá của ${label}`) : defPrice,
      compareAt: g.compareAt !== undefined ? money2(g.compareAt, `Giá gốc của ${label}`, { allowNull: true }) : defCompare,
      sku: g.sku !== undefined ? text(g.sku, 60, 'SKU') : defSku,
      image: g.image ? cleanUrl(g.image) : null,
    });
  }
  if (!variants.length) bad('Sản phẩm cần ít nhất 1 biến thể');
  out.variants = variants;
  return out;
}

/** Chuyển sản phẩm đã lưu -> dạng editor. */
export function storedToEditor(p) {
  const textOf = (gi, v) => {
    const g = p.options[gi];
    const f = g && g.values.find((x) => x.v === v);
    return f ? f.t : v;
  };
  const first = p.variants[0] || {};
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    category: p.category,
    status: p.status,
    images: p.images,
    options: p.options.map((g) => ({ name: g.name, values: g.values.map((x) => x.t) })),
    price: first.price ?? 0,
    compareAt: first.compareAt ?? null,
    sku: first.sku || '',
    variants: p.variants.map((v) => ({
      opts: p.options.map((_, gi) => textOf(gi, v['option' + (gi + 1)])),
      price: v.price,
      compareAt: v.compareAt,
      sku: v.sku || '',
      image: v.image || null,
    })),
    seo_title: p.seo_title,
    seo_description: p.seo_description,
    og_image: p.og_image,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** Dòng gọn cho danh sách trong Admin. */
export function adminRow(p) {
  const prices = p.variants.map((v) => v.price);
  const v0 = p.variants[0] || {};
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    category: p.category,
    status: p.status,
    image: p.images[0] ? sized(p.images[0], 120) : null,
    price: prices.length ? Math.min(...prices) : 0,
    compareAt: v0.compareAt ?? null,
    variants: p.variants.length,
    updated_at: p.updated_at,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. XÁC THỰC CLOUDFLARE ACCESS
// ═════════════════════════════════════════════════════════════════════════════
// Cần 2 biến môi trường (Pages > Settings > Variables):
//   ACCESS_TEAM_DOMAIN  vd  tenban.cloudflareaccess.com
//   ACCESS_AUD          "Application Audience (AUD) Tag" của ứng dụng Access
// Tùy chọn:
//   ADMIN_EMAILS        danh sách email được phép, ngăn cách bằng dấu phẩy (thêm một lớp kiểm tra)
// Chạy local: tạo file .dev.vars với DEV_AUTH_BYPASS=1 (chỉ có tác dụng khi host là localhost).
const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64urlToJSON = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

let jwksCache = { at: 0, keys: null, domain: '' };
async function getJwks(domain) {
  if (jwksCache.keys && jwksCache.domain === domain && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Không lấy được khóa Access');
  jwksCache = { at: Date.now(), keys: (await res.json()).keys, domain };
  return jwksCache.keys;
}

/** Trả về { email } nếu request hợp lệ, ngược lại null. */
export async function verifyAccess(request, env) {
  if (env.DEV_AUTH_BYPASS === '1' && new URL(request.url).hostname === 'localhost') {
    return { email: 'dev@localhost' };
  }
  const domain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!domain || !aud) return null; // chưa cấu hình -> từ chối tất cả (an toàn mặc định)
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    const [h, p, s] = token.split('.');
    const header = b64urlToJSON(h);
    const payload = b64urlToJSON(p);
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256') return null;
    if (payload.iss !== `https://${domain}`) return null;
    if (![].concat(payload.aud || []).includes(aud)) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    const jwk = (await getJwks(domain)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const email = String(payload.email || '').toLowerCase();
    if (env.ADMIN_EMAILS) {
      const allowed = env.ADMIN_EMAILS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(email)) return null;
    }
    return { email };
  } catch {
    return null;
  }
}
