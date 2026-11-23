#!/usr/bin/env python3 -I
"""
Nạp db/seed.sql vào D1 theo từng phần nhỏ (~200KB mỗi phần).
Dùng khi mạng yếu / hay lỗi "fetch failed" lúc nạp file seed lớn.

Chạy:   python3 -I scripts/seed-remote.py            # nạp lên D1 thật
        python3 -I scripts/seed-remote.py --local    # nạp vào D1 trên máy (để thử)

Chạy lại bất cứ lúc nào cũng an toàn: seed dùng INSERT OR IGNORE nên không ghi đè, không nhân đôi.
Nếu bị ngắt giữa chừng, cứ chạy lại lệnh — phần đã nạp sẽ được bỏ qua.
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = "infinite-builds-db"
PART_BYTES = 200_000
LOCAL = "--local" in sys.argv
WRANGLER = os.environ.get("WRANGLER", "npx wrangler").split()

sql = open(os.path.join(ROOT, "db", "seed.sql"), encoding="utf8").read()
# Mỗi câu lệnh bắt đầu bằng INSERT OR IGNORE hoặc UPDATE ở đầu dòng (nội dung bên trong có thể xuống dòng)
statements = [s for s in re.split(r"\n(?=INSERT OR IGNORE|UPDATE products)", sql) if s.strip() and not s.startswith("--")]
head = [s for s in re.split(r"\n(?=INSERT OR IGNORE|UPDATE products)", sql)][0]
if head.startswith("--"):
    head = "\n".join(l for l in head.split("\n") if not l.startswith("--")).strip()
    if head:
        statements.insert(0, head)

parts, cur, size = [], [], 0
for s in statements:
    s = s.rstrip()
    if not s.endswith(";"):
        s += ";"
    b = len(s.encode("utf8"))
    if cur and size + b > PART_BYTES:
        parts.append(cur)
        cur, size = [], 0
    cur.append(s)
    size += b
if cur:
    parts.append(cur)

print(f"{len(statements)} câu lệnh -> {len(parts)} phần ({'LOCAL' if LOCAL else 'D1 thật'})")
env = dict(os.environ, NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection")
with tempfile.TemporaryDirectory() as tmp:
    for i, part in enumerate(parts, 1):
        path = os.path.join(tmp, f"seed-part-{i:02d}.sql")
        with open(path, "w", encoding="utf8") as f:
            f.write("\n".join(part) + "\n")
        kb = os.path.getsize(path) // 1024
        cmd = WRANGLER + ["d1", "execute", DB, "--local" if LOCAL else "--remote", "--yes", f"--file={path}"]
        ok = False
        for attempt in (1, 2, 3):
            print(f"[{i}/{len(parts)}] {kb}KB (lần {attempt})… ", end="", flush=True)
            r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
            if r.returncode == 0:
                print("xong")
                ok = True
                break
            print("lỗi: " + (r.stderr.strip().splitlines() or r.stdout.strip().splitlines() or ["?"])[-1][:120])
        if not ok:
            sys.exit(f"\nDừng ở phần {i}/{len(parts)}. Chạy lại lệnh này để tiếp tục (phần đã nạp sẽ được bỏ qua).")
print("\nHoàn tất. Kiểm tra: mở /api/products trên website — phải thấy danh sách sản phẩm.")
