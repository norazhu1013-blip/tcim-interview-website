#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TCIM 专家复核预览生成器 —— 把 tcim/professional_data/game_support 的机器 JSON
转成可读的逐题 HTML 校对页，供研究团队核对（不包含任何 AI 改写）。

用法：python tools/build_tcim_review_preview.py [输出目录]
输出：tcim_review_preview.html（单文件，内含 10 题 × 5 表）
"""
import json, os, sys, html

BASE = os.path.join(os.path.dirname(__file__), '..', 'tcim', 'professional_data', 'game_support')

def read(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def esc(s):
    return html.escape(str(s or ''))

def render_slots(ontology):
    rows = []
    for s in ontology['slots']:
        rows.append(f'''<tr>
          <td>{esc(s['slot_id'])}</td>
          <td>{esc(s['name'])}</td>
          <td>{'核心' if s['core'] else '可选'}</td>
          <td>{esc(s['dimension'])}</td>
          <td>{esc(s['definition'])}</td>
          <td>{esc(s['prerequisites'] or '—')}</td>
          <td>{esc(s['allowed_actions'] or '—')}</td>
          <td>{esc(s['forbidden_actions'] or '—')}</td>
          <td>{esc(s['default_priority'])}</td>
        </tr>''')
    return '\n'.join(rows)

def render_anchors(anchors):
    rows = []
    for a in anchors['anchors']:
        rows.append(f'''<tr>
          <td>{esc(a['slot_id'])}</td>
          <td>{esc(a['level_0'])}</td>
          <td>{esc(a['level_1'])}</td>
          <td>{esc(a['level_2'])}</td>
          <td>{esc(a['level_3'])}</td>
          <td>{esc(a.get('false_evidence') or '—')}</td>
          <td>{esc(a.get('conflict_evidence') or '—')}</td>
        </tr>''')
    return '\n'.join(rows)

def render_priority(rules):
    rows = []
    for r in rules['rules']:
        rows.append(f'''<tr>
          <td>{esc(r['condition'])}</td>
          <td>{esc(r['hypothesis'])}</td>
          <td>{esc(r['target_slots'] or '—')}</td>
          <td>{esc(r['priority'])}</td>
          <td>{esc(r['preferred_action'])}</td>
          <td>{esc(r['forbidden_question'] or '—')}</td>
          <td>{esc(r['rationale'])}</td>
        </tr>''')
    return '\n'.join(rows)

def render_probe(probes):
    rows = []
    for p in probes['probes']:
        rows.append(f'''<tr>
          <td>{esc(p['slot_id'])}</td>
          <td>{esc(p['allowed_actions'] or '—')}</td>
          <td>{esc(p['preferred_action'])}</td>
          <td>{esc(p['typical_question'])}</td>
          <td>{esc(p['followup_question'] or '—')}</td>
          <td>{esc(p['forbidden_actions'] or '—')}</td>
          <td>{esc(p['forbidden_question'] or '—')}</td>
          <td>{esc(p['non_inducing_boundary'] or '—')}</td>
        </tr>''')
    return '\n'.join(rows)

def render_stop(rules):
    rows = []
    for r in rules['rules']:
        rows.append(f'''<tr>
          <td>{esc(r['scope'])}</td>
          <td>{esc(r['sufficient_condition'])}</td>
          <td>{esc(r['no_gain_threshold'] or '—')}</td>
          <td>{esc(r['prune_condition'] or '—')}</td>
          <td>{esc(r['reopen_condition'] or '—')}</td>
          <td>{esc(r['shift_condition'] or '—')}</td>
          <td>{esc(r['stop_condition'] or '—')}</td>
          <td>{esc(r['forbidden_stop'] or '—')}</td>
        </tr>''')
    return '\n'.join(rows)

def render_item(item):
    ontology = item['ontology']
    anchors = item['anchors']
    priority = item['priority']
    probe = item['probe']
    stop = item['stop']
    meta = item['metadata']
    qid = item['item_id']
    title = esc(ontology.get('title') or meta.get('title') or qid)
    return f'''
<section class="item" id="{qid}">
  <h2>{qid} · {title}</h2>
  <p class="stem"><strong>情境：</strong>{esc(ontology['stem'])}</p>
  <p class="options">
    <strong>选项：</strong>
    {''.join(f'<span class="opt"><b>{k}</b> {esc(ontology['options'][k])}</span>' for k in 'ABCD')}
  </p>
  <p><strong>主指标：</strong>{esc(ontology['primary_indicator'])}</p>
  <p><strong>次指标：</strong>{esc(ontology['secondary_indicator'])}</p>
  <p><strong>访谈诊断焦点：</strong>{esc(ontology['diagnostic_focus'])}</p>
  <p><strong>实证赋分（metadata）：</strong>
    4分={esc(meta['empirical']['4'])} 3分={esc(meta['empirical']['3'])} 2分={esc(meta['empirical']['2'])} 1分={esc(meta['empirical']['1'])} 0分={esc(meta['empirical']['0'])}
  </p>

  <h3>表1 题目专业本体（slot）</h3>
  <table><thead><tr><th>Slot</th><th>名称</th><th>核心</th><th>维度</th><th>定义</th><th>前置</th><th>允许动作</th><th>禁用动作</th><th>优先级</th></tr></thead>
  <tbody>{render_slots(ontology)}</tbody></table>

  <h3>表2 EvidenceSlot 证据锚点</h3>
  <table><thead><tr><th>Slot</th><th>0 未获得</th><th>1 初步</th><th>2 基本充分</th><th>3 高质量</th><th>伪证据</th><th>冲突证据</th></tr></thead>
  <tbody>{render_anchors(anchors)}</tbody></table>

  <h3>表3 前测→优先级规则</h3>
  <table><thead><tr><th>触发条件</th><th>待验证假设</th><th>目标Slot</th><th>优先级</th><th>首选动作</th><th>不应问法</th><th>理由</th></tr></thead>
  <tbody>{render_priority(priority)}</tbody></table>

  <h3>表4 谈话动作与限制（探查）</h3>
  <table><thead><tr><th>目标Slot</th><th>允许动作</th><th>首选</th><th>典型非诱导问法</th><th>可接受跟进</th><th>禁用动作</th><th>不应问法</th><th>非诱导边界</th></tr></thead>
  <tbody>{render_probe(probe)}</tbody></table>

  <h3>表5 剪枝与结束规则</h3>
  <table><thead><tr><th>分支</th><th>充分条件</th><th>无增益阈值</th><th>剪枝</th><th>重开</th><th>转向</th><th>停止</th><th>禁止停止</th></tr></thead>
  <tbody>{render_stop(stop)}</tbody></table>
</section>'''

def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'tcim_review_preview.html')
    registry = read(os.path.join(BASE, 'common', 'item_registry.json'))
    items = {}
    for item in registry['items']:
        qid = item['item_id']
        qdir = f'q{int(qid[1:]):02d}'
        base = os.path.join(BASE, 'questions', qdir)
        items[qid] = {
            'item_id': qid,
            'ontology': read(os.path.join(base, 'ontology.json')),
            'anchors': read(os.path.join(base, 'evidence_anchors.json')),
            'priority': read(os.path.join(base, 'priority_rules.json')),
            'probe': read(os.path.join(base, 'probe_rules.json')),
            'stop': read(os.path.join(base, 'stop_rules.json')),
            'metadata': read(os.path.join(base, 'metadata.json')),
        }
    sections = '\n'.join(render_item(items[k]) for k in sorted(items.keys()))
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>TCIM 5表专家复核预览</title>
<style>
  body{{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;background:#f6f8fa;color:#182033}}
  h1{{font-size:22px}} .meta{{color:#666;font-size:13px}}
  .item{{background:#fff;border:1px solid #e2e6ee;border-radius:12px;padding:20px;margin-bottom:28px}}
  h2{{font-size:18px;border-left:4px solid #3f63d6;padding-left:10px}}
  h3{{font-size:14px;color:#3f63d6;margin-top:20px}}
  .stem{{font-size:14px;color:#333}} .options{{display:flex;gap:8px;flex-wrap:wrap}}
  .opt{{border:1px solid #d7dce7;border-radius:8px;padding:4px 8px;font-size:13px;background:#fbfcfe}}
  table{{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}}
  th,td{{border:1px solid #e2e6ee;padding:6px 8px;text-align:left;vertical-align:top}}
  th{{background:#f0f3fa;font-weight:700;white-space:nowrap}}
</style></head><body>
<h1>TCIM 5 表专家复核预览</h1>
<p class="meta">数据源：DOC/数据表 5个.zip（AI 前置打样 V0.1）→ tcim/professional_data/game_support。共 {len(items)} 题。仅供研究团队逐题核对，不含 AI 改写。</p>
{sections}
</body></html>'''
    with open(out_dir, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'已生成专家复核预览: {out_dir}')

if __name__ == '__main__':
    main()
