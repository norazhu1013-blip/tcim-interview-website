# -*- coding: utf-8 -*-
"""从 calculate_advisor_rpg_final(1).py 的 SCORE_CSV(最新赋分表)重建 scoreTable.js。
按情境内容做 mp题号 → python列 的映射(题号错位已核对),并与当前 scoreTable.js diff。
"""
import csv, io, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT / "DOC" / "calculate_advisor_rpg_final(1).py"
OUT = ROOT / "miniprogram" / "data" / "scoreTable.js"

# mp 题号 → python 列号(1-based),按 scenario/选项逐字核对
MAP = {1: 1, 2: 4, 3: 6, 4: 2, 5: 5, 6: 3, 7: 9, 8: 10, 9: 7, 10: 8}

# 1) 提取 SCORE_CSV
src = PY.read_text(encoding="utf-8")
m = re.search(r'SCORE_CSV = """(.*?)"""', src, re.S)
csv_text = m.group(1).strip()
reader = csv.DictReader(io.StringIO(csv_text))
# comb -> {col(1..10): int}
table = {}
for row in reader:
    comb = row["选项组合"].strip()
    table[comb] = {q: int(row[f"{q:02d}赋分"]) for q in range(1, 11)}
combs = list(table.keys())  # 24 个,字典序 ABCD..DCBA
assert len(combs) == 24, len(combs)

def key(comb):
    return ">".join(list(comb))

# 2) 生成新 SCORES: mpQ -> {key: score}
new_scores = {}
for mpq in range(1, 11):
    col = MAP[mpq]
    d = {}
    for comb in combs:
        d[key(comb)] = table[comb][col]
    new_scores[f"Q{mpq}"] = d

# 3) 解析当前 scoreTable.js 里的 SCORES 做 diff
cur_text = OUT.read_text(encoding="utf-8")
cur = {}
for qm in re.finditer(r"(Q\d+):\s*\{(.*?)\}", cur_text, re.S):
    q = qm.group(1)
    body = qm.group(2)
    kv = {}
    for em in re.finditer(r"'([A-D>]+)':\s*(\d+)", body):
        kv[em.group(1)] = int(em.group(2))
    if kv:
        cur[q] = kv

# 4) diff
diffs = []
for mpq in range(1, 11):
    q = f"Q{mpq}"
    for k, v in new_scores[q].items():
        old = cur.get(q, {}).get(k)
        if old != v:
            diffs.append((q, k, old, v))

print(f"当前 scoreTable.js 已解析 {sum(len(v) for v in cur.values())} 个格子")
print(f"差异格子数: {len(diffs)}")
by_q = {}
for q, k, old, v in diffs:
    by_q.setdefault(q, []).append((k, old, v))
for q in [f"Q{i}" for i in range(1, 11)]:
    if q in by_q:
        print(f"\n[{q}] 变更 {len(by_q[q])} 处 (mp{q}→py列{MAP[int(q[1:])]}):")
        for k, old, v in by_q[q]:
            print(f"   {k}: {old} -> {v}")

# 5) 生成新文件(保持原格式/注释/导出)
header = cur_text[: cur_text.index("const SCORES")]
lines = [header + "const SCORES = {"]
for mpq in range(1, 11):
    q = f"Q{mpq}"
    lines.append(f"  {q}: {{")
    items = [f"    '{k}': {new_scores[q][k]}" for k in (key(c) for c in combs)]
    lines.append(",\n".join(items))
    lines.append("  }" + ("," if mpq < 10 else ""))
lines.append("};\n")
lines.append("module.exports = { VERSION, SCALE, SCORES };\n")
new_file = "\n".join(lines)

if "--write" in sys.argv:
    OUT.write_text(new_file, encoding="utf-8")
    print(f"\n已写入 {OUT}")
else:
    print("\n(dry-run;加 --write 写入)")
