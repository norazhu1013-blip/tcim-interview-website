from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "交付文档"
ASSETS = OUT / "_doc_assets"
RUNTIME_PATH = ROOT / "web" / "src" / "generated" / "tcim-new-five-tables.runtime.v0.1.json"
TODAY = "2026年8月30日"
VERSION = "V0.1（本机研究比较版）"

BLUE = "2E5AAC"
DARK = "183153"
INK = "243247"
MUTED = "667085"
LIGHT_BLUE = "E8EEF8"
LIGHT = "F5F7FA"
GOLD = "9A6700"
LIGHT_GOLD = "FFF7E6"
RED = "9B1C1C"
LIGHT_RED = "FDECEC"
GREEN = "16794B"
WHITE = "FFFFFF"
BORDER = "D6DCE7"


def rgb(hex_value: str) -> RGBColor:
    return RGBColor.from_string(hex_value)


def set_run(run, size=11, bold=False, color=INK, italic=False, font="Microsoft YaHei"):
    run.font.name = font
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), font)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = rgb(color)
    return run


def set_cell_shading(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=120, bottom=90, end=120):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        tag = "w:" + edge
        node = tc_mar.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_width(cell, dxa: int):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(dxa))
    tc_w.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths: list[int], indent=120):
    total = sum(widths)
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        tr_pr = row._tr.get_or_add_trPr()
        if tr_pr.find(qn("w:cantSplit")) is None:
            tr_pr.append(OxmlElement("w:cantSplit"))
        for idx, cell in enumerate(row.cells):
            set_cell_width(cell, widths[idx])
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def set_repeat_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    node = OxmlElement("w:tblHeader")
    node.set(qn("w:val"), "true")
    tr_pr.append(node)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("第 ")
    set_run(run, 9, color=MUTED)
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_text = OxmlElement("w:t")
    fld_text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    for node in (fld_begin, instr, fld_sep, fld_text, fld_end):
        run._r.append(node)
    end = paragraph.add_run(" 页")
    set_run(end, 9, color=MUTED)


def create_numbering(doc: Document):
    numbering = doc.part.numbering_part.element
    existing_abs = [int(x.get(qn("w:abstractNumId"))) for x in numbering.findall(qn("w:abstractNum"))]
    existing_num = [int(x.get(qn("w:numId"))) for x in numbering.findall(qn("w:num"))]
    start_abs = max(existing_abs or [0]) + 1
    start_num = max(existing_num or [0]) + 1

    def add_one(abstract_id, num_id, fmt, text, font=None):
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abstract_id))
        multi = OxmlElement("w:multiLevelType")
        multi.set(qn("w:val"), "singleLevel")
        abstract.append(multi)
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), "0")
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), fmt)
        lvl_text = OxmlElement("w:lvlText")
        lvl_text.set(qn("w:val"), text)
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "tab")
        p_pr = OxmlElement("w:pPr")
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "num")
        tab.set(qn("w:pos"), "540")
        tabs.append(tab)
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), "540")
        ind.set(qn("w:hanging"), "270")
        spacing = OxmlElement("w:spacing")
        spacing.set(qn("w:after"), "80")
        spacing.set(qn("w:line"), "300")
        spacing.set(qn("w:lineRule"), "auto")
        p_pr.extend([tabs, ind, spacing])
        lvl.extend([start, num_fmt, lvl_text, suff, p_pr])
        if font:
            r_pr = OxmlElement("w:rPr")
            r_fonts = OxmlElement("w:rFonts")
            r_fonts.set(qn("w:ascii"), font)
            r_fonts.set(qn("w:hAnsi"), font)
            r_pr.append(r_fonts)
            lvl.append(r_pr)
        abstract.append(lvl)
        numbering.append(abstract)
        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        abstract_ref = OxmlElement("w:abstractNumId")
        abstract_ref.set(qn("w:val"), str(abstract_id))
        num.append(abstract_ref)
        numbering.append(num)

    add_one(start_abs, start_num, "bullet", "•", "Arial")
    add_one(start_abs + 1, start_num + 1, "decimal", "%1.")
    return {"bullet": start_num, "number": start_num + 1}


def apply_number(paragraph, num_id):
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = p_pr.find(qn("w:numPr"))
    if num_pr is None:
        num_pr = OxmlElement("w:numPr")
        p_pr.append(num_pr)
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    n_id = OxmlElement("w:numId")
    n_id.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, n_id])


def restart_numbering(doc: Document, numbering: dict) -> dict:
    """Create a fresh decimal-list instance while keeping the same list style."""
    root = doc.part.numbering_part.element
    source = next(
        node for node in root.findall(qn("w:num"))
        if int(node.get(qn("w:numId"))) == numbering["number"]
    )
    abstract_id = source.find(qn("w:abstractNumId")).get(qn("w:val"))
    existing = [int(node.get(qn("w:numId"))) for node in root.findall(qn("w:num"))]
    new_id = max(existing or [0]) + 1
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(new_id))
    ref = OxmlElement("w:abstractNumId")
    ref.set(qn("w:val"), abstract_id)
    num.append(ref)
    override = OxmlElement("w:lvlOverride")
    override.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:startOverride")
    start.set(qn("w:val"), "1")
    override.append(start)
    num.append(override)
    root.append(num)
    return {"bullet": numbering["bullet"], "number": new_id}


def style_document(doc: Document, running_title: str):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.78)
    section.bottom_margin = Inches(0.72)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)
    section.header_distance = Inches(0.38)
    section.footer_distance = Inches(0.38)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = rgb(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.25

    specs = {
        "Title": (28, DARK, 0, 8),
        "Subtitle": (12, MUTED, 0, 12),
        "Heading 1": (16, BLUE, 18, 9),
        "Heading 2": (13, BLUE, 13, 6),
        "Heading 3": (11.5, DARK, 9, 4),
    }
    for name, (size, color, before, after) in specs.items():
        style = doc.styles[name]
        style.font.name = "Microsoft YaHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.bold = name != "Subtitle"
        style.font.color.rgb = rgb(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True

    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.space_after = Pt(0)
    set_run(hp.add_run(running_title), 8.5, bold=True, color=MUTED)
    footer = section.footer
    fp = footer.paragraphs[0]
    add_page_number(fp)
    return create_numbering(doc)


def add_cover(doc: Document, kicker: str, title: str, subtitle: str, version: str, audience: str):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(54)
    p.paragraph_format.space_after = Pt(18)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(kicker), 10.5, bold=True, color=GOLD)
    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(title), 28, bold=True, color=DARK)
    p = doc.add_paragraph(style="Subtitle")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run(subtitle), 12.5, color=MUTED)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("研究比较版 · 不等同于正式测评效度发布"), 10, bold=True, color=RED)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(110)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for label, value in (("版本", version), ("日期", TODAY), ("适用对象", audience)):
        r = p.add_run(f"{label}：")
        set_run(r, 10, bold=True, color=DARK)
        set_run(p.add_run(value + "\n"), 10, color=INK)
    doc.add_page_break()


def add_paragraph(doc, text, bold_prefix=None, color=INK, italic=False, keep=False):
    p = doc.add_paragraph()
    p.paragraph_format.keep_together = keep
    if bold_prefix and text.startswith(bold_prefix):
        set_run(p.add_run(bold_prefix), 10.5, bold=True, color=DARK)
        set_run(p.add_run(text[len(bold_prefix):]), 10.5, color=color, italic=italic)
    else:
        set_run(p.add_run(text), 10.5, color=color, italic=italic)
    return p


