#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性迁移脚本：把 45 位模拟教师数据从「旧 Python 题号」重排成「小程序题号」。

背景:2026-07-15 落地恒等题号(去掉 MP_TO_PY)。旧模拟数据(exam_results/操作日志)
按旧 py 题号编码;新世界 advisor 内部题号 = 小程序题号,故需把这份金标准数据重贴标签。

映射 M(自对合,与 gsyg_selectFinal 的 MP_TO_PY 同表):
    mp 题 n 的数据 == 旧 py 题 M[n]。M = {1:1,2:4,3:6,4:2,5:5,6:3,7:9,8:10,9:7,10:8}
- exam_results.answers:键为 0-based py 序号。新键(0-based mp) n-1 取旧键 M[n]-1 的值。
- 操作日志.questionIndex:1-based py。新值 = M[旧值];-1 及非数字原样保留。
- 其余列(previousValue/currentValue/answer 等)是与题号无关的排序内容,原样保留。

只重贴标签,不改任何数值/排序内容 → 迁移是保值的。
"""
import csv
import json
import sys
from pathlib import Path

M = {1: 1, 2: 4, 3: 6, 4: 2, 5: 5, 6: 3, 7: 9, 8: 10, 9: 7, 10: 8}

SRC = Path(__file__).resolve().parent.parent / "DOC/计算情境选择最终方案(1)/计算情境选择最终方案/模拟数据_45位教师"
DST = SRC.parent / "模拟数据_45位教师_mp题序"


def remap_answers(cell):
    old = json.loads(cell)
    new = {}
    for n in range(1, 11):
        py = M[n]
        key_new = str(n - 1)
        key_old = str(py - 1)
        if key_old in old:
            new[key_new] = old[key_old]
    return json.dumps(new, ensure_ascii=False)


def migrate_results():
    with (SRC / "exam_results_45teachers.csv").open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())
    for r in rows:
        if r.get("answers"):
            r["answers"] = remap_answers(r["answers"])
    out = DST / "exam_results_45teachers.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def migrate_logs():
    with (SRC / "操作日志_result_45teachers.csv").open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    fields = list(rows[0].keys())
    changed = 0
    for r in rows:
        q = r.get("questionIndex", "")
        try:
            iq = int(q)
        except (TypeError, ValueError):
            continue
        if 1 <= iq <= 10:
            r["questionIndex"] = str(M[iq])
            changed += 1
    out = DST / "操作日志_result_45teachers.csv"
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    return len(rows), changed


def main():
    DST.mkdir(parents=True, exist_ok=True)
    n = migrate_results()
    lr, lc = migrate_logs()
    print(f"exam_results: {n} 位教师 answers 已按 mp 题号重排 -> {DST}")
    print(f"操作日志: {lr} 行,其中 {lc} 行 questionIndex(1-10) 已重映射")
    print("完成。")


if __name__ == "__main__":
    main()
