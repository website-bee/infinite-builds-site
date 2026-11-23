// Trang quản trị: một file, chia 6 phần.
//   1. Tiện ích   2. Gọi API   3. Danh sách sản phẩm   4. Trang sửa sản phẩm   5. Danh mục   6. Điều hướng
(function () {
  'use strict';

  // ═══ 1. TIỆN ÍCH ═══════════════════════════════════════════════════════════
  const app = document.getElementById('app');

  /** Tạo phần tử DOM: h('div', {class:'x', onclick: fn}, 'chữ', phầnTửCon...) — luôn dùng textContent nên không bị chèn HTML. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const slugify = (t) =>
    String(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function toast(msg, isErr) {
    const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), isErr ? 7000 : 3000);
  }

  /** Làm sạch HTML trước khi đưa vào ô soạn thảo: bỏ script, iframe, on...=, javascript:. */
  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<body>' + html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,style,link,meta').forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
    });
    return doc.body.innerHTML;
  }

  // ═══ 2. GỌI API ═══════════════════════════════════════════════════════════
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/admin' + path, {
      method,
      headers: { 'X-Admin-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* không phải JSON */ }
    if (res.status === 401) { location.href = '/admin/login'; throw new Error('Cần đăng nhập lại…'); }
    if (!res.ok) throw new Error((data && data.error) || 'Lỗi ' + res.status);
    return data;
  }

  const MAX_SIDE = 1600;
  const MAX_BYTES = 1200 * 1024;
  /** Thu nhỏ + nén ảnh trong trình duyệt (WebP) cho vừa giới hạn lưu trữ. */
  async function compress(file) {
    const bmp = await createImageBitmap(file);
    let side = MAX_SIDE;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const q = [0.88, 0.8, 0.72, 0.64, 0.56, 0.5][attempt];
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
      if (blob && blob.size <= MAX_BYTES) return blob;
      side = Math.round(side * 0.85);
    }
    throw new Error('Không nén được ảnh xuống dưới 1.2MB: ' + file.name);
  }
  async function uploadImage(file) {
    const blob = await compress(file);
    const fd = new FormData();
    fd.set('file', blob, 'image.webp');
    const res = await fetch('/api/admin/upload', { method: 'POST', headers: { 'X-Admin-Request': '1' }, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload lỗi ' + res.status);
    return data.url;
  }

  // ═══ 3. DANH SÁCH SẢN PHẨM ════════════════════════════════════════════════
  const list = { products: [], categories: [], tab: 'all', q: '', cat: '' };

  async function viewList() {
    app.replaceChildren(h('p', { class: 'muted pad' }, 'Đang tải…'));
    const d = await api('/products');
    list.products = d.products;
    list.categories = d.categories;
    drawList();
  }

  function drawList() {
    const catName = Object.fromEntries(list.categories.map((c) => [c.slug, c.name]));
    const n = { all: list.products.length, published: 0, draft: 0 };
    list.products.forEach((p) => n[p.status]++);
    const tab = (key, label) => h('button', { class: 'tab' + (list.tab === key ? ' active' : ''), onclick: () => { list.tab = key; drawList(); } }, `${label} (${n[key]})`);
    const search = h('input', { type: 'text', placeholder: 'Tìm theo tên…', value: list.q, oninput: (e) => { list.q = e.target.value; drawRows(); } });
    const catSel = h('select', { onchange: (e) => { list.cat = e.target.value; drawRows(); } },
      h('option', { value: '' }, 'Tất cả danh mục'),
      h('option', { value: '-', selected: list.cat === '-' }, '(Không danh mục)'),
      list.categories.map((c) => h('option', { value: c.slug, selected: list.cat === c.slug }, c.name)));
    const tbody = h('tbody');

    function drawRows() {
      const q2 = list.q.trim().toLowerCase();
      const r = list.products.filter(
        (p) =>
          (list.tab === 'all' || p.status === list.tab) &&
          (!list.cat || (list.cat === '-' ? !p.category : p.category === list.cat)) &&
          (!q2 || p.title.toLowerCase().includes(q2) || p.slug.includes(q2))
      );
      tbody.replaceChildren(...(r.length ? r.map(rowFor) : [h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'Không có sản phẩm nào.'))]));
    }

    function rowFor(p) {
      const sale = p.compareAt && p.compareAt > p.price;
      return h('tr', {},
        h('td', { class: 'thumb' }, p.image ? h('img', { src: p.image, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-box' })),
        h('td', {}, h('a', { class: 'title', href: '#/edit/' + p.id }, p.title), h('div', { class: 'muted small' }, p.slug)),
        h('td', {}, p.category ? catName[p.category] || p.category : h('span', { class: 'muted' }, '—')),
        h('td', {}, money(p.price), sale ? h('s', { class: 'was' }, money(p.compareAt)) : null),
        h('td', { class: 'muted nowrap' }, p.variants > 1 ? p.variants + ' biến thể' : '—'),
        h('td', {}, h('span', { class: 'badge ' + (p.status === 'published' ? 'pub' : 'draft') }, p.status === 'published' ? 'Đang bán' : 'Nháp')),
        h('td', {}, h('div', { class: 'actions' },
          h('a', { class: 'btn sm', href: '#/edit/' + p.id }, 'Sửa'),
          p.status === 'published' ? h('a', { class: 'btn sm', href: '/products/' + p.slug, target: '_blank', rel: 'noopener' }, 'Xem') : null,
          h('button', { class: 'btn sm', onclick: () => toggleStatus(p) }, p.status === 'published' ? 'Ẩn' : 'Đăng'),
          h('button', { class: 'btn sm danger', onclick: () => remove(p) }, 'Xóa'))));
    }

    async function toggleStatus(p) {
      try {
        const full = (await api('/products?id=' + p.id)).product;
        full.status = p.status === 'published' ? 'draft' : 'published';
        await api('/products?id=' + p.id, { method: 'PUT', body: full });
        toast(full.status === 'published' ? 'Đã đăng: ' + p.title : 'Đã ẩn: ' + p.title);
        viewList();
      } catch (e) { toast(e.message, true); }
    }
    async function remove(p) {
      if (!confirm(`Xóa "${p.title}"?\n\nKhông thể hoàn tác. Nếu chỉ muốn ẩn khỏi website, hãy bấm "Ẩn".`)) return;
      try {
        await api('/products?id=' + p.id, { method: 'DELETE' });
        toast('Đã xóa: ' + p.title);
        viewList();
      } catch (e) { toast(e.message, true); }
    }

    app.replaceChildren(
      h('div', { class: 'head' }, h('h1', {}, 'Sản phẩm'), h('a', { class: 'btn primary right', href: '#/new' }, '+ Thêm sản phẩm')),
      h('div', { class: 'tabs' }, tab('all', 'Tất cả'), tab('published', 'Đang bán'), tab('draft', 'Nháp')),
      h('div', { class: 'toolbar' }, search, catSel),
      h('table', {}, h('thead', {}, h('tr', {}, ['', 'Sản phẩm', 'Danh mục', 'Giá', '', 'Trạng thái', ''].map((t) => h('th', {}, t)))), tbody)
    );
    drawRows();
  }

  // ═══ 4. TRANG SỬA SẢN PHẨM ════════════════════════════════════════════════
  // Tên màu có sẵn ô tròn trên website (khớp COLOR_MAP trong functions/_lib.js)
  const PRESET_COLORS = ['White', 'Black', 'Grey', 'Dark Grey', 'Silver', 'Gold', 'Red', 'Strawberry Red', 'Orange', 'Yellow', 'Green', 'Matte Green', 'Olive Green', 'Matcha Green', 'Morandi Green', 'Blue', 'Brown', 'Beige', 'Pink', 'Morandi Purple', 'Lilac Purple', 'Wood', 'Clear Acrylic', 'Barbie - Pink', 'Barbie - Black'];
  const SWATCH = { white: '#f6f6f3', black: '#1f2120', grey: '#8a8a8a', 'dark grey': '#3d4559', silver: '#c0c0c8', gold: '#d6bf72', red: '#ee3b2c', 'strawberry red': '#e0505f', orange: '#d9481f', yellow: '#dbe78f', green: '#3f8f4e', 'matte green': '#7fbf98', 'olive green': '#6b7340', 'matcha green': '#7cbf45', 'morandi green': '#2f6b72', blue: '#8fc6dc', brown: '#8c7064', beige: '#c5b5a6', pink: '#e8a7b8', 'morandi purple': '#c4848a', 'lilac purple': '#d9bfe3', wood: '#b98a5a', 'clear acrylic': '#e6f0f4', 'barbie - pink': '#ec5fa4', 'barbie - black': '#1f2120' };

  const combos = (options) => {
    let c = [[]];
    for (const g of options) {
      if (!g.values.length) return [];
      c = c.flatMap((x) => g.values.map((v) => [...x, v]));
    }
    return c;
  };

  async function viewEditor(id) {
    app.replaceChildren(h('p', { class: 'muted pad' }, 'Đang tải…'));
    const categories = (await api('/categories')).categories;
    let P;
    if (id) P = (await api('/products?id=' + id)).product;
    else P = { title: '', description: '', category: null, status: 'draft', images: [], options: [], price: '', compareAt: '', sku: '', variants: [{ opts: [], price: '', compareAt: '', sku: '', image: null }], seo_title: '', seo_description: '', og_image: '' };
    P.seo_title = P.seo_title || '';
    P.seo_description = P.seo_description || '';
    P.og_image = P.og_image || '';
    P.compareAt = P.compareAt == null ? '' : P.compareAt;
    let slug = P.slug || '';
    let slugTouched = false;
    let dirty = false;
    const touch = () => { dirty = true; window.onbeforeunload = () => 'Có thay đổi chưa lưu.'; };

    const root = h('div');
    const imagesBox = h('div', { class: 'photos' });
    const optionsBox = h('div');
    const variantsBox = h('div', { style: 'margin-top:18px' });
    const rowRefs = [];
    const saveBtn = h('button', { class: 'btn primary', onclick: save }, 'Lưu');
    const msg = h('span', { class: 'msg' });

    // ── Ảnh
    let dragFrom = null;
    function drawImages() {
      const items = P.images.map((u, i) =>
        h('div', {
          class: 'photo' + (i === 0 ? ' main' : ''), draggable: 'true',
          ondragstart: () => { dragFrom = i; },
          ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
          ondragleave: (e) => e.currentTarget.classList.remove('over'),
          ondrop: (e) => {
            e.preventDefault();
            if (dragFrom == null || dragFrom === i) return;
            const [m] = P.images.splice(dragFrom, 1);
            P.images.splice(i, 0, m);
            dragFrom = null; touch(); drawImages(); drawVariants();
          },
        },
          h('img', { src: u, alt: '' }),
          i === 0 ? h('span', { class: 'tag' }, 'Ảnh chính') : null,
          h('button', { type: 'button', title: 'Xóa ảnh', onclick: () => { P.images.splice(i, 1); touch(); drawImages(); drawVariants(); } }, '×')));
      const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addFiles([...e.target.files]) });
      const drop = h('div', { class: 'drop', onclick: () => fileInput.click(),
        ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); } },
        '+ Thêm ảnh', h('br'), '(bấm hoặc kéo thả)');
      imagesBox.replaceChildren(...items, drop, fileInput);
      fillOg();
    }
    async function addFiles(files) {
      files = files.filter((f) => f.type.startsWith('image/'));
      for (const f of files) {
        const ph = h('div', { class: 'photo loading' }, 'Đang tải…');
        imagesBox.insertBefore(ph, imagesBox.querySelector('.drop'));
        try { P.images.push(await uploadImage(f)); touch(); } catch (e) { toast(e.message, true); }
        ph.remove();
      }
      drawImages(); drawVariants();
    }
    function addImageByUrl() {
      const u = prompt('Dán link ảnh (bắt đầu bằng https://):');
      if (!u) return;
      if (!/^https:\/\/[^\s"'<>]+$/.test(u.trim())) return toast('Link không hợp lệ', true);
      P.images.push(u.trim()); touch(); drawImages(); drawVariants();
    }

    // ── Mô tả (soạn thảo đơn giản + chế độ HTML)
    document.execCommand && document.execCommand('defaultParagraphSeparator', false, 'p');
    const rte = h('div', { class: 'rte', contenteditable: 'true', oninput: touch });
    rte.innerHTML = sanitize(P.description);
    const html = h('textarea', { hidden: true, oninput: touch });
    const cmd = (c, v) => h('button', { type: 'button', onmousedown: (e) => { e.preventDefault(); document.execCommand(c, false, v); touch(); } });
    const mk = (label, c, v) => { const b = cmd(c, v); b.textContent = label; return b; };
    const linkBtn = h('button', { type: 'button', onmousedown: (e) => { e.preventDefault(); const u = prompt('Link (https://…):'); if (u && /^(https?:|\/|mailto:)/.test(u)) document.execCommand('createLink', false, u); } }, 'Link');
    const modeBox = h('input', { type: 'checkbox', onchange: () => {
      if (modeBox.checked) { html.value = rte.innerHTML; rte.hidden = true; html.hidden = false; }
      else { rte.innerHTML = sanitize(html.value); rte.hidden = false; html.hidden = true; }
    } });
    const getDescription = () => (modeBox.checked ? html.value : rte.innerHTML);

    // ── Tùy chọn / biến thể
    function syncRows() {
      const old = new Map(P.variants.map((v) => [v.opts.join('\u0001'), v]));
      P.variants = combos(P.options).map((o) => old.get(o.join('\u0001')) || { opts: o, price: '', compareAt: '', sku: '', image: null });
    }
    function drawOptions() {
      const groups = P.options.map((g, gi) => {
        const nameIn = h('input', { type: 'text', placeholder: 'Tên nhóm, ví dụ: Color, Size', value: g.name, oninput: (e) => { g.name = e.target.value; touch(); } });
        const valIn = h('input', { type: 'text', placeholder: 'Nhập giá trị rồi bấm Enter (có thể dán nhiều, ngăn cách bằng dấu phẩy)' });
        const add = (txt) => {
          let added = false;
          for (const t of txt.split(',').map((x) => x.trim()).filter(Boolean)) {
            if (!g.values.some((v) => v.toLowerCase() === t.toLowerCase())) { g.values.push(t); added = true; }
          }
          if (added) { touch(); syncRows(); drawOptions(); drawVariants(); }
        };
        valIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(valIn.value); } });
        valIn.addEventListener('blur', () => { if (valIn.value.trim()) add(valIn.value); });
        const isColor = /colou?r/i.test(g.name);
        return h('div', { class: 'group' },
          h('div', { class: 'top' }, nameIn, h('button', { type: 'button', class: 'btn sm danger', onclick: () => { P.options.splice(gi, 1); touch(); syncRows(); drawOptions(); drawVariants(); } }, 'Xóa nhóm')),
          h('div', { class: 'chips' }, g.values.map((v, vi) =>
            h('span', { class: 'chip' }, isColor && SWATCH[v.toLowerCase()] ? h('i', { class: 'sw', style: 'background:' + SWATCH[v.toLowerCase()] }) : null, v,
              h('button', { type: 'button', title: 'Xóa', onclick: () => { g.values.splice(vi, 1); touch(); syncRows(); drawOptions(); drawVariants(); } }, '×')))),
          valIn,
          isColor ? h('div', { class: 'presets' }, h('span', { class: 'muted small' }, 'Màu có ô tròn trên website:'),
            PRESET_COLORS.filter((c) => !g.values.some((v) => v.toLowerCase() === c.toLowerCase())).map((c) => h('button', { type: 'button', onclick: () => add(c) }, '+ ' + c))) : null);
      });
      const addGroup = P.options.length < 3
        ? h('button', { type: 'button', class: 'btn sm', onclick: () => { P.options.push({ name: P.options.length ? '' : 'Color', values: [] }); touch(); drawOptions(); } }, '+ Thêm nhóm tùy chọn (màu sắc, kích cỡ…)')
        : null;
      optionsBox.replaceChildren(...groups, addGroup);
    }
    function drawVariants() {
      if (P.options.length === 0 || P.variants.length <= 1) { variantsBox.replaceChildren(); return; }
      const imgSel = (r) => h('select', { onchange: (e) => { r.image = e.target.value || null; touch(); } },
        h('option', { value: '' }, 'Ảnh chính'),
        P.images.map((u, i) => h('option', { value: u, selected: r.image === u }, 'Ảnh ' + (i + 1))));
      const num = (r, k, ph) => h('input', { type: 'number', step: '0.01', min: '0', placeholder: ph, value: r[k] == null ? '' : r[k], oninput: (e) => { r[k] = e.target.value === '' ? '' : Number(e.target.value); touch(); } });
      rowRefs.length = 0;
      const tr = (r) => {
        const ref = { r, price: num(r, 'price', 'giá chung'), compareAt: num(r, 'compareAt', 'giá chung'),
          sku: h('input', { type: 'text', value: r.sku || '', oninput: (e) => { r.sku = e.target.value; touch(); } }) };
        rowRefs.push(ref);
        return h('tr', {}, h('td', {}, r.opts.join(' / ')), h('td', {}, ref.price), h('td', {}, ref.compareAt), h('td', {}, ref.sku), h('td', {}, imgSel(r)));
      };
      variantsBox.replaceChildren(
        h('h2', {}, `Giá riêng từng biến thể (${P.variants.length})`),
        h('p', { class: 'muted small' }, 'Ô nào để trống sẽ lấy giá chung ở bên phải. Đổi giá chung sẽ ghi đè tất cả các dòng này.'),
        h('div', { class: 'tablewrap' }, h('table', { class: 'vtable' },
          h('thead', {}, h('tr', {}, ['Biến thể', 'Giá bán', 'Giá gốc', 'SKU', 'Ảnh'].map((t) => h('th', {}, t)))),
          h('tbody', {}, P.variants.map(tr)))));
    }
    /** Đẩy giá trị trong P.variants vào các ô đang hiện — KHÔNG vẽ lại bảng (vẽ lại làm mất ô người dùng đang bấm vào). */
    function refreshRows() {
      rowRefs.forEach(({ r, price, compareAt, sku }) => {
        price.value = r.price == null ? '' : r.price;
        compareAt.value = r.compareAt == null ? '' : r.compareAt;
        sku.value = r.sku || '';
      });
    }
    // giá chung -> áp cho mọi biến thể
    function applyDefault(key, value) {
      const distinct = new Set(P.variants.map((v) => v[key]));
      if (P.variants.length > 1 && distinct.size > 1 && !confirm('Các biến thể đang có giá khác nhau. Áp giá này cho TẤT CẢ biến thể?')) return false;
      P.variants.forEach((v) => { v[key] = value; });
      return true;
    }
    function defaultField(label, key, opts) {
      const inp = h('input', { type: opts.type || 'text', step: '0.01', min: '0', value: P[key] == null ? '' : P[key], placeholder: opts.ph || '' });
      inp.addEventListener('change', () => {
        const v = opts.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        if (applyDefault(key, v)) { P[key] = v; touch(); refreshRows(); drawDiscount(); }
        else inp.value = P[key] == null ? '' : P[key];
      });
      return h('label', { class: 'field' }, h('span', {}, label), inp, opts.hint ? h('small', {}, opts.hint) : null);
    }
    const discount = h('p', { class: 'small', style: 'margin:-6px 0 12px' });
    function drawDiscount() {
      const p = Number(P.price), c = Number(P.compareAt);
      discount.textContent = P.compareAt !== '' && c > p && p >= 0 ? `Đang giảm ${Math.round((1 - p / c) * 100)}% — website hiện nhãn "Sale".` : '';
    }

    // ── Lưu
    async function save() {
      if (!P.title.trim()) return toast('Chưa nhập tên sản phẩm', true);
      if (P.price === '' || isNaN(Number(P.price))) return toast('Chưa nhập giá bán', true);
      if (P.options.some((g) => !g.name.trim() || !g.values.length)) return toast('Mỗi nhóm tùy chọn cần có tên và ít nhất 1 giá trị', true);
      saveBtn.disabled = true; msg.textContent = 'Đang lưu…';
      const body = {
        slug, title: P.title, description: getDescription(), category: P.category || null, status: P.status,
        images: P.images, options: P.options, price: P.price, compareAt: P.compareAt === '' ? null : P.compareAt, sku: P.sku || '',
        variants: P.variants.map((r) => ({ opts: r.opts, price: r.price === '' ? undefined : r.price, compareAt: r.compareAt === '' ? null : r.compareAt, sku: r.sku || '', image: r.image })),
        seo_title: P.seo_title || null, seo_description: P.seo_description || null, og_image: P.og_image || null,
      };
      try {
        if (id) await api('/products?id=' + id, { method: 'PUT', body });
        else id = (await api('/products', { method: 'POST', body })).id;
        dirty = false; window.onbeforeunload = null;
        toast(P.status === 'published' ? 'Đã lưu — website đã cập nhật.' : 'Đã lưu bản nháp.');
        msg.textContent = '';
        if (location.hash === '#/new') location.hash = '#/edit/' + id; else viewEditor(id);
      } catch (e) { toast(e.message, true); msg.textContent = ''; }
      saveBtn.disabled = false;
    }

    // ── Ghép giao diện
    const slugIn = h('input', { type: 'text', value: slug, disabled: !!id, placeholder: 'tu-dong-tao-tu-ten', oninput: (e) => { slug = e.target.value; slugTouched = true; touch(); } });
    const titleIn = h('input', { type: 'text', value: P.title, placeholder: 'Ví dụ: Mini Planter Pumpkin', oninput: (e) => {
      P.title = e.target.value; touch();
      if (!id && !slugTouched) { slug = slugify(P.title); slugIn.value = slug; }
    } });
    const statusSel = h('select', { onchange: (e) => { P.status = e.target.value; touch(); } },
      h('option', { value: 'published', selected: P.status === 'published' }, 'Đang bán (hiện trên website)'),
      h('option', { value: 'draft', selected: P.status === 'draft' }, 'Nháp (ẩn)'));
    const catSel = h('select', { onchange: (e) => { P.category = e.target.value || null; touch(); } },
      h('option', { value: '' }, '— Không danh mục —'),
      categories.map((c) => h('option', { value: c.slug, selected: P.category === c.slug }, c.name)));
    const ogSel = h('select', { onchange: (e) => { P.og_image = e.target.value; touch(); } });
    const seoCount = (el, max) => { const s = h('small', {}); const f = () => { s.textContent = el.value.length + '/' + max; }; el.addEventListener('input', f); f(); return s; };
    const seoT = h('input', { type: 'text', value: P.seo_title, placeholder: P.title ? P.title + ' — Infinite Builds Studio' : 'Để trống = tự lấy từ tên sản phẩm', oninput: (e) => { P.seo_title = e.target.value; touch(); } });
    const seoD = h('textarea', { style: 'min-height:70px;font-family:inherit;font-size:inherit', placeholder: 'Để trống = dùng mô tả mặc định của website', oninput: (e) => { P.seo_description = e.target.value; touch(); } });
    seoD.value = P.seo_description;

    root.append(
      h('div', { class: 'head' }, h('a', { href: '#/' }, '← Sản phẩm'), h('h1', {}, id ? 'Sửa sản phẩm' : 'Thêm sản phẩm')),
      h('div', { class: 'editor' },
        h('div', {},
          h('div', { class: 'card' }, h('h2', {}, 'Ảnh'), imagesBox,
            h('p', { class: 'muted small' }, 'Kéo thả để đổi thứ tự — ảnh đầu tiên là ảnh chính. Ảnh được tự nén trước khi tải lên. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); addImageByUrl(); } }, 'Thêm bằng link ảnh'))),
          h('div', { class: 'card' },
            h('label', { class: 'field' }, h('span', {}, 'Tên sản phẩm'), titleIn),
            h('div', {}, h('div', { class: 'field' }, h('span', { style: 'display:block;font-weight:600;margin-bottom:4px' }, 'Mô tả')),
              h('div', { class: 'rte-bar' }, mk('B', 'bold'), mk('I', 'italic'), mk('• Danh sách', 'insertUnorderedList'), linkBtn, mk('Xóa định dạng', 'removeFormat'), h('label', {}, modeBox, ' Sửa HTML')),
              rte, html)),
          h('div', { class: 'card' }, h('h2', {}, 'Tùy chọn (màu sắc, kích cỡ…)'),
            h('p', { class: 'muted small' }, 'Khách sẽ chọn trên trang sản phẩm. Để trống nếu sản phẩm chỉ có một loại.'), optionsBox, variantsBox),
          h('div', { class: 'card' }, h('h2', {}, 'SEO (hiện trên Google)'),
            h('label', { class: 'field' }, h('span', {}, 'Tiêu đề trang'), seoT, seoCount(seoT, 70)),
            h('label', { class: 'field' }, h('span', {}, 'Mô tả ngắn'), seoD, seoCount(seoD, 160)),
            h('label', { class: 'field' }, h('span', {}, 'Ảnh khi chia sẻ (Facebook, Zalo…)'), ogSel, h('small', {}, 'Để trống = logo cửa hàng.')))),
        h('div', { class: 'side' },
          h('div', { class: 'card' }, h('h2', {}, 'Đăng bán'),
            h('label', { class: 'field' }, h('span', {}, 'Trạng thái'), statusSel),
            h('label', { class: 'field' }, h('span', {}, 'Danh mục'), catSel),
            h('label', { class: 'field' }, h('span', {}, 'Đường dẫn (slug)'), slugIn,
              h('small', {}, id ? 'Không đổi được để link cũ và giỏ hàng không hỏng.' : 'Tạo tự động từ tên; sau khi lưu sẽ không đổi được.')),
            id && P.status === 'published' ? h('a', { class: 'btn sm', href: '/products/' + slug, target: '_blank', rel: 'noopener' }, 'Xem trên website ↗') : null),
          h('div', { class: 'card' }, h('h2', {}, 'Giá'),
            defaultField('Giá bán (USD)', 'price', { type: 'number', ph: '0.00' }),
            defaultField('Giá gốc — gạch ngang (USD)', 'compareAt', { type: 'number', ph: 'Để trống nếu không giảm giá', hint: 'Giá gốc cao hơn giá bán → website hiện nhãn "Sale %".' }),
            discount,
            defaultField('SKU', 'sku', { type: 'text' })))),
      h('div', { class: 'savebar' }, saveBtn, h('a', { class: 'btn', href: '#/' }, 'Hủy'), msg)
    );

    // ảnh chia sẻ: danh sách chọn theo ảnh hiện có (hàm này được drawImages gọi mỗi khi ảnh đổi)
    function fillOg() {
      ogSel.replaceChildren(h('option', { value: '' }, '— Logo cửa hàng —'), P.images.map((u, i) => h('option', { value: u, selected: P.og_image === u }, 'Ảnh ' + (i + 1))));
      if (P.og_image && !P.images.includes(P.og_image)) ogSel.append(h('option', { value: P.og_image, selected: true }, 'Ảnh đang dùng'));
    }
    app.replaceChildren(root);
    drawImages(); drawOptions(); drawVariants(); drawDiscount();
    dirty = false; window.onbeforeunload = null;
  }
  // ═══ 5. DANH MỤC ══════════════════════════════════════════════════════════
  async function viewCategories() {
    app.replaceChildren(h('p', { class: 'muted pad' }, 'Đang tải…'));
    const [{ categories }, { products }] = await Promise.all([api('/categories'), api('/products')]);
    const count = {};
    products.forEach((p) => { if (p.category) count[p.category] = (count[p.category] || 0) + 1; });

    const nameIn = h('input', { type: 'text', placeholder: 'Tên danh mục mới, ví dụ: Mini Planters' });
    const imgIn = h('input', { type: 'url', placeholder: 'Link ảnh đại diện (https://…) — không bắt buộc' });
    const addBtn = h('button', { class: 'btn primary', onclick: async () => {
      try { await api('/categories', { method: 'POST', body: { name: nameIn.value, image: imgIn.value || null } }); toast('Đã thêm danh mục'); viewCategories(); }
      catch (e) { toast(e.message, true); }
    } }, 'Thêm');

    const rows = categories.map((c) => {
      const n = h('input', { type: 'text', value: c.name });
      const im = h('input', { type: 'url', value: c.image || '', placeholder: 'https://…' });
      return h('tr', {},
        h('td', {}, c.image ? h('img', { src: c.image, alt: '', style: 'width:44px;height:44px;object-fit:cover;border-radius:8px' }) : null),
        h('td', {}, n, h('div', { class: 'muted small' }, '/collections/' + c.slug)),
        h('td', {}, im),
        h('td', { class: 'muted' }, (count[c.slug] || 0) + ' sản phẩm'),
        h('td', {}, h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: async () => { try { await api('/categories?slug=' + c.slug, { method: 'PUT', body: { name: n.value, image: im.value || null } }); toast('Đã lưu'); viewCategories(); } catch (e) { toast(e.message, true); } } }, 'Lưu'),
          h('button', { class: 'btn sm danger', onclick: async () => {
            if (!confirm(`Xóa danh mục "${c.name}"?\n${count[c.slug] || 0} sản phẩm bên trong sẽ chuyển thành "không danh mục" (không bị xóa).`)) return;
            try { await api('/categories?slug=' + c.slug, { method: 'DELETE' }); toast('Đã xóa danh mục'); viewCategories(); } catch (e) { toast(e.message, true); }
          } }, 'Xóa'))));
    });
    app.replaceChildren(
      h('div', { class: 'head' }, h('h1', {}, 'Danh mục')),
      h('div', { class: 'card' }, h('h2', {}, 'Thêm danh mục'), h('div', { class: 'row' }, nameIn, imgIn, h('div', { style: 'flex:0 0 auto' }, addBtn)),
        h('p', { class: 'muted small' }, 'Đường dẫn tạo tự động từ tên và không đổi sau khi tạo. Danh mục mới tự xuất hiện trong menu của các trang sản phẩm, danh mục và blog.')),
      h('table', {}, h('thead', {}, h('tr', {}, ['', 'Tên', 'Ảnh đại diện', 'Số lượng', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
    );
  }

  // ═══ 6. ĐIỀU HƯỚNG ════════════════════════════════════════════════════════
  async function route() {
    window.onbeforeunload = null;
    const hash = location.hash.replace(/^#/, '') || '/';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (a.dataset.nav === 'categories') === (hash === '/categories')));
    try {
      let m;
      if (hash === '/categories') await viewCategories();
      else if (hash === '/new') await viewEditor(null);
      else if ((m = hash.match(/^\/edit\/(\d+)$/))) await viewEditor(Number(m[1]));
      else await viewList();
    } catch (e) {
      app.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Có lỗi'), h('p', {}, e.message), h('button', { class: 'btn', onclick: route }, 'Thử lại')));
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
