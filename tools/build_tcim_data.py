#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TCIM Task 2 —— 5 张专业表 × 10 题数据化。

输入：DOC/数据表 5个.zip 解压后的 5 个 xlsx（每张 10 个 sheet，一题一页）。
输出：tcim/professional_data/game_support/
        ├── common/
        │   ├── item_registry.json
        │   ├── ability_framework.json
        │   ├── item_capability_mapping.json
        │   └── empirical_scoring_rules.json
        └── questions/q01..q10/
            ├── ontology.json
            ├── evidence_anchors.json
            ├── priority_rules.json
            ├── probe_rules.json
            ├── stop_rules.json
            └── metadata.json

数据为「AI 前置打样 V0.1」，是当前可工程化的专业规则源；不得由 AI 运行时改写。
Source of Truth = DOC/数据表 5个.zip。重跑本脚本即从原始文件重新生成。

用法：python tools/build_tcim_data.py <解压后目录> <输出目录>
      python tools/build_tcim_data.py --verify-only <输出目录>   # 只做跨表校验
"""
import sys, os, re, json, zipfile

SOURCE_VERSION = '2026-08-21-tcim-v0.1-ai-draft'
XLSX_FILES = [
    '01_10道游戏题_题目专业本体表_每题一页_AI打样.xlsx',   # ontology
    '02_10道游戏题_EvidenceSlot证据锚点表_每题一页_AI打样.xlsx',  # evidence anchors
    '03_10道游戏题_前测资料到访谈优先级规则表_每题一页_AI打样.xlsx',  # priority rules
    '04_10道游戏题_谈话动作与限制表_每题一页_AI打样.xlsx',  # probe rules
    '05_10道游戏题_剪枝与结束规则表_每题一页_AI打样.xlsx',  # stop rules
]

# 每张表的表头首列关键字 → 该表的列名（用于把「按位置」读出的行映射成 dict）
TABLE_HEADERS = {
    'ontology': ['Dimension', 'Slot编号'],
    'anchors': ['Slot', '0 未获得'],
    'priority': ['触发条件'],
    'probe': ['目标Slot'],
    'stop': ['Slot/分支'],
}


def extract_sheets(xlsx_path):
    """返回 list[list[dict]]：每张 sheet 的每行 = {col_letter: value}。"""
    sheets = []
    try:
        z = zipfile.ZipFile(xlsx_path)
    except Exception as e:
        raise SystemExit(f'无法打开 {xlsx_path}: {e}')

    names = sorted([n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml', n)],
                   key=lambda n: int(re.search(r'sheet(\d+)', n).group(1)))
    for sh in names:
        xml = z.read(sh).decode('utf-8', 'ignore')
        rows = []
        for row in re.findall(r'<x:row[^>]*>.*?</x:row>', xml, re.S):
            cells = {}
            for cell in re.findall(r'<x:c[^>]*r="([A-Z]+)\d+"[^>]*>(.*?)</x:c>', row, re.S):
                ref, inner = cell
                val = ''
                m = re.search(r'<x:v>([^<]*)</x:v>', inner)
                if m:
                    val = m.group(1)
                else:
                    texts = re.findall(r'<x:t[^>]*>([^<]*)</x:t>', inner)
                    val = ''.join(texts)
                cells[ref] = val.strip()
            rows.append(cells)
        sheets.append(rows)
    return sheets


def qnum_from_title(title):
    m = re.search(r'第\s*(\d{1,2})\s*题', title or '')
    return int(m.group(1)) if m else None


def split_pipe(v):
    """按 | 切分，去空。"""
    if not v:
        return []
    return [x.strip() for x in str(v).split('|') if x.strip()]


def split_multi(v):
    """按 , ， 、 ; ； | 切分，去空，剔除占位符（无/暂无/—）。"""
    if not v:
        return []
    parts = re.split(r'[,，、;；|]', str(v))
    out = []
    for p in parts:
        p = p.strip()
        if not p or p in ('无', '暂无', '—', '-'):
            continue
        out.append(p)
    return out


def col_a(row):
    """取行的第 A 列值；无 A 则取最小列字母。"""
    if 'A' in row:
        return row['A']
    if not row:
        return ''
    return row[min(row.keys(), key=lambda L: (len(L), L))]


def parse_table_rows(rows, header):
    """在 rows 中定位表头行（第 A 列匹配表头关键字），返回表头+数据行。"""
    hdr_idx = None
    for i, row in enumerate(rows):
        first = col_a(row)
        if any(k in first for k in header):
            hdr_idx = i
            break
    if hdr_idx is None:
        return [], []
    hdr_row = rows[hdr_idx]
    # 列名顺序 = 表头行按列号排序的值
    letters = sorted(hdr_row.keys(), key=lambda L: (len(L), L))
    colnames = [hdr_row.get(L, '') for L in letters]
    data = []
    for row in rows[hdr_idx + 1:]:
        if not row:
            continue
        rec = {}
        for L, name in zip(letters, colnames):
            rec[name] = row.get(L, '')
        # 跳过整行为空
        if not any(rec.get(name, '').strip() for name in colnames):
            continue
        data.append(rec)
    return colnames, data


def parse_question_sheet(rows):
    """解析一题的 sheet：intro 字段 + 表格。返回 (intro, table_rows_raw)。"""
    intro = {}
    # 前若干行是 intro：情境/A-D/主指标/次指标/访谈诊断焦点/实证高分组合/实证中低分组合/赋分校准解释/专家复核关注/版本
    for row in rows:
        cells = sorted(row.items(), key=lambda kv: (len(kv[0]), kv[0]))
        if not cells:
            continue
        key = cells[0][1].strip()
        val = cells[1][1].strip() if len(cells) > 1 else ''
        if not key or key.startswith('Dimension') or key.startswith('Slot编号'):
            break
        if key in ('情境', 'A', 'B', 'C', 'D', '主指标', '次指标', '访谈诊断焦点',
                   '实证高分组合', '实证中低分组合', '赋分校准解释', '专家复核关注', '版本'):
            intro[key] = val
        elif '第' in key and '题' in key:
            intro['_title'] = key
    return intro


def build_ontology_from_table1(intro, table_rows):
    """表1 → ontology.json 结构。"""
    slots = []
    for rec in table_rows:
        name = rec.get('Evidence Slot', '')
        slot_id = rec.get('Slot编号', '')
        if not slot_id and not name:
            continue
        # 有些行的 Slot编号 形如 "Q1-S1"；name 形如 "自主游戏意义识别"
        core = str(rec.get('核心/可选', '')).strip()
        pre = split_multi(rec.get('前置Slot', ''))
        slots.append({
            'slot_id': slot_id,
            'dimension': rec.get('Dimension', ''),
            'name': name,
            'definition': rec.get('Slot定义', ''),
            'diagnostic_meaning': rec.get('诊断意义', ''),
            'core': '核心' in core,
            'prerequisites': pre,
            'allowed_actions': split_pipe(rec.get('可触发动作', '')),
            'forbidden_actions': split_pipe(rec.get('禁用动作', '')),
            'default_priority': rec.get('默认优先级', ''),
            'empirical_relation': rec.get('与实证赋分/题面关系', ''),
            'calibration_note': rec.get('专家校准意见', ''),
        })
    return {
        'item_id': intro.get('_item_id'),
        'title': intro.get('_short'),
        'stem': intro.get('情境', ''),
        'options': {k: intro.get(k, '') for k in 'ABCD'},
        'primary_indicator': intro.get('主指标', ''),
        'secondary_indicator': intro.get('次指标', ''),
        'diagnostic_focus': intro.get('访谈诊断焦点', ''),
        'slots': slots,
    }


def build_anchors_from_table2(table_rows):
    anchors = []
    for rec in table_rows:
        slot = rec.get('Slot', '')
        if not slot:
            continue
        slot_id = slot.split()[0] if slot else ''
        anchors.append({
            'slot_id': slot_id,
            'level_0': rec.get('0 未获得', ''),
            'level_1': rec.get('1 初步获得', ''),
            'level_2': rec.get('2 基本充分', ''),
            'level_3': rec.get('3 高质量', ''),
            'false_evidence': rec.get('典型伪证据/冲突证据', '').split('冲突：')[0].replace('伪证据：', '').strip(),
            'conflict_evidence': (rec.get('典型伪证据/冲突证据', '').split('冲突：')[1] if '冲突：' in rec.get('典型伪证据/冲突证据', '') else '').strip(),
            'calibration_note': rec.get('专家校准意见', ''),
        })
    return anchors


def build_priority_from_table3(table_rows):
    rules = []
    for rec in table_rows:
        cond = rec.get('触发条件', '')
        if not cond:
            continue
        rules.append({
            'condition': cond,
            'hypothesis': rec.get('待验证假设', ''),
            'target_slots': split_multi(rec.get('目标Slot', '')),
            'priority': rec.get('优先级P1/P2/P3', ''),
            'preferred_action': rec.get('首选动作', ''),
            'forbidden_question': rec.get('不应采用的问法', ''),
            'rationale': rec.get('规则理由', ''),
            'calibration_note': rec.get('专家校准意见', ''),
        })
    return rules


def build_probe_from_table4(table_rows):
    probes = []
    for rec in table_rows:
        slot = rec.get('目标Slot', '')
        if not slot:
            continue
        slot_id = slot.split()[0] if slot else ''
        probes.append({
            'slot_id': slot_id,
            'allowed_actions': split_pipe(rec.get('允许动作', '')),
            'preferred_action': rec.get('首选动作', ''),
            'typical_question': rec.get('典型非诱导问法', ''),
            'followup_question': rec.get('可接受跟进', ''),
            'forbidden_actions': split_pipe(rec.get('禁用动作', '')),
            'forbidden_question': rec.get('不应采用的问法', ''),
            'non_inducing_boundary': rec.get('非诱导边界', ''),
            'calibration_note': rec.get('专家校准意见', ''),
        })
    return probes


def build_stop_from_table5(table_rows):
    rules = []
    for rec in table_rows:
        scope = rec.get('Slot/分支', '')
        if not scope:
            continue
        rules.append({
            'scope': scope,
            'sufficient_condition': rec.get('充分条件', ''),
            'no_gain_threshold': rec.get('连续无增益阈值', ''),
            'prune_condition': rec.get('剪枝条件', ''),
            'reopen_condition': rec.get('重开条件', ''),
            'shift_condition': rec.get('转向条件', ''),
            'stop_condition': rec.get('单题/分支停止条件', ''),
            'forbidden_stop': rec.get('禁止停止条件', ''),
            'calibration_note': rec.get('专家校准意见', ''),
        })
    return rules


def extract_empirical(intro):
    # 表内格式："实证高分组合 | 4分：ABCD, ACBD, CABD；3分：ABDC, BCAD, CBAD"
    #          "实证中低分组合 | 2分：ACDB,...；1分：ADBC,...；0分：BDCA,..."
    by_score = {'4': [], '3': [], '2': [], '1': [], '0': []}
    for raw in ('实证高分组合', '实证中低分组合'):
        for seg in str(intro.get(raw, '')).split('；'):
            m = re.match(r'(\d)分[:：]\s*(.*)', seg.strip())
            if not m:
                continue
            score = int(m.group(1))
            if score in (0, 1, 2, 3, 4):
                perms = [p.strip() for p in m.group(2).split(',') if p.strip()]
                by_score[str(score)].extend(perms)
    return by_score


def build_all(input_dir, output_dir):
    """读取 5 张表，生成所有 JSON。返回 (files_written, summary)。"""
    table_datas = {}
    for kind, fname in zip(['ontology', 'anchors', 'priority', 'probe', 'stop'], XLSX_FILES):
        path = os.path.join(input_dir, fname)
        if not os.path.exists(path):
            raise SystemExit(f'缺少输入文件: {path}')
        sheets = extract_sheets(path)
        table_datas[kind] = sheets

    os.makedirs(os.path.join(output_dir, 'common'), exist_ok=True)
    for i in range(1, 11):
        os.makedirs(os.path.join(output_dir, 'questions', f'q{i:02d}'), exist_ok=True)

    items = []
    ability_rows = []   # (primary, secondary, primary_sub, secondary_sub)
    summary = []

    for q in range(1, 11):
        qid = f'Q{q}'
        qdir = f'q{q:02d}'
        intro = {}
        slots_data = None
        anchors = None
        priority = None
        probe = None
        stop = None

        for kind in ['ontology', 'anchors', 'priority', 'probe', 'stop']:
            sheets = table_datas[kind]
            sheet = sheets[q - 1]
            # 提取 intro（每张表同一题的前几行相同）
            qintro = parse_question_sheet(sheet)
            if kind == 'ontology':
                intro = qintro
                intro['_item_id'] = qid
                intro['_short'] = re.sub(r'第\s*\d{1,2}\s*题\s*', '', qintro.get('_title', '')).split('｜')[0].strip()
            header = TABLE_HEADERS[kind]
            colnames, table_rows = parse_table_rows(sheet, header)
            if kind == 'ontology':
                slots_data = build_ontology_from_table1(intro, table_rows)
            elif kind == 'anchors':
                anchors = build_anchors_from_table2(table_rows)
            elif kind == 'priority':
                priority = build_priority_from_table3(table_rows)
            elif kind == 'probe':
                probe = build_probe_from_table4(table_rows)
            elif kind == 'stop':
                stop = build_stop_from_table5(table_rows)

        if slots_data is None or anchors is None or priority is None or probe is None or stop is None:
            raise SystemExit(f'第 {q} 题解析不完整: slots={bool(slots_data)} anchors={bool(anchors)} priority={bool(priority)} probe={bool(probe)} stop={bool(stop)}')

        slots_data['item_id'] = qid
        ontology = slots_data
        metadata = {
            'item_id': qid,
            'title': intro.get('_short', ''),
            'primary_indicator': intro.get('主指标', ''),
            'secondary_indicator': intro.get('次指标', ''),
            'diagnostic_focus': intro.get('访谈诊断焦点', ''),
            'empirical': extract_empirical(intro),
            'scoring_note': intro.get('赋分校准解释', ''),
            'review_note': intro.get('专家复核关注', ''),
            'source_version': SOURCE_VERSION,
            'source': 'DOC/数据表 5个.zip',
        }
        # 能力映射
        primary_full = intro.get('主指标', '')
        secondary_full = intro.get('次指标', '')
        # 主指标格式："游戏支持与指导 → 对游戏行为的分析与回应｜介入时机的把握；介入方式的适宜有效性"
        def parse_capability(s):
            parts = [p.strip() for p in str(s).split('｜')]
            first = parts[0] if parts else ''
            arrow = [p.strip() for p in first.split('→')]
            return arrow, (parts[1] if len(parts) > 1 else '')
        prim_arrow, prim_detail = parse_capability(primary_full)
        sec_arrow, sec_detail = parse_capability(secondary_full)
        ability_rows.append({
            'item_id': qid,
            'title': intro.get('_short', ''),
            'primary': {'hierarchy': prim_arrow, 'detail': prim_detail, 'raw': primary_full},
            'secondary': {'hierarchy': sec_arrow, 'detail': sec_detail, 'raw': secondary_full},
        })

        items.append({'item_id': qid, 'title': intro.get('_short', ''), 'diagnostic_focus': intro.get('访谈诊断焦点', '')})

        writes = {
            'ontology.json': ontology,
            'evidence_anchors.json': {'item_id': qid, 'anchors': anchors},
            'priority_rules.json': {'item_id': qid, 'rules': priority},
            'probe_rules.json': {'item_id': qid, 'probes': probe},
            'stop_rules.json': {'item_id': qid, 'rules': stop},
            'metadata.json': metadata,
        }
        for fname, data in writes.items():
            with open(os.path.join(output_dir, 'questions', qdir, fname), 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

        summary.append({
            'item_id': qid,
            'title': intro.get('_short', ''),
            'slots': len(slots_data['slots']),
            'anchors': len(anchors),
            'priority_rules': len(priority),
            'probe_rules': len(probe),
            'stop_rules': len(stop),
        })

    # common
    item_registry = {'version': SOURCE_VERSION, 'items': items}
    with open(os.path.join(output_dir, 'common', 'item_registry.json'), 'w', encoding='utf-8') as f:
        json.dump(item_registry, f, ensure_ascii=False, indent=2)

    # ability framework: 汇总出现的指标体系层级（三级指标规范名）
    frameworks = {}
    for r in ability_rows:
        for side in ('primary', 'secondary'):
            hier = r[side]['hierarchy']
            if len(hier) >= 2:
                frameworks.setdefault(hier[0], set()).add(hier[1])
    ability_framework = {
        'version': SOURCE_VERSION,
        'framework': {k: sorted(v) for k, v in sorted(frameworks.items())},
    }
    with open(os.path.join(output_dir, 'common', 'ability_framework.json'), 'w', encoding='utf-8') as f:
        json.dump(ability_framework, f, ensure_ascii=False, indent=2)

    with open(os.path.join(output_dir, 'common', 'item_capability_mapping.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': SOURCE_VERSION, 'mapping': ability_rows}, f, ensure_ascii=False, indent=2)

    # empirical scoring rules
    emp = {}
    for q in range(1, 11):
        meta = json.load(open(os.path.join(output_dir, 'questions', f'q{q:02d}', 'metadata.json'), encoding='utf-8'))
        emp[meta['item_id']] = meta['empirical']
    with open(os.path.join(output_dir, 'common', 'empirical_scoring_rules.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': SOURCE_VERSION, 'empirical': emp}, f, ensure_ascii=False, indent=2)

    return summary


def validate(output_dir):
    """跨表校验：slot 唯一性、引用完整性、核心 Slot 可执行性。返回 (errors, warnings, report_rows)。"""
    errors = []
    warnings = []
    report = []
    registry = json.load(open(os.path.join(output_dir, 'common', 'item_registry.json'), encoding='utf-8'))
    for item in registry['items']:
        qid = item['item_id']
        qdir = f'q{int(qid[1:]):02d}'
        base = os.path.join(output_dir, 'questions', qdir)
        ontology = json.load(open(os.path.join(base, 'ontology.json'), encoding='utf-8'))
        anchors = json.load(open(os.path.join(base, 'evidence_anchors.json'), encoding='utf-8'))['anchors']
        priority = json.load(open(os.path.join(base, 'priority_rules.json'), encoding='utf-8'))['rules']
        probe = json.load(open(os.path.join(base, 'probe_rules.json'), encoding='utf-8'))['probes']
        stop = json.load(open(os.path.join(base, 'stop_rules.json'), encoding='utf-8'))['rules']

        slots = ontology['slots']
        slot_ids = [s['slot_id'] for s in slots]
        # 1) slot 唯一
        seen = set()
        for sid in slot_ids:
            if sid in seen:
                errors.append(f'{qid}: 重复 slot {sid}')
            seen.add(sid)
        # 2) 前置引用
        for s in slots:
            for pre in s['prerequisites']:
                if pre not in slot_ids:
                    errors.append(f'{qid}: {s["slot_id"]} 前置 {pre} 未定义')
        # 3) 核心 slot 必须有 anchor、probe、priority 可达、stop 关系
        core_slots = [s for s in slots if s['core']]
        anchor_ids = {a['slot_id'] for a in anchors}
        probe_ids = {p['slot_id'] for p in probe}
        priority_targets = set()
        for r in priority:
            priority_targets.update(r['target_slots'])
        stop_refs = set()
        for r in stop:
            # scope 形如 "Q1-S1~S2 游戏意义/风险" 或 "整题"
            m = re.findall(r'(Q\d-S\d+)', r['scope'])
            stop_refs.update(m)
        for s in core_slots:
            if s['slot_id'] not in anchor_ids:
                errors.append(f'{qid}: 核心 slot {s["slot_id"]} 缺 evidence_anchor')
            if s['slot_id'] not in probe_ids:
                errors.append(f'{qid}: 核心 slot {s["slot_id"]} 缺 probe 配置')
            if s['slot_id'] not in priority_targets and s['default_priority']:
                warnings.append(f'{qid}: {s["slot_id"]} 未被 priority_rules 引用（仅默认优先级）')
        # 4) anchor/probe/priority 引用不存在 slot
        for a in anchors:
            if a['slot_id'] not in slot_ids:
                errors.append(f'{qid}: anchor 引用未定义 slot {a["slot_id"]}')
        for p in probe:
            if p['slot_id'] not in slot_ids:
                errors.append(f'{qid}: probe 引用未定义 slot {p["slot_id"]}')
        for r in priority:
            for t in r['target_slots']:
                if t not in slot_ids:
                    errors.append(f'{qid}: priority 引用未定义 slot {t}')
        # 5) 每个核心 slot 的 anchor 至少 0-3 齐全
        for a in anchors:
            for lv in ('level_0', 'level_1', 'level_2', 'level_3'):
                if not a[lv]:
                    warnings.append(f'{qid}: {a["slot_id"]} anchor {lv} 为空')

        report.append({
            'item_id': qid,
            'slots': len(slots),
            'core': len(core_slots),
            'anchors': len(anchors),
            'priority_rules': len(priority),
            'probe_rules': len(probe),
            'stop_rules': len(stop),
        })
    return errors, warnings, report


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == '--verify-only':
        output_dir = sys.argv[2]
        errors, warnings, report = validate(output_dir)
    else:
        input_dir = sys.argv[1]
        output_dir = sys.argv[2] if len(sys.argv) > 2 else 'tcim/professional_data/game_support'
        summary = build_all(input_dir, output_dir)
        errors, warnings, report = validate(output_dir)
        print('=== 生成汇总 ===')
        print(f"{'item':6}{'题名':16}{'slots':>6}{'anchors':>8}{'priority':>9}{'probe':>7}{'stop':>6}")
        for r in summary:
            print(f"{r['item_id']:6}{r['title'][:12]:16}{r['slots']:>6}{r['anchors']:>8}{r['priority_rules']:>9}{r['probe_rules']:>7}{r['stop_rules']:>6}")

    print('\n=== 跨表校验 ===')
    print(f'errors={len(errors)} warnings={len(warnings)}')
    for e in errors:
        print('  [ERROR]', e)
    for w in warnings:
        print('  [warn ]', w)
    if errors:
        raise SystemExit('校验未通过，存在错误')
    print('跨表校验通过')


if __name__ == '__main__':
    main()