def add_bullet(doc, text, numbering, bold_prefix=None):
    p = doc.add_paragraph()
    apply_number(p, numbering["bullet"])
    if bold_prefix and text.startswith(bold_prefix):
        set_run(p.add_run(bold_prefix), 10.3, bold=True, color=DARK)
        set_run(p.add_run(text[len(bold_prefix):]), 10.3)
    else:
        set_run(p.add_run(text), 10.3)
    return p


def add_numbered(doc, text, numbering, bold_prefix=None):
    p = doc.add_paragraph()
    apply_number(p, numbering["number"])
    if bold_prefix and text.startswith(bold_prefix):
        set_run(p.add_run(bold_prefix), 10.3, bold=True, color=DARK)
        set_run(p.add_run(text[len(bold_prefix):]), 10.3)
    else:
        set_run(p.add_run(text), 10.3)
    return p


def add_callout(doc, title, body, fill=LIGHT_BLUE, title_color=BLUE):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    set_table_geometry(table, [9360])
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    set_run(p.add_run(title), 10.5, bold=True, color=title_color)
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    set_run(p.add_run(body), 10, color=INK)
    after = doc.add_paragraph()
    after.paragraph_format.space_after = Pt(2)


def add_table(doc, headers, rows, widths, font_size=9.2, header_fill=LIGHT_BLUE, keep_header=True):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.style = "Table Grid"
    for idx, header in enumerate(headers):
        cell = table.rows[0].cells[idx]
        set_cell_shading(cell, header_fill)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        set_run(p.add_run(str(header)), font_size, bold=True, color=DARK)
    if keep_header:
        set_repeat_header(table.rows[0])
    for row in rows:
        cells = table.add_row().cells
        for idx, value in enumerate(row):
            p = cells[idx].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.12
            if idx == 0 and len(str(value)) < 12:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_run(p.add_run(str(value)), font_size, color=INK)
    set_table_geometry(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def load_font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def draw_architecture_diagram(path: Path):
    width, height = 1500, 820
    image = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    title = load_font(42, True)
    hfont = load_font(29, True)
    body = load_font(24)
    small = load_font(21)
    draw.text((60, 35), "TCIM本机比较版：前台自由对话，后台证据治理", font=title, fill="#183153")

    boxes = [
        ((70, 140, 430, 290), "教师界面", "情境、排序、自由表达\n收尾提示与耗时看板", "#E8EEF8"),
        ((570, 115, 960, 315), "Dialogue Agent", "理解教师原话\n自主决定承接、深化、转向或结束\n每轮只生成一条可见回应", "#DDEAFF"),
        ((1080, 140, 1430, 290), "本机模型网关", "Kimi K3 / OpenAI\n严格JSON、模型锁、质量闸门", "#E8EEF8"),
        ((90, 470, 430, 650), "新五表 RuntimeCard", "情境事实、专业透镜\n证据合同、可供性、硬边界", "#FFF7E6"),
        ((570, 445, 960, 675), "Orchestrator + 状态", "Dialogue Progress：问过什么\nUtility：覆盖/新发现/成本（仅建议）\nEvidence State：可追溯规范证据", "#EAF7F0"),
        ((1080, 470, 1430, 650), "画像与报告", "Canonical Evidence → 能力画像候选\nRO0/1、RO2、RO3/4分轨\n不把AI诱导当原有能力", "#F2EDF9"),
    ]
    for (x1, y1, x2, y2), heading, text, fill in boxes:
        draw.rounded_rectangle((x1, y1, x2, y2), radius=22, fill=fill, outline="#B8C4D8", width=3)
        draw.text((x1 + 24, y1 + 18), heading, font=hfont, fill="#183153")
        draw.multiline_text((x1 + 24, y1 + 62), text, font=body, fill="#334155", spacing=10)

    def arrow(start, end, label=""):
        draw.line((start, end), fill="#5470B3", width=6)
        ex, ey = end
        sx, sy = start
        import math
        angle = math.atan2(ey - sy, ex - sx)
        left = (ex - 18 * math.cos(angle - 0.55), ey - 18 * math.sin(angle - 0.55))
        right = (ex - 18 * math.cos(angle + 0.55), ey - 18 * math.sin(angle + 0.55))
        draw.polygon([end, left, right], fill="#5470B3")
        if label:
            mx, my = (sx + ex) / 2, (sy + ey) / 2
            draw.text((mx - 50, my - 32), label, font=small, fill="#425B91")

    arrow((430, 215), (570, 215), "表达/回应")
    arrow((960, 215), (1080, 215), "模型调用")
    arrow((1080, 260), (960, 260), "结构化返回")
    arrow((260, 470), (650, 315), "专业视野")
    arrow((760, 445), (760, 315), "低频提示")
    arrow((960, 560), (1080, 560), "规范证据")
    arrow((570, 555), (430, 250), "状态反馈")
    draw.text((65, 735), "硬权力：安全/权限边界与Evidence写入校验；软信息：专业透镜、可供性和效用状态。最终可见回应主要由Dialogue Agent决定。", font=small, fill="#667085")
    image.save(path)


def add_figure(doc, path: Path, caption: str, width=6.75):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    picture = p.add_run().add_picture(str(path), width=Inches(width))
    picture._inline.docPr.set("descr", "TCIM本机比较版模块关系图：Dialogue Agent主导前台对话，新五表提供专业视野，Orchestrator传递状态，Evidence State支持画像。")
    picture._inline.docPr.set("title", "TCIM本机比较版模块关系图")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(8)
    set_run(p.add_run(caption), 9, color=MUTED, italic=True)


def add_section_nav(doc, items, numbering):
    doc.add_heading("阅读导航", level=1)
    for item in items:
        add_bullet(doc, item, numbering)


def build_architecture(runtime):
    doc = Document()
    numbering = style_document(doc, "TCIM当前程序整体架构与实现分析报告")
    add_cover(
        doc,
        "TCIM · 技术与研究说明",
        "当前程序整体架构、实现机制与本机发布分析报告",
        "面向程序员、编程AI与研究团队的统一说明",
        VERSION,
        "研究负责人、程序员、编程AI、数据复核人员",
    )
    add_callout(
        doc,
        "一句话结论",
        "当前版本不是‘五表驱动的固定问答程序’，而是由强模型Dialogue Agent承担前台理解与问话，新五表提供专业视野，Evidence State保存可追溯证据，模型外验证器限制证据越权，确定性转换器生成有边界的教师能力画像候选。当前未接入完整RRMC，只实现了不阻塞前台的轻量效用状态和稀疏质量监督。",
    )
    add_section_nav(doc, [
        "先看第2—4章：理解系统目标、权力结构和模块关系。",
        "程序员重点看第5—10章：逐轮流程、接口、存储、时间与错误处理。",
        "研究团队重点看第7、11、13章：证据来源、画像边界和当前限制。",
        "本机使用者重点看第12章：发布、启动、停止和数据位置。",
    ], numbering)

    doc.add_heading("1. 报告范围与版本状态", level=1)
    add_paragraph(doc, "本报告说明位于本机仓库TCIM-Dialogue-Agent-Compare、分支codex/dialogue-agent-comparison的当前比较版本。它沿用第一版的教师资料、十题排序测评、确定性赋分、三题遴选和每情境十分钟限制，只替换并强化AI访谈、证据状态和能力画像链。")
    add_table(doc, ["项目", "当前值"], [
        ["运行方式", "本机生产静态网页 + 本机Dialogue Agent HTTP服务"],
        ["网页地址", "http://127.0.0.1:5173"],
        ["Dialogue Agent地址", "http://127.0.0.1:8787"],
        ["默认真实模型", "Kimi K3；也可选择OpenAI，正式会话锁定provider/model"],
        ["新五表数据集", runtime.get("datasetId", "")],
        ["配置指纹", runtime.get("configFingerprint", "")],
        ["发布范围", "SIMULATION_ACTIVE；只用于研究比较，不代表真人专家审定"],
    ], [1900, 7460])
    add_callout(doc, "必须区分的两个‘发布’", "本地发布表示把程序固化为可稳定运行的生产构建；专业能力发布表示五表、证据规则和画像结论通过专家与真实教师验证。当前只完成前者，后者仍由TEVV和人工研究决定。", fill=LIGHT_GOLD, title_color=GOLD)

    doc.add_heading("2. 产品目标与完整业务流程", level=1)
    add_paragraph(doc, "根本目标是从多个角度理解幼儿园教师的游戏支持与引导能力，并在理解之后促进反思，最终形成可用于教师发展支持、但不越过证据边界的画像。系统不是为了证明教师答对了标准答案，也不是为了让AI在谈话中把自己的观点变成教师的能力。")
    steps = restart_numbering(doc, numbering)
    for text in [
        "教师完成个人资料并进入十个游戏情境排序题。",
        "确定性程序按赋分表计算结果，AI不参与打分。",
        "程序结合结果与过程数据确定三个有解释价值的访谈情境。",
        "Dialogue Agent围绕一个情境与教师开放交谈；新五表扩大专业观察范围，但不规定唯一路线。",
        "后台Evidence Analyzer提出证据候选，模型外Validator核对原话、ID、来源等级和结论上限。",
        "十分钟内完成对话，最后90秒收尾；教师最后一段原话仍保存并可后台分析。",
        "Canonical Evidence确定性转换为能力画像候选；报告区分测评定位、独立访谈证据、提示后澄清及AI影响后的反思。",
    ]:
        add_numbered(doc, text, steps)

    doc.add_heading("3. 设计理念：自由在哪里，约束在哪里", level=1)
    add_table(doc, ["对象", "拥有的权力", "明确不能做的事"], [
        ["Dialogue Agent", "理解情境和教师原话；自主选择承接、澄清、深化、转向、反事实或结束；自主措辞；可追随表外新线索。", "不能修改评分；不能直接写Canonical Evidence；不能绕过隐私、安全、单问和来源边界。"],
        ["新五表", "提供情境事实/未知、能力透镜、多路径、证据合同、对话可供性、综合上限。", "不能成为固定问题脚本或路线白名单；AFFORDANCE/MONITOR不能冒充硬边界。"],
        ["Evidence Validator", "确定候选是否能写入、有效等级、冲突和来源轨道。", "不能替Dialogue Agent组织对话；不能把无原话候选或表外命题写成规范证据。"],
        ["Utility State", "用已保存状态描述覆盖、新发现和成本，给出OPEN_EXPLORE等建议。", "只允许ADVISORY；不能指定下一问或强迫模型补槽。"],
        ["时间/安全控制器", "在明确退出、隐私、单问、泄露和收尾窗口等硬条件下阻断或关闭。", "不能生成本地专业问题冒充模型；失败时只能暂停、重试或安全收束。"],
    ], [1600, 4000, 3760], font_size=8.7)

    doc.add_heading("4. 整体架构与模块关系", level=1)
    diagram = ASSETS / "architecture.png"
    draw_architecture_diagram(diagram)
    add_figure(doc, diagram, "图1  当前本机比较版的主运行关系")
    add_paragraph(doc, "这张图中，向上的箭头大多是给模型的可撤销信息，向右的证据链则是确定性治理。Dialogue Agent可以不采纳可供性和效用建议，但不能拒绝硬边界，也不能替Evidence Validator决定什么是教师原有能力。")

    doc.add_heading("4.1 前台层：教师体验", level=2)
    for text in [
        "情境题干始终可见，四个做法及教师本人排序默认折叠，避免信息挤压对话。",
        "教师不必判断抽象的‘谈话阶段’，页面只呈现‘自由讲述与追问’或‘完成最后补充’。",
        "每轮技术耗时默认折叠；需要时可查看可见延时、输入输出tokens、问话质检和后台Evidence耗时。",
        "模型状态简化为‘AI已连接’，错误或模型不一致时才展开详细恢复信息。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("4.2 编排与状态层", level=2)
    add_paragraph(doc, "Orchestrator位于页面领域引擎与本机模型服务之间。它不写固定专业问句，而是组装当前题RuntimeCard、教师资料、历史对话、Evidence摘要、Dialogue Progress和Utility状态，提交给Dialogue Agent，并将返回结果交给硬边界和证据校验器。")
    add_table(doc, ["状态", "保存内容", "用途"], [
        ["Dialogue Progress State", "问题账本、开放线程、已覆盖线索、停滞度、阶段", "避免原地复问，保留尚未成为证据的谈话线索"],
        ["Interview Utility State", "独立证据覆盖、提示后证据、AI影响证据、开放/涌现线程、提问成本", "给模型低频、轻量、可拒绝的方向建议"],
        ["Evidence State", "规范命题、教师逐字片段、来源等级、有效状态、冲突与修订链", "形成可回放、可审计的Canonical Evidence"],
        ["Audit Log", "请求、模型、方向、边界、写入、暂停、收尾和版本", "研究复现与故障定位"],
    ], [2100, 3900, 3360], font_size=9)

    doc.add_heading("5. 新五表如何进入程序", level=1)
    add_paragraph(doc, "程序不在每轮读取Excel。五个唯一运行版Excel先被编译为带来源哈希和配置指纹的JSON，再按题转换为紧凑RuntimeCard。这样既避免延时，也避免旧表与新表混用。")
    add_table(doc, ["表", "编译后信息", "运行位置"], [
        ["表1 情境深描与条件边界", "ScenarioBrief、已知事实、重要未知、条件变体、前测先验", "会话开始和相关情境变化时"],
        ["表2 多路径Ontology", "全局能力透镜、情境能力概念、多条可接受路径", "扩大Dialogue Agent专业视野"],
        ["表3 证据命题与反事实", "理解ID、命题ID、来源、锚点、反证、伪证据、上限", "后台Evidence Analyzer与模型外Validator"],
        ["表4 开放探询与稀疏监督", "AFFORDANCE、MONITOR、HARD_BOUNDARY、COMPILER_BOUNDARY", "Dialogue Agent建议、低频监督和硬门"],
        ["表5 综合、记忆与TEVV", "综合与记忆政策；TEVV留在测试发布侧", "报告上限与未来记忆治理；TEVV不注入普通对话"],
    ], [1900, 4200, 3260], font_size=8.8)
    add_callout(doc, "当前运行规模", f"10题；{sum(len(q.get('evidencePolicies', [])) for q in runtime['questions'].values()) + len(runtime['global'].get('evidencePolicies', []))}条证据政策；{sum(len(q.get('dialoguePolicies', [])) for q in runtime['questions'].values()) + len(runtime['global'].get('dialoguePolicies', []))}条对话政策；{sum(len(q.get('synthesisPolicies', [])) for q in runtime['questions'].values()) + len(runtime['global'].get('synthesisPolicies', []))}条综合/记忆运行政策；14条可识别硬边界。")

    doc.add_heading("6. 一轮对话具体如何运行", level=1)
    doc.add_heading("6.1 首问", level=2)
    steps = restart_numbering(doc, numbering)
    for text in [
        "页面建立Dialogue Session和本题RuntimeCard，保存模型选择锁。",
        "Orchestrator发送情境、四个选项语义、教师排序及轻量运行卡。",
        "Dialogue Agent自主形成首问；程序检查严格JSON、单问、长度、泄露和诱导性。",
        "首问可见后才进入教师回答—语义分析—Evidence写入循环；首问本身不产生教师能力证据。",
    ]:
        add_numbered(doc, text, steps)
    doc.add_heading("6.2 教师每次回答之后", level=2)
    steps = restart_numbering(doc, numbering)
    for text in [
        "先原样保存教师文本和turnId，防止模型失败造成回答丢失。",
        "前台链只请求下一条简短回应；输入包含紧凑历史、Evidence摘要、Dialogue Progress和Utility建议。",
        "服务端检查输出契约、硬边界、近义复问和明显诱导确认问句；可纠正的问题只允许重写一次。",
        "合格问题立即显示。普通前台调用不等待Evidence分析。",
        "后台Evidence Analyzer随后分析刚才的教师原话，最多提出少量规范候选。",
        "模型外Validator核对claim/understanding配对、逐字span、RO来源、允许来源和等级上限；接受、拒绝、修订和冲突都留日志。",
        "更新后的Evidence与效用状态供下一轮参考；它们描述已知状态，不规定下一问。",
    ]:
        add_numbered(doc, text, steps)

    doc.add_heading("7. 问话质量与非诱导机制", level=1)
    add_paragraph(doc, "程序用‘模型能力 + 提示原则 + 确定性闸门 + 事后研究评价’四层共同管理问话质量。闸门只阻断能够可靠识别的问题，不试图把全部教育判断写成正则规则。")
    add_table(doc, ["层次", "当前做法", "边界"], [
        ["模型提示", "要求承接教师原话、只问一个问题、不先给答案再求认同、不以AI认同证明能力。", "依赖模型遵循，不能单独作为研究证据。"],
        ["结构校验", "严格JSON、动作枚举、问句长度、引用原话、模型/会话锁。", "只判断形式和确定性合同。"],
        ["质量闸门", "近义复问、明显认同式诱导、单问、简洁、承接性和新颖性。", "复杂语义诱导仍需人工与LLM评审。"],
        ["研究评价", "未来用真实教师标注相关性、自然度、非诱导、促进性和认知负担。", "目前尚未形成足够真人样本。"],
    ], [1500, 4300, 3560], font_size=8.9)
    add_callout(doc, "为什么不让质量闸门决定下一问", "因为一旦把‘什么问题才好’完全写成规则，系统又会回到高控制路线。当前闸门只排除重复、泄露、明显诱导等低争议失败；剩余方向仍由Dialogue Agent根据教师刚才的意义自主决定。", fill=LIGHT_GOLD, title_color=GOLD)

    doc.add_heading("8. Evidence State与能力画像", level=1)
    add_table(doc, ["来源", "含义", "进入原有能力画像"], [
        ["RO0", "教师未经提示主动提出", "可以；仍受情境与证据等级限制"],
        ["RO1", "开放问题后独立提出", "可以；仍需逐字来源和命题映射"],
        ["RO2", "澄清追问后补充", "单列为提示后证据，不与独立证据混合"],
        ["RO3", "AI给出选项/观点后教师选择或认可", "不可以；只记录识别或反思响应"],
        ["RO4", "AI讲解后复述、迁移或行动计划", "不可以；只记录学习与发展候选"],
    ], [1100, 4200, 4060], font_size=9)
    add_paragraph(doc, "Canonical Evidence转换器不调用大模型，按活动记录、来源轨道、情境数、有效等级和冲突确定画像候选。可能状态包括：尚无独立证据、仅有提示后证据、仅观察到AI影响后的回应、本情境初步迹象、本情境得到支持、跨情境得到支持、证据冲突待核验。")
    add_callout(doc, "画像的最大结论", "即使达到‘跨情境得到支持’，也只表示在已经访谈的多个模拟情境中得到支持，不代表稳定人格、真实课堂必然表现或正式测量结论。没有谈到某一能力，也不等于教师缺少该能力。")

    doc.add_heading("9. 延时与时间控制", level=1)
    add_paragraph(doc, "当前版本将前台问话与后台Evidence分析解耦，并把模型输入由约2.6万tokens压缩到通常约1000—3000tokens。真实Kimi K3试跑中，首问约5.36秒，后续问约5.33秒；这只是链路验证，不代表所有网络和情境下的P95。")
    add_table(doc, ["机制", "实现", "体验意义"], [
        ["前后台解耦", "先显示问句，再异步分析Evidence", "教师不等待证据写入"],
        ["紧凑运行卡", "只发送本轮相关字段和短历史", "减少模型输入与排队时间"],
        ["短输出", "前台只生成一条回应与少量结构字段", "减少生成时长"],
        ["90秒收尾", "剩余≤90秒显示收尾；≤105秒不再启动新前台模型调用", "教师有时间完成最后想法"],
        ["最后回答本地完成", "保存原话、给固定感谢语、后台继续Evidence", "不会为了等模型而超时"],
    ], [1600, 4200, 3560], font_size=9)

    doc.add_heading("10. 模型、接口与错误处理", level=1)
    add_table(doc, ["接口", "用途", "关键保护"], [
        ["GET /health", "Dialogue Agent健康、provider/model、超时", "不返回密钥"],
        ["GET/POST /v1/model-config", "查看配置状态、选择Kimi/OpenAI/mock", "仅回环地址；密钥写本机.env且不回传"],
        ["POST /v1/dialogue/first", "生成首问", "严格输出契约、无教师证据写入"],
        ["POST /v1/dialogue/next", "教师回答后的下一问", "会话模型锁、引用当前原话、复问/诱导闸门"],
        ["POST /v1/evidence/analyze", "后台Evidence候选", "不阻塞前台；候选仍需模型外校验"],
        ["POST /call", "本机资料、测评、遴选、草稿与访谈网关", "本地owner、revision和回执语义"],
    ], [2600, 3300, 3460], font_size=8.7)
    add_paragraph(doc, "模型调用失败时不生成本地专业问句冒充AI。教师原话已经保存，页面暂停并允许重试；教师明确退出时由硬边界本地收束。正式访谈的provider/model在同次测评中锁定，另一标签页切换模型会返回冲突，不静默混用。")

    doc.add_heading("11. 数据保存、隐私与可复现", level=1)
    for text in [
        "浏览器侧保存正在使用的教师资料、测评会话、对话显示记录和Dialogue Session副本。",
        "本机服务侧状态写入local-dialogue-server/.runtime-data/state.json；模型密钥只在local-dialogue-server/.env。",
        "运行日志与进程记录位于.local-runtime；本地发布清单位于.local-release/release.json。",
        "配置文件带datasetId、schemaVersion、源文件SHA-256和configFingerprint；Evidence记录同时保存政策版本和指纹。",
        "当前版本适合本机研究试验，不等同于完成知情同意、数据保留期限、加密、删除/导出、内容安全和正式权限审计。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("12. 本机发布版如何使用", level=1)
    add_callout(doc, "已经完成本地发布", "当前网页由生产构建的web/dist提供，不再由Vite开发服务器热更新。Dialogue Agent与网页只监听127.0.0.1；当前健康检查已确认网页发布服务与Kimi K3服务均就绪。", fill="EAF7F0", title_color=GREEN)
    steps = restart_numbering(doc, numbering)
    for text in [
        "首次发布或代码更新后：双击根目录‘发布本机版.cmd’。程序先完整验证，再重建生产网页并启动。",
        "日常使用：双击‘启动本机比较版.cmd’，浏览器打开http://127.0.0.1:5173。",
        "停止：双击‘停止本机比较版.cmd’，只停止经项目记录并验证的本机进程。",
        "查看版本：打开.local-release/release.json，可看到构建时间、Git提交、数据集版本与配置指纹。",
        "更换模型：在访谈首问前选择Kimi K3或OpenAI；已保存密钥时无需再次填写。",
    ]:
        add_numbered(doc, text, steps)

    doc.add_heading("13. 已完成验证与当前证据强度", level=1)
    add_table(doc, ["验证对象", "当前结果", "能够证明什么"], [
        ["本机服务测试", "32/32通过", "接口、安全边界、模型配置、超时与provider锁按程序合同运行"],
        ["Dialogue Agent领域测试", "28/28通过", "状态、Evidence、复问、硬边界、收尾与恢复符合实现合同"],
        ["评分对拍", "240个题目×排列一致", "第一版确定性赋分未被新访谈架构改变"],
        ["新五表负向夹具", "10类违规均被拒绝", "关键结构与权限错误能够失败关闭"],
        ["报告测试", "全部通过", "Canonical Evidence来源分轨和画像转换保持确定性"],
        ["真实Kimi链路", "首问与后续问均约5.3秒且通过当前质检", "当前本机链路可用；不能代替大样本质量与P95验证"],
    ], [1900, 2200, 5260], font_size=8.7)

    doc.add_heading("14. 当前没有实现或尚未证明的内容", level=1)
    for text in [
        "完整TCIM-RRMC尚未接入。本版只有轻量Utility State和确定性质量闸门，不能把它描述成已经具备关系—反思元控制闭环。",
        "新五表仍为AI模拟复核、SIMULATION_ACTIVE，尚未经过真实教师与多学科专家的效度审查。",
        "问话质量闸门只能识别部分重复与明显诱导；复杂的暗示、权力关系和文化适切性仍需真人评价。",
        "能力画像是证据组织结果，不是经过常模、信效度和公平性验证的正式评分。",
        "真实延时还需按模型、时段、网络和情境统计P50/P90/P95，并记录重试率和后台积压。",
        "当前生产包较大，后续可按页面与模型配置代码分包；这影响首次加载，不直接影响单轮模型延时。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("15. 建议的下一阶段优先级", level=1)
    add_table(doc, ["优先级", "任务", "验收信号"], [
        ["P0", "完成新五表三类数据治理；建立真实教师问话质量小样本；持续统计端到端延时。", "运行时零高风险警告；人工一致性可报告；Kimi/OpenAI分别有P95"],
        ["P1", "把问话‘信息增益’做成离线/低频估计，不把固定题库搬回前台；校准画像证据等级。", "更少重复、更少轮次获得更多独立证据；画像专家一致率提高"],
        ["P2", "在文字访谈稳定后评估流式输出、语音和完整RRMC；建立TEVV发布门。", "新增能力不显著损害延时、关系质量或证据可追溯性"],
    ], [1000, 4700, 3660], font_size=8.8)

    doc.add_heading("附录A：程序关键文件索引", level=1)
    add_table(doc, ["领域", "文件", "作用"], [
        ["界面", "web/src/views/InterviewView.vue", "访谈界面、时间、前后台调用、持久化和耗时看板"],
        ["领域引擎", "web/src/core/dialogue-agent/engine.js", "会话、请求、Evidence提交、暂停、重试和收尾"],
        ["证据", "web/src/core/dialogue-agent/evidence.js", "规范Evidence确定性写入、等级、冲突与修订"],
        ["进展", "web/src/core/dialogue-agent/progress.js", "问题账本、开放线程、停滞与阶段"],
        ["效用", "web/src/core/dialogue-agent/utility.js", "覆盖—涌现—成本的只读建议状态"],
        ["画像", "web/src/core/canonical-capability-profile.js", "Canonical Evidence到能力画像候选的确定性转换"],
        ["服务", "local-dialogue-server/src/dialogue-agent.js", "模型调用、重写、超时、使用量与追踪"],
        ["契约", "local-dialogue-server/src/schema.js", "严格输出、复问、诱导和质量信号"],
        ["提示", "local-dialogue-server/src/prompts.js", "静态卡、动态输入及非诱导原则"],
        ["发布", "publish-local-comparison.ps1 / local-web-server.js", "验证、生产构建、版本清单和本机静态服务"],
    ], [1300, 3600, 4460], font_size=8.5)

    doc.add_heading("附录B：术语的通俗解释", level=1)
    add_table(doc, ["术语", "通俗理解"], [
        ["RuntimeCard", "从五张Excel中为当前情境裁出的轻量专业资料卡"],
        ["Dialogue Progress", "对话记事本：问过什么、还有哪些线索、是否原地打转"],
        ["Evidence State", "证据账本：哪些教师原话能够支持哪条专业理解，以及证据从哪里来"],
        ["Canonical Evidence", "通过ID、原话、来源和等级校验后正式进入系统的规范证据"],
        ["Utility State", "方向仪表盘：覆盖了多少、是否出现新线索、继续问的成本是否过高"],
        ["TEVV", "测试、评估、验证与确认：决定一种能力能否从试验进入发布"],
        ["Fixture", "固定的测试情境、教师回答和预期行为，用来反复检查程序是否退化"],
    ], [2200, 7160], font_size=9)

    path = OUT / "TCIM当前程序整体架构_实现机制与本机发布分析报告_V0.1.docx"
    doc.core_properties.title = "TCIM当前程序整体架构、实现机制与本机发布分析报告"
    doc.core_properties.subject = "Dialogue Agent主导、新五表、Evidence State与能力画像"
    doc.core_properties.author = "TCIM研究项目"
    doc.save(path)
    return path


def issue_rows(runtime):
    lens = []
    evidence = []
    dialogue = []
    for row in runtime["global"].get("professionalLenses", []): lens.append(("ALL", row))
    for row in runtime["global"].get("evidencePolicies", []): evidence.append(("ALL", row))
    for row in runtime["global"].get("dialoguePolicies", []): dialogue.append(("ALL", row))
    for scope, question in runtime["questions"].items():
        for row in question.get("professionalLenses", []): lens.append((scope, row))
        for row in question.get("evidencePolicies", []): evidence.append((scope, row))
        for row in question.get("dialoguePolicies", []): dialogue.append((scope, row))
    cap_ids = {row.get("capabilityId") for _, row in lens}
    parents = []
    for scope, row in lens:
        for parent in row.get("parentCapabilityIds") or []:
            if parent not in cap_ids:
                parents.append({"scope": scope, "row": row, "parent": parent})
    expected = {"AFFORDANCE": "AFFORDANCE_CARD", "MONITOR": "MONITOR_CARD", "HARD_BOUNDARY": "HARD_BOUNDARY", "COMPILATION_BOUNDARY": "COMPILER_BOUNDARY"}
    mismatch = []
    for scope, row in dialogue:
        target = expected.get(row.get("type"))
        if target and row.get("runtimeUse") != target:
            mismatch.append({"scope": scope, "row": row, "expected": target})
    no_paths = [{"scope": scope, "row": row} for scope, row in evidence if not row.get("pathRefs")]
    return parents, mismatch, no_paths


def build_governance(runtime):
    parents, mismatch, no_paths = issue_rows(runtime)
    doc = Document()
    numbering = style_document(doc, "TCIM新五表数据警告与人工治理操作手册")
    add_cover(
        doc,
        "TCIM · 数据治理SOP",
        "新五表三类已知警告的具体情况与人工修订流程",
        "从问题定位、人工判断、Excel修改、重新编译到兼容复验",
        "V0.1",
        "研究负责人、专业复核人员、数据管理员、程序员",
    )
    add_callout(doc, "结论先行", "当前三类警告不会阻断模拟程序运行，但会削弱Ontology父子图、Evidence到专业路径的解释链，并可能把监测政策按错误频率加载。建议按‘21条路由错配 → 59条父引用 → 50条证据路径’的顺序修订；5条RO来源政策不应强行补路径，而应显式标为不适用。", fill=LIGHT_GOLD, title_color=GOLD)
    add_section_nav(doc, [
        "第2章解释为什么当前能跑，但不能把警告忽略。",
        "第3—5章逐项说明59、21、55条记录及人工做法。",
        "第6章给出统一的Excel修改—复核—编译—测试流程。",
        "第7章给研究负责人、专业复核者和程序员分配交付责任。",
        "附录提供逐条清单和可直接使用的人工复核表字段。",
    ], numbering)

    doc.add_heading("1. 数据范围与警告来源", level=1)
    add_paragraph(doc, "五个Excel是当前比较版的唯一运行源副本，程序实际读取编译后的JSON。验证器把确定会破坏运行合同的问题列为error并失败关闭，把尚能运行但可能影响专业含义或路由的问题列为warning。当前error为0，warning为三类。")
    add_table(doc, ["警告", "数量", "所在表", "当前影响"], [
        ["父级能力标签未解析", len(parents), "表2", "父子Ontology图不完整；当前画像用能力前缀归并，主链仍可运行"],
        ["type/runtimeUse不一致", len(mismatch), "表4", "可能把可供性当监测或把监测当每轮可供性，改变加载频率和角色"],
        ["Evidence缺少pathRefs", len(no_paths), "表3", "证据能关联能力，但不能说明体现了表2的哪条可接受路径"],
    ], [2500, 900, 1300, 4660], font_size=8.8)
    add_callout(doc, "不能以‘程序能跑’代替‘数据正确’", "程序当前对这些字段采用了保守策略：父标签不做硬路由、AFFORDANCE/MONITOR只作软信息、Evidence仍按claim与原话校验。因此没有立即崩溃。但当未来接入完整RRMC、路径级画像或自动加载优化时，这些警告会转化为真实路由错误。")

    doc.add_heading("2. 建议的治理顺序与总体原则", level=1)
    add_table(doc, ["顺序", "工作", "原因"], [
        ["第一", "修订21条表4路由错配", "判断最清楚、修改量最小、直接关系每轮/低频加载"],
        ["第二", "归一59条表2父能力引用", "多数可由标签前缀映射，但必须人工确认含义"],
        ["第三", "处理表3的55条pathRefs", "需要专业判断；其中50条需逐条映射，5条应显式N/A"],
        ["第四", "重新编译并跑Fixture/Replay", "任何Excel修改都必须产生新指纹并检查旧会话兼容"],
    ], [850, 3000, 5510], font_size=9)
    for text in [
        "不要直接修改编译后的JSON作为长期方案。源Excel是人工治理入口，JSON必须重新生成。",
        "不要为了让警告归零而机械填满字段。每条关联必须能用专业理由解释。",
        "一名专业复核者提出修改，另一名复核者独立检查；程序员不替专业人员决定能力关系。",
        "每次修改都保留旧版本、变更记录、复核人、日期、理由和新配置指纹。",
        "本轮只做数据治理，不改变第一版评分、十题题干、专家赋分或三题遴选算法。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("3. 警告一：59个parentCapabilityIds未解析", level=1)
    add_paragraph(doc, "表2同时包含全局能力C01—C12和每题的情境能力/路径。Q01—Q05的parent_concept_ids写成了‘C02_理解游戏意图与进程’一类带中文说明的标签，而全局正式ID只有C02；Q06—Q10已经使用C01、C04等正式ID。验证器把前者视为不存在的父节点。")
    counts = Counter(x["parent"] for x in parents)
    parent_rows = []
    for label, count in counts.most_common():
        code = label.split("_")[0]
        parent_rows.append([label, code, count, "需核对后替换为正式全局ID"])
    add_table(doc, ["当前标签", "建议父ID", "出现次数", "人工动作"], parent_rows, [3800, 1300, 1000, 3260], font_size=8.4)
    by_q = Counter(x["scope"] for x in parents)
    add_paragraph(doc, "受影响范围：" + "；".join(f"{q} {by_q[q]}处" for q in sorted(by_q)) + "。Q06—Q10没有此类未解析父引用。")

    doc.add_heading("3.1 人工怎么做", level=2)
    steps = restart_numbering(doc, numbering)
    for text in [
        "打开表2 DATA页，筛选question_id=Q01—Q05，并筛选parent_concept_ids中包含下划线和中文说明的记录。",
        "同时查看表2的ALL全局能力行，核对标签前缀C01—C12及正式定义；不能只按编号替换而不看定义。",
        "在人工复核表记录：record_id、capability_concept_id、当前父标签、建议父ID、能力定义一致性、复核理由。",
        "两名复核者都确认后，将Excel中的父值替换为C01—C12正式ID；多父节点继续用原分隔方式并去重保序。",
        "运行跨表校验：所有非空parent_concept_ids必须存在于表2 capability_concept_id；禁止编译器靠字符串前缀猜。",
    ]:
        add_numbered(doc, text, steps)
    add_callout(doc, "示例", "Q01的C02-Q01-PLAY-FRAME当前父标签为C02_理解游戏意图与进程。人工应比较它的定义‘识别自主生成的玩水游戏框架’与全局C02‘游戏意义与儿童意图理解’，确认一致后替换为C02；记录‘语义一致，去除描述后缀，未改变能力含义’。")

    doc.add_heading("3.2 验收标准", level=2)
    for text in [
        "未解析父引用数量从59降为0。",
        "每个情境能力至少有一个合理的全局父能力；多父关系有明确理由。",
        "没有把情境能力ID误写成父ID，也没有把中文能力名当稳定ID。",
        "旧record_id、path_id、capability_concept_id不随此次修订改变，避免无意义兼容破坏。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("4. 警告二：21条policy_type与runtime_use不一致", level=1)
    add_paragraph(doc, "表4的policy_type表达政策在专业上的类别，runtime_use决定编译器把它加载成哪种卡。两者错配时，即使内容不变，程序也可能按错误频率和位置加载。当前包括6条AFFORDANCE被写成MONITOR_CARD，以及15条MONITOR被写成AFFORDANCE_CARD。")
    rows = []
    for item in mismatch:
        row = item["row"]
        rows.append([item["scope"], row.get("policyId"), row.get("type"), row.get("runtimeUse"), item["expected"]])
    add_table(doc, ["范围", "policyId", "type", "当前runtimeUse", "建议runtimeUse"], rows, [720, 2940, 1300, 2100, 2300], font_size=7.8)

    doc.add_heading("4.1 推荐的逐条判断规则", level=2)
    add_table(doc, ["如果政策的核心作用是……", "应使用type", "应使用runtimeUse", "典型特征"], [
        ["给Dialogue Agent可选择的探询姿态或方向", "AFFORDANCE", "AFFORDANCE_CARD", "agentMayDecline通常为true；按当前话语需要选择"],
        ["观察重复、诱导、关系质量、认知负担或停滞", "MONITOR", "MONITOR_CARD", "有eventTriggers/periodicInterval/expirationTurns；低频或事件触发"],
        ["绝对禁止泄露、越权、隐私、危险或多问", "HARD_BOUNDARY", "HARD_BOUNDARY", "constraintLevel=HARD；不可由模型拒绝"],
        ["限定编译和开放性基线", "COMPILATION_BOUNDARY", "COMPILER_BOUNDARY", "主要在会话/编译期使用"],
    ], [3100, 1400, 2200, 2660], font_size=8.4)
    add_paragraph(doc, "从当前ID和字段看，最可能的最小修订是：6条T4G-AFF-001—006将runtime_use改为AFFORDANCE_CARD；15条名称含MONITOR的题目政策将runtime_use改为MONITOR_CARD。原则上不需要改变policy_type、policyId或正文。但人工必须查看trigger、event、periodic和agentMayDecline后确认，不能只按名称批量改。")

    doc.add_heading("4.2 人工怎么做", level=2)
    steps = restart_numbering(doc, numbering)
    for text in [
        "在表4 DATA页筛选上述21个dialogue_policy_id，导出到‘路由错配复核表’。",
        "逐条阅读policy_name、trigger_conditions、event_triggers、periodic_interval、expiration_turns、agent_may_decline和constraint_level。",
        "先回答一个问题：它是在给Dialogue Agent一个可选方向，还是在监测对话是否需要修复？",
        "填写建议runtime_use、判断理由、是否改变触发频率、是否影响当前Fixture。",
        "第二复核者确认后修改Excel；程序员重新编译并验证type→runtimeUse允许矩阵。",
    ]:
        add_numbered(doc, text, steps)
    add_callout(doc, "不要修改成硬边界", "这些21条当前都是AFFORDANCE或MONITOR。即使某条内容很重要，也不能为了‘加强控制’随意改成HARD_BOUNDARY；硬边界必须有明确禁止动作、HARD强度和独立安全/权限理由。", fill=LIGHT_RED, title_color=RED)

    doc.add_heading("5. 警告三：55条证据政策没有pathRefs", level=1)
    add_paragraph(doc, "path_refs用于说明表3某条证据命题能够由表2哪些专业实现路径体现。当前55条全部为空，所以系统只能说‘这段原话与某能力命题有关’，不能说明教师采用了哪一种可接受路径，也无法在画像中呈现多路径差异。")
    add_callout(doc, "先把55条拆成5+50", "ALL范围的5条是RO0—RO4来源政策，作用是定义回答来源，而不是描述专业能力路径。它们应显式标记path_refs不适用。Q01—Q10每题5条、共50条才是EvidenceAnchor，应逐条关联路径或明确声明capability-only。", fill="EAF7F0", title_color=GREEN)
    no_path_by_q = Counter(x["scope"] for x in no_paths)
    add_table(doc, ["范围", "数量", "推荐处理"], [[scope, no_path_by_q[scope], "RO来源政策：显式N/A" if scope == "ALL" else "逐条人工映射表2 path_id"] for scope in ["ALL"] + sorted(k for k in no_path_by_q if k != "ALL")], [1200, 1100, 7060], font_size=9)

    doc.add_heading("5.1 需要增加的字段语义", level=2)
    add_paragraph(doc, "为了避免强行填路径，建议在表3和编译合同中新增一种明确表示：path_relation_mode=PATH_BOUND、CAPABILITY_ONLY或NOT_APPLICABLE，并增加path_relation_reason。若暂不改表结构，至少在uncertainty_note/decision_basis中记录同等信息，并让验证器按claim_type区别处理。")
    add_table(doc, ["类型", "pathRefs要求", "适用情况"], [
        ["ORIGIN_POLICY", "允许为空，但必须NOT_APPLICABLE", "RO0—RO4来源等级，不是专业路径"],
        ["CAPABILITY_EVIDENCE / PATH_BOUND", "至少1个有效path_id", "命题明确对应一种或多种可接受实践路径"],
        ["CAPABILITY_EVIDENCE / CAPABILITY_ONLY", "可为空，但必须写理由并经人工批准", "命题位于能力概念层，不能公平地归到某条具体路径"],
    ], [2500, 2600, 4260], font_size=8.7)

    doc.add_heading("5.2 每条EvidenceAnchor如何人工映射", level=2)
    steps = restart_numbering(doc, numbering)
    for text in [
        "打开表3该条记录，阅读claim_template、applicability_conditions、support_anchors、counterevidence、pseudo_evidence和discriminating_observation。",
        "根据capability_refs在表2找到相关情境能力概念及全部path_id；不要只看相似词。",
        "逐一判断：如果教师通过该路径表达，是否足以使这条证据命题成立？如果只是部分相关，不应加入。",
        "通常选择1—3条真正能够产生该证据的路径；若同一命题设计上覆盖该能力的全部替代路径，应明确写出‘多路径等价’理由。",
        "反向检查：加入pathRef后，系统是否可能把‘没走这条路径’误解释为能力不足？若会，应改为CAPABILITY_ONLY或扩大替代路径集合。",
        "记录选择理由、排除理由、复核人和不确定性；第二人独立复核后再写Excel。",
    ]:
        add_numbered(doc, text, steps)

    doc.add_heading("5.3 Q08完整示例", level=2)
    add_table(doc, ["表3命题", "候选pathRefs", "人工判断理由"], [
        ["Q08-T3-001 识别高度/坡度/受阻位置", "PATH-Q08-001-A/B/C", "三条路径分别通过追踪水流、比较高低、同伴解释验证，把机制变成可观察线索"],
        ["Q08-T3-002 依据尝试/兴趣/状态判断帮助", "PATH-Q08-002-A/B/C", "分别对应继续观察、最轻提示、先处理情绪/时间/拥挤条件"],
        ["Q08-T3-003 分级支架、升级与退出", "PATH-Q08-003-A/B/C", "由提示、比较装置、局部示范形成可升级并交还控制权的阶梯"],
        ["Q08-T3-004 观察—假设—单变量—比较", "PATH-Q08-004-A/B/C", "三条路径都是探究闭环的不同组织方式"],
        ["Q08-T3-005 材料服务于比较和观察", "PATH-Q08-005-A/B/C", "分别通过材料标记、缩小问题、调整人际资源支持观察与再调整"],
    ], [2850, 2500, 4010], font_size=8.2)
    add_callout(doc, "Q08示例只是候选，不是自动决定", "人工仍需对照表3 support_anchors与表2 applicability/exclusion/tradeoffs。如果某条路径只支持命题的一部分，应在表3拆分命题或只保留更准确的路径；不能因为编号顺序一致就自动全选。")

    doc.add_heading("6. 统一的人工—程序协作流程", level=1)
    workflow = [
        ("准备", "数据管理员复制五个V0.1工作簿为工作副本，锁定旧版只读；导出本报告附录清单。"),
        ("专业初审", "专业复核者A提出父ID、runtimeUse或pathRefs建议，并填写理由、风险与不确定性。"),
        ("独立复核", "复核者B不先看A的结论，独立判断；一致项通过，不一致项进入协调会。"),
        ("协调决定", "研究负责人只处理不一致和高风险项；记录最终决定及为什么没有采用另一方案。"),
        ("修改Excel", "数据管理员只修改批准字段，不改稳定ID；更新version、review_status、decision_basis和变更日志。"),
        ("重新编译", "程序员从五表重新生成runtime JSON和新的configFingerprint，禁止手工补JSON。"),
        ("确定性验证", "运行父引用、路径非空/显式N/A、type/runtime矩阵、跨表ID、硬边界、TEVV隔离检查。"),
        ("Fixture/Replay", "至少重跑十题首问、各一条后续回答、诱导/重复/退出/超时/冲突证据夹具；比较修改前后。"),
        ("发布候选", "形成V0.2候选Excel、编译JSON、警告报告、测试报告和迁移说明；研究负责人签字后才替换唯一运行版。"),
    ]
    steps = restart_numbering(doc, numbering)
    for title, body in workflow:
        add_numbered(doc, f"{title}：{body}", steps, bold_prefix=f"{title}：")

    doc.add_heading("6.1 建议的人工复核表字段", level=2)
    add_table(doc, ["字段", "填写说明"], [
        ["issue_type", "PARENT_REF / RUNTIME_ROUTE / PATH_REF"],
        ["workbook / sheet", "表2/表3/表4；通常为DATA页"],
        ["record_id / stable_id", "保持稳定，不因修订改号"],
        ["current_value", "当前Excel值"],
        ["proposed_value", "建议替换值或新增值"],
        ["professional_reason", "基于能力定义、适用条件、证据命题或监测目标说明"],
        ["alternative_considered", "考虑过但未采用的关系/路径/路由"],
        ["risk_if_wrong", "错误后可能造成的路由、证据或画像影响"],
        ["reviewer_A / reviewer_B", "两人结论与日期"],
        ["coordination_decision", "不一致时由研究负责人记录最终决定"],
        ["excel_changed_by / compiled_by", "区分数据修改责任与工程编译责任"],
        ["test_case_ids", "受影响Fixture与Replay编号"],
    ], [2700, 6660], font_size=8.7)

    doc.add_heading("7. 谁做什么，完成后交给谁", level=1)
    add_table(doc, ["角色", "主要工作", "完成后交给"], [
        ["研究负责人", "确认能力体系、争议关系、发布范围和最终风险接受", "数据管理员与程序员"],
        ["专业复核者A", "逐条阅读专业内容并提出映射/路由建议", "专业复核者B"],
        ["专业复核者B", "独立复核并标记一致/不一致", "研究负责人"],
        ["数据管理员", "按批准结论修改Excel、更新版本和变更记录", "程序员"],
        ["程序员/编程AI", "重新编译、生成指纹、运行验证和Fixture；不得代替专业决定", "研究负责人"],
        ["TEVV负责人", "比较前后Replay、切片结果、错误率和画像边界", "研究负责人，决定是否进入候选发布"],
    ], [1600, 4900, 2860], font_size=8.7)

    doc.add_heading("8. 重新加载配置与兼容检查", level=1)
    steps = restart_numbering(doc, numbering)
    for text in [
        "保留V0.1五表和旧runtime JSON，不覆盖历史研究材料。",
        "编译新Excel生成新dataset版本或至少新configFingerprint；source SHA-256必须同步更新。",
        "启动时验证全部主键、跨表引用、强制字段、type/runtime矩阵和releaseScope；失败时禁止回退旧五表。",
        "旧进行中Dialogue Session若保存的是旧指纹，不应静默续接新政策；允许回看，正式继续需新会话或明确迁移。",
        "历史Canonical Evidence保留原policySchemaVersion和policyConfigFingerprint，报告不得用新政策重写旧证据而不留痕。",
        "十题评分与三题遴选对拍必须保持一致；五表治理不应改变确定性评分结果。",
        "比较修改前后问话：关注方向变化、复问率、诱导率、Evidence接受/拒绝、画像维度和平均/P95延时。",
    ]:
        add_numbered(doc, text, steps)

    doc.add_heading("9. 完成定义（Definition of Done）", level=1)
    for text in [
        "三类警告按新规则归零：父引用0；路由错配0；50条EvidenceAnchor有pathRefs或批准的CAPABILITY_ONLY，5条ORIGIN_POLICY为显式NOT_APPLICABLE。",
        "所有修改都有record_id级理由、双人复核和协调记录。",
        "新五表源文件、runtime JSON、source hashes、configFingerprint和版本说明彼此一致。",
        "全量自动测试、十题Fixture、关键Replay与报告画像测试通过。",
        "旧会话兼容策略经过验证，不发生旧证据被新政策静默改写。",
        "发布说明仍明确SIMULATION_ACTIVE，除非真实专家与教师TEVV另行批准。",
    ]:
        add_bullet(doc, text, numbering)

    doc.add_heading("附录A：21条路由错配逐条清单", level=1)
    add_table(doc, ["范围", "policyId", "当前type/runtimeUse", "候选修订"], [[x["scope"], x["row"].get("policyId"), f"{x['row'].get('type')} / {x['row'].get('runtimeUse')}", x["expected"]] for x in mismatch], [850, 3350, 2600, 2560], font_size=8.0)

    doc.add_heading("附录B：59个父标签的分布", level=1)
    details = []
    for parent, count in counts.most_common():
        scopes = sorted({x["scope"] for x in parents if x["parent"] == parent})
        affected = sorted({x["row"].get("capabilityId", "") for x in parents if x["parent"] == parent})
        details.append([parent, parent.split("_")[0], count, "、".join(scopes), "、".join(affected)])
    add_table(doc, ["当前父标签", "候选ID", "次数", "题目", "受影响能力ID"], details, [3000, 900, 700, 900, 3860], font_size=7.6)

    doc.add_heading("附录C：55条无pathRefs记录", level=1)
    path_rows = []
    for item in no_paths:
        row = item["row"]
        recommendation = "NOT_APPLICABLE（来源政策）" if item["scope"] == "ALL" else "人工选择path_id或批准CAPABILITY_ONLY"
        path_rows.append([item["scope"], row.get("evidenceClaimId"), row.get("understandingId"), row.get("recordId"), recommendation])
    add_table(doc, ["范围", "evidenceClaimId", "understandingId", "recordId", "处理"], path_rows, [700, 2750, 1900, 1600, 2410], font_size=7.5)

    doc.add_heading("附录D：人工复核示例记录", level=1)
    add_table(doc, ["字段", "示例"], [
        ["issue_type", "PATH_REF"],
        ["record_id", "T3-Q08-003"],
        ["current_value", "path_refs为空"],
        ["proposed_value", "PATH-Q08-003-A | PATH-Q08-003-B | PATH-Q08-003-C"],
        ["professional_reason", "三条路径共同构成由轻到重、可升级、可交还控制权的支架阶梯，与命题及支持锚点一致"],
        ["alternative_considered", "仅选A；被否决，因为命题要求升级条件，A单独不足以覆盖"],
        ["risk_if_wrong", "若仅绑定A，可能把比较装置或局部示范的合理路径排除；若无差别全绑，会削弱路径区分"],
        ["review_status", "A同意 / B同意 / 研究负责人批准"],
        ["test_case_ids", "FIX-Q08-PATH-01、REPLAY-Q08-03"],
    ], [2800, 6560], font_size=8.7)

    doc.add_heading("附录E：依据文件", level=1)
    for text in [
        "config/new-five-tables/source/ 下五个V0.1唯一运行版Excel。",
        "web/src/generated/tcim-new-five-tables.runtime.v0.1.json。",
        "web/scripts/verify-new-five-runtime.mjs。",
        "docs/dev/new-five-tables-analysis.md。",
        "本报告统计基于当前配置指纹：" + runtime.get("configFingerprint", ""),
    ]:
        add_bullet(doc, text, numbering)

    path = OUT / "TCIM新五表三类数据警告_人工治理操作手册_V0.1.docx"
    doc.core_properties.title = "TCIM新五表三类数据警告与人工治理操作手册"
    doc.core_properties.subject = "父能力引用、对话政策路由和Evidence路径关联治理"
    doc.core_properties.author = "TCIM研究项目"
    doc.save(path)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    runtime = json.loads(RUNTIME_PATH.read_text(encoding="utf-8"))
    outputs = [build_architecture(runtime), build_governance(runtime)]
    print("\n".join(str(path) for path in outputs))


if __name__ == "__main__":
    main()
