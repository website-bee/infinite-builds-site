#!/usr/bin/env python3 -I
"""
Đọc HTML cũ (products / collections / blog) -> db/seed.sql

Chạy:   python3 -I scripts/migrate.py
Đọc từ: legacy/  (bản gốc, không bao giờ bị sửa)
Ghi ra: db/seed.sql

Quy ước:
- Slug, tiêu đề, mô tả, giá, màu, SKU, URL ảnh Shopify CDN được giữ NGUYÊN.
- URL ảnh lưu dạng "gốc" (đã bỏ &width=N). Trang web tự gắn lại đúng width khi hiển thị.
- SEO: nếu trùng giá trị mặc định của site thì lưu NULL (= dùng mặc định).
- Dùng INSERT OR IGNORE: chạy lại seed không ghi đè dữ liệu bạn đã sửa trong Admin.
"""
import glob
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "legacy")
OUT = os.path.join(ROOT, "db", "seed.sql")

SITE = "Infinite Builds Studio"
DEFAULT_DESC = "Infinite Builds Studio — 3D printed & laser-cut dollhouse miniatures, Smiski & Sonny Angel display shelves."
LOGO = "https://cdn.shopify.com/s/files/1/0962/4138/5545/files/Infi_Logo_from_Material_Shopify.png?height=112"

problems = []


def read(path):
    with open(path, encoding="utf8") as f:
        return f.read()


def un(s):
    return html.unescape(s)


def strip_w(url):
    """Bỏ tham số width=N khỏi URL ảnh Shopify."""
    if url is None:
        return None
    u = re.sub(r"[?&]width=\d+$", "", url)
    return u


