# -*- coding: utf-8 -*-
"""把 DOC/十张图 压缩+按 mp 题号重命名 → miniprogram/images/scenarios/Q1..Q10.jpg

要求:
- 尺寸:最大宽 750px(mp 全屏宽 2x 用不到更大,retina 1x=375px)
- 格式:JPEG quality 82(照片场景视觉损失几乎不可见)
- 目标:单张 ≤ 200KB,10 张合计 <2MB 打进主包

命名规则:文件名 001..010 恰好对应 mp Q1..Q10(用户约定)。
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "DOC" / "images_ten"
DST = ROOT / "miniprogram" / "images" / "scenarios"
DST.mkdir(parents=True, exist_ok=True)

MAX_W = 750
QUALITY = 82

files = sorted(SRC.glob("*.png"))
assert len(files) == 10, f"应有 10 张,实际 {len(files)}"

total = 0
for f in files:
    idx = int(f.name.split()[0])  # "001 BJ1-08.png" → 1
    assert 1 <= idx <= 10
    out = DST / f"Q{idx}.jpg"
    im = Image.open(f).convert("RGB")
    w, h = im.size
    if w > MAX_W:
        im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
    im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    kb = out.stat().st_size / 1024
    total += kb
    print(f"  Q{idx}: {f.name} ({f.stat().st_size/1024:.0f}KB) → {out.name} ({kb:.0f}KB, {im.size[0]}x{im.size[1]})")

print(f"\n总计 {total/1024:.2f} MB(mp 主包上限 2MB)")