def q(v):
    """Giá trị SQL."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def one(pattern, s, flags=0, what=""):
    m = re.search(pattern, s, flags)
    if not m:
        problems.append(f"không tìm thấy {what or pattern}")
        return None
    return m.group(1)


def meta(s, attr, name):
    m = re.search(r'<meta %s="%s" content="([^"]*)"' % (attr, name), s)
    return un(m.group(1)) if m else None


# ---------------------------------------------------------------- collections
def read_collection_order():
    """slug -> danh sách slug sản phẩm theo đúng thứ tự trang cũ."""
    order = {}
    for f in glob.glob(os.path.join(SRC, "collections", "*.html")):
        name = os.path.basename(f)[:-5]
        order[name] = re.findall(r'<a class="card" href="products/([^"]+)"', read(f))
    return order


def read_categories():
    s = read(os.path.join(SRC, "collections", "index.html"))
    cats = []
    for m in re.finditer(
        r'<a class="tile" href="collections/([^"]+)".*?<img src="([^"]*)" alt="([^"]*)"', s, re.S
    ):
        cats.append({"slug": m.group(1), "image": strip_w(un(m.group(2))), "name": un(m.group(3))})
    return cats


# ------------------------------------------------------------------- products
def parse_product(path, slug):
    s = read(path)
    p = {"slug": slug}
    p["title"] = un(one(r'<h1 data-astro-cid-2or5hpsh>(.*?)</h1>', s, re.S, f"{slug}: h1"))

    # mô tả: nằm giữa <div class="desc"> và đúng 2 thẻ đóng + </section>
    m = re.search(r'<div class="desc"[^>]*>(.*?)</div> </div> </section>', s, re.S)
    if not m:
        problems.append(f"{slug}: không thấy .desc")
    p["description"] = m.group(1) if m else ""

    # danh mục từ breadcrumb
    crumb = one(r'(<nav class="wrap crumbs".*?</nav>)', s, re.S, f"{slug}: breadcrumb") or ""
    cm = re.search(r'href="collections/([^"]+)"', crumb)
    p["category"] = cm.group(1) if cm and cm.group(1) != "all" else None

    # ảnh: thumb data-src (width=1000)
    imgs = [strip_w(un(u)) for u in re.findall(r'<button class="thumb" data-src="([^"]*)"', s)]
    main = re.search(r'id="main-image" src="([^"]*)"', s)
    if not imgs and main:
        imgs = [strip_w(un(main.group(1)))]
    if main and imgs and strip_w(un(main.group(1))) != imgs[0]:
        problems.append(f"{slug}: ảnh chính khác thumb đầu tiên")
    p["images"] = imgs

    # tùy chọn (màu, size...)
    options = []
    for g in re.finditer(
        r'<div class="option-group"[^>]*> <label[^>]*>(.*?)</label> <select class="option-select"[^>]*> (.*?) </select>',
        s,
        re.S,
    ):
        vals = [
            {"v": un(v), "t": un(t)}
            for v, t in re.findall(r'<option value="([^"]*)"[^>]*>([^<]*)</option>', g.group(2))
        ]
        options.append({"name": un(g.group(1)), "values": vals})
    p["options"] = options

    # biến thể: lấy nguyên từ JSON cũ, bỏ cartImage (tự tính lại)
    vj = one(r'<script type="application/json" id="variants-json">(.*?)</script>', s, re.S, f"{slug}: variants-json")
    variants = []
    for v in json.loads(vj or "[]"):
        variants.append(
            {
                "key": v["key"],
                "label": v["label"],
                "option1": v["option1"],
                "option2": v["option2"],
                "option3": v["option3"],
                "price": v["price"],
                "compareAt": v["compareAt"],
                "sku": v["sku"],
                "image": strip_w(v["image"]),
            }
        )
    p["variants"] = variants

    # SEO
    t = re.search(r"<title>(.*?)</title>", s, re.S)
    title_tag = un(t.group(1)) if t else None
    p["seo_title"] = None if title_tag == f"{p['title']} — {SITE}" else title_tag
    d = meta(s, "name", "description")
    p["seo_description"] = None if d == DEFAULT_DESC else d
    og = meta(s, "property", "og:image")
    p["og_image"] = None if og == LOGO else og
    return p


def main():
    if not os.path.isdir(SRC):
        sys.exit("Không thấy thư mục legacy/ — chạy từ gốc project.")
    corder = read_collection_order()
    cats = read_categories()
    all_order = {slug: i for i, slug in enumerate(corder["all"])}

    products = []
    for f in sorted(glob.glob(os.path.join(SRC, "products", "*.html"))):
        slug = os.path.basename(f)[:-5]
        p = parse_product(f, slug)
        p["sort_all"] = all_order.get(slug, 9999)
        cat = p["category"]
        p["sort_cat"] = corder[cat].index(slug) if cat and slug in corder.get(cat, []) else 0
        products.append(p)

    # kiểm tra chéo
    known = {c["slug"] for c in cats}
    for p in products:
        if p["category"] and p["category"] not in known:
            problems.append(f"{p['slug']}: category '{p['category']}' không có trong collections/index")

    # ---- blog
    blog_index = read(os.path.join(SRC, "blog", "index.html"))
    cards = re.findall(
        r'<a class="post" href="blog/([^"]+)".*?<p class="date"[^>]*>(.*?)</p>.*?<p class="excerpt"[^>]*>(.*?)</p>',
        blog_index,
        re.S,
    )
    months = {m: i + 1 for i, m in enumerate(
        "January February March April May June July August September October November December".split())}
    posts = []
    for slug, date_s, excerpt in cards:
        s = read(os.path.join(SRC, "blog", slug + ".html"))
        title = un(one(r"<h1[^>]*>(.*?)</h1>", s, re.S, f"blog {slug}: h1"))
        dm = re.search(r'<p class="date"[^>]*>([A-Za-z]+) (\d+), (\d{4})(?: · (.*?))?</p>', s)
        if not dm:
            problems.append(f"blog {slug}: không đọc được ngày")
            continue
        iso = "%s-%02d-%02d" % (dm.group(3), months[dm.group(1)], int(dm.group(2)))
        cover = re.search(r'<img class="cover" src="([^"]*)"', s)
        content = re.search(r'<div class="content"[^>]*>(.*?)</div> <a class="back"', s, re.S)
        if not content:
            problems.append(f"blog {slug}: không thấy .content")
        desc = meta(s, "name", "description")
        og = meta(s, "property", "og:image")
        cover_base = strip_w(un(cover.group(1))) if cover else None
        posts.append(
            {
                "slug": slug,
                "title": title,
                "excerpt": un(excerpt),
                "content": content.group(1) if content else "",
                "cover": cover_base,
                "author": un(dm.group(4)) if dm.group(4) else None,
                "published_at": iso,
                "seo_description": None if desc == un(excerpt) else desc,
                "og_image": None if og is None or strip_w(og) == cover_base else og,
            }
        )
    # đảm bảo mọi file blog đều có trong index
    files = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(SRC, "blog", "*.html"))} - {"index"}
    missing = files - {p["slug"] for p in posts}
    if missing:
        problems.append(f"blog có file nhưng không có trong index: {sorted(missing)}")

    # ---- ghi seed.sql
    out = ["-- Tự sinh bởi scripts/migrate.py — đừng sửa tay.", "-- Chạy lại an toàn: INSERT OR IGNORE không ghi đè dữ liệu đã sửa trong Admin.", ""]
    for i, c in enumerate(cats):
        out.append(
            "INSERT OR IGNORE INTO categories (slug,name,image,sort) VALUES (%s,%s,%s,%d);"
            % (q(c["slug"]), q(c["name"]), q(c["image"]), i)
        )
    out.append("")
    def split_text(text, size=40000):
        parts, cur, n = [], [], 0
        for ch in text:
            cur.append(ch)
            n += len(ch.encode("utf8"))
            if n >= size:
                parts.append("".join(cur))
                cur, n = [], 0
        if cur:
            parts.append("".join(cur))
        return parts

    for p in products:
        cols = {
            "description": p["description"],
            "variants": json.dumps(p["variants"], ensure_ascii=False, separators=(",", ":")),
        }
        # D1 giới hạn ~100KB cho mỗi câu SQL: cột nào quá lớn thì chèn rỗng rồi nối thêm từng phần.
        # Điều kiện length(cột)=N giúp chạy lại không bị nối trùng, cũng không đụng bản đã sửa.
        later = []
        for name in ("description", "variants"):
            if len(cols[name].encode("utf8")) > 50000:
                later.append((name, split_text(cols[name])))
                cols[name] = ""
        out.append(
            "INSERT OR IGNORE INTO products (slug,title,description,category,status,images,options,variants,"
            "seo_title,seo_description,og_image,sort_all,sort_cat) VALUES (%s,%s,%s,%s,'published',%s,%s,%s,%s,%s,%s,%d,%d);"
            % (
                q(p["slug"]), q(p["title"]), q(cols["description"]), q(p["category"]),
                q(json.dumps(p["images"], ensure_ascii=False)),
                q(json.dumps(p["options"], ensure_ascii=False)),
                q(cols["variants"]),
                q(p["seo_title"]), q(p["seo_description"]), q(p["og_image"]),
                p["sort_all"], p["sort_cat"],
            )
        )
        for name, parts in later:
            done = 0
            for part in parts:
                out.append(
                    "UPDATE products SET %s = %s || %s WHERE slug = %s AND length(%s) = %d;"
                    % (name, name, q(part), q(p["slug"]), name, done)
                )
                done += len(part)
    out.append("")
    for p in posts:
        out.append(
            "INSERT OR IGNORE INTO posts (slug,title,excerpt,content,cover,author,published_at,status,seo_description,og_image)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,'published',%s,%s);"
            % (
                q(p["slug"]), q(p["title"]), q(p["excerpt"]), q(p["content"]), q(p["cover"]),
                q(p["author"]), q(p["published_at"]), q(p["seo_description"]), q(p["og_image"]),
            )
        )
    with open(OUT, "w", encoding="utf8") as f:
        f.write("\n".join(out) + "\n")

    nv = sum(len(p["variants"]) for p in products)
    ni = sum(len(p["images"]) for p in products)
    print(f"categories: {len(cats)}")
    print(f"products:   {len(products)}  (biến thể: {nv}, ảnh: {ni}, không danh mục: {sum(1 for p in products if not p['category'])})")
    print(f"posts:      {len(posts)}")
    print(f"ghi: {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)//1024} KB)")
    if problems:
        print("\nCẢNH BÁO (%d):" % len(problems))
        for x in problems:
            print(" -", x)
        sys.exit(1)
    print("Không có cảnh báo.")


if __name__ == "__main__":
    main()
