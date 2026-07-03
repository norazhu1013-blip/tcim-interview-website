/**
 * 生成 miniprogram/data/knowledge.js —— 全 10 题真实知识库（对齐 13 表结构）。
 * 数据取自 DOC/10个题目的知识库/第1..10题_*.xlsx（x: 命名空间，见 CLAUDE.md §6）。
 * 10 份 xlsx 存在两套列模板（触发规则编号/Q码 与 触发编号/S码），本脚本按「表头关键词」
 * 通用取列，把两套都归一到统一结构；追问脚本码归一到 09 表定义的基码 Q1..Q7/Q-stop，
 * 触发/偏误引用中不存在于本题 09 的脚本码被过滤（保留原文于 *_raw），保证引用皆存在。
 * 运行：node tools/build_knowledge.js
 */
const fs = require('fs');
const path = require('path');
const ex = require('./_extract.js');
const { SCORES } = require('../miniprogram/data/scoreTable.js');

const KBDIR = path.join(__dirname, '..', 'DOC', '10个题目的知识库');
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'knowledge.js');

// 生成 data 文件里“原样输出”的函数源码（test(ranking) 直接可执行）
function RAW(code) { return { __raw: code }; }

/** 从赋分表派生每题“首位放某选项”的平均分，用于稳健判定 risk/highValue */
function avgWhenFirst(itemId, opt) {
  const t = SCORES[itemId] || {};
  const vals = Object.keys(t).filter((k) => k.split('>')[0] === opt).map((k) => t[k]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
/** 综合 04 paths 关键词 + 赋分表，确定 risk 选项(1) 与 highValue 选项(1-2) */
function deriveRiskHV(itemId, paths) {
  const txt = (p) => (p.type || '') + (p.suggest_pos || '') + (p.reason || '');
  let hv = paths.filter((p) => /高分|高价值|锚点|优先/.test(txt(p)) && !/风险|不宜|较低|极低/.test(p.type || '')).map((p) => p.option);
  let risk = paths.filter((p) => /风险|不宜靠前|得分极低|得分最低|较低/.test(txt(p))).map((p) => p.option);
  const byScore = ['A', 'B', 'C', 'D'].map((o) => ({ o: o, a: avgWhenFirst(itemId, o) })).sort((x, y) => y.a - x.a);
  if (!hv.length) hv = [byScore[0].o, byScore[1].o];
  if (!risk.length) risk = [byScore[byScore.length - 1].o];
  hv = ex.uniq(hv).slice(0, 2);
  risk = ex.uniq(risk.filter((o) => hv.indexOf(o) < 0));
  if (!risk.length) risk = [byScore[byScore.length - 1].o];
  return { risk: risk[0], hv: hv };
}

const E_NAME = { E1: '指标定位', E2: '游戏意义识别', E3: '观察分析', E4: '介入时机', E5: '支架具体性', E6: '长期效果', E7: '文化适宜' };
const SELECTION_RULES = {
  process_thresholds: { dur_p75_ms: 70000, dur_p90_ms: 100000, dur_p25_ms: 25000, revise_enhance: 2, revise_strong: 4 },
  R: { pick: 2, basis: 'RD绝对值降序(结果性偏离)' },
  P: { pick: 2, basis: 'P-IVI/过程异常降序' },
  G: { pick: 2, basis: '结果-过程关系最值得解释' },
  merge: { final_count: 3, dedup: true, coverage_rule: '尽量不选3道主二级指标相同的题(8题主指标为C)' }
};

function kbFileFor(n) { return fs.readdirSync(KBDIR).find((f) => new RegExp('^第' + n + '题_').test(f) && !f.startsWith('~$')); }
function infoDict(sheets) { const d = {}; (sheets['01基本信息'] || []).forEach((r) => { if (r.A && r.B) d[r.A.trim()] = r.B.trim(); }); return d; }

/** 定位表头行（A 列匹配 headerRe 且该行 ≥3 个非空单元格，排除标题/说明行），返回 {cols, rows} */
function table(sheet, headerRe) {
  if (!sheet) return { cols: {}, rows: [] };
  const hi = sheet.findIndex((r) => headerRe.test((r.A || '').trim()) && Object.keys(r).length >= 3);
  if (hi < 0) return { cols: {}, rows: [] };
  const cols = {};
  Object.keys(sheet[hi]).forEach((letter) => { const t = (sheet[hi][letter] || '').trim(); if (t) cols[t] = letter; });
  const rows = sheet.slice(hi + 1).filter((r) => (r.A || '').trim());
  return { cols: cols, rows: rows };
}
/** 按表头关键词取单元格（首个包含任一关键词的列） */
function pick(cols, row, keywords) {
  for (const kw of keywords) {
    const h = Object.keys(cols).find((h) => h.indexOf(kw) >= 0);
    if (h) { const v = row[cols[h]]; if (v != null && v !== '') return v; }
  }
  return '';
}

function buildItem(n) {
  const s = ex.xlsxSheetsX(path.join(KBDIR, kbFileFor(n)));
  const info = infoDict(s);

  // 09 脚本（先建，供触发/偏误校验引用）
  const scripts = {};
  const t09 = table(s['09追问脚本'], /脚本编号|编号/);
  t09.rows.filter((r) => /^Q\d$/.test((r.A || '').trim()) || (r.A || '').trim() === 'Q-stop').forEach((r) => {
    const code = r.A.trim();
    scripts[code] = {
      stage: pick(t09.cols, r, ['阶段']),
      applies: pick(t09.cols, r, ['适用']),
      q: pick(t09.cols, r, ['AI可用问题', '问题', '第一问']),
      goal: pick(t09.cols, r, ['诊断目标', '目标']),
      E: ex.parseEcodes(pick(t09.cols, r, ['希望获得的证据', '证据'])),
      next: pick(t09.cols, r, ['下一步去向', '去向', '下一步'])
    };
  });
  const scriptExists = (c) => Object.prototype.hasOwnProperty.call(scripts, c);
  const normScripts = (raw) => {
    const codes = ex.parseQcodes(raw).filter(scriptExists);
    if (codes.length) return codes;
    const fb = [];
    if (scriptExists('Q1')) fb.push('Q1');
    if (scriptExists('Q-stop')) fb.push('Q-stop');
    return fb.length ? fb : Object.keys(scripts).slice(0, 1);
  };

  // 04 路径（各题表头/选项列位置不一，用关键词+首字母兜底）
  const leadOption = (t) => { const m = (t || '').match(/^\s*([A-D])(?![A-Za-z])/); return m ? m[1] : null; };
  const t04 = table(s['04首末位排序'], /路径类别|类别|路径|线索|锚点类型|选项/);
  const paths = t04.rows.map((r) => {
    const optCell = pick(t04.cols, r, ['对应选项', '选项', '排序']) || r.B || '';
    const option = ex.firstLetter(optCell) || leadOption(optCell) || leadOption(r.A) || leadOption(r.B);
    if (!option) return null;
    return {
      option: option, type: r.A || '', suggest_pos: pick(t04.cols, r, ['建议解释位置', '位置']),
      reason: pick(t04.cols, r, ['核心理由', '理由']), not_denying: pick(t04.cols, r, ['不是在否定', '不是']),
      evidence: ex.parseEcodes(pick(t04.cols, r, ['能力证据', '证据'])),
      rel_bias: pick(t04.cols, r, ['偏误']), rel_trigger: pick(t04.cols, r, ['触发'])
    };
  }).filter(Boolean);

  // 06 证据点
  const t06 = table(s['06能力证据点'], /证据编号|编号/);
  const evidence_points = t06.rows.filter((r) => /^E\d$/.test((r.A || '').trim())).map((r) => ({
    code: r.A.trim(), name: pick(t06.cols, r, ['关键能力证据点', '证据点', '能力']),
    high: pick(t06.cols, r, ['高质量', '高水平', '高']), low: pick(t06.cols, r, ['低水平', '缺失', '低']),
    from: pick(t06.cols, r, ['可从哪些', '看出', '选项']), triggers: ex.parseTcodes(pick(t06.cols, r, ['触发'])),
    anchor: pick(t06.cols, r, ['评分锚点', '锚点'])
  }));

  // 07 偏误
  const t07 = table(s['07首末位偏误'], /偏误编号|编号/);
  const biases = t07.rows.filter((r) => /^P\d$/.test((r.A || '').trim())).map((r) => ({
    code: r.A.trim(), name: pick(t07.cols, r, ['偏误类型', '偏误名称', '类型', '名称']),
    signal: pick(t07.cols, r, ['首/末位表征', '表征', '典型排序', '排序信号', '排序表现', '首', '典型']),
    why: pick(t07.cols, r, ['为什么需要关注', '关注']), problem: pick(t07.cols, r, ['可能存在的问题', '思维模式', '问题']),
    check: pick(t07.cols, r, ['需要访谈核查', '核查', '避免']),
    missing: ex.parseEcodes(pick(t07.cols, r, ['关联证据缺失', '证据缺失', '缺失', '证据'])),
    trigger: pick(t07.cols, r, ['对应触发规则', '触发']),
    script: normScripts(pick(t07.cols, r, ['建议追问脚本', '追问脚本', '关联脚本', '脚本']))
  }));

  // 触发规则：从 04 paths（risk/highValue，赋分表兜底）通用派生，带可执行 test(ranking)。
  // 全 10 题一致口径；不逐题手写、不依赖 08 表自由文本。
  const { risk, hv } = deriveRiskHV('Q' + n, paths);
  const reasonOf = (opt) => { const p = paths.find((x) => x.option === opt); return (p && p.reason) || ''; };
  const scriptExistsSeq = (seq) => seq.filter(scriptExists);
  const SEQ_MAIN = scriptExistsSeq(['Q1', 'Q2', 'Q3']);
  const SEQ_CONFIRM = scriptExistsSeq(['Q1', 'Q5', 'Q6']);
  const SEQ_PROCESS = scriptExistsSeq(['Q1', 'Q3']);
  const triggers = [];
  // T_risk：风险选项排首位或进前二（高优先）
  triggers.push({
    code: 'T_risk', prio: 3,
    result_cond: risk + ' 排首位或进入前二',
    target: reasonOf(risk) || ('确认教师是否高估了风险路径 ' + risk + '，能否看见儿童游戏兴趣与适宜支持。'),
    scripts: SEQ_MAIN.length ? SEQ_MAIN : ['Q1'],
    test: RAW("function (r) { return r[0] === '" + risk + "' || r.indexOf('" + risk + "') <= 1; }")
  });
  // T_lowvalue：某高价值选项被排到末位（高优先）
  hv.forEach((h) => triggers.push({
    code: 'T_lowvalue_' + h, prio: 3,
    result_cond: h + ' 排末位',
    target: reasonOf(h) || ('确认教师是否低估了高价值路径 ' + h + ' 的专业价值。'),
    scripts: SEQ_MAIN.length ? SEQ_MAIN : ['Q1'],
    test: RAW("function (r) { return r[r.length - 1] === '" + h + "'; }")
  }));
  // T_confirm：高价值选项占据前二（高水平确认，低优先）
  triggers.push({
    code: 'T_confirm', prio: 1,
    result_cond: '高价值选项(' + hv.join('/') + ')占据前二',
    target: '高水平确认：教师能否讲清判断依据、现场语言与后续支持策略。',
    scripts: SEQ_CONFIRM.length ? SEQ_CONFIRM : ['Q1'],
    test: RAW("function (r) { var hv = " + JSON.stringify(hv) + "; return hv.indexOf(r[0]) >= 0 && hv.indexOf(r[1]) >= 0; }")
  });
  // T_process：过程振荡/多次修改（由 process.js 过程标签侧触发；test 恒 false）
  triggers.push({
    code: 'T_process', prio: 2,
    result_cond: '过程振荡/多次修改（由过程标签触发）',
    target: '研究教师在多条专业路径之间如何权衡（结合过程标签追问）。',
    scripts: SEQ_PROCESS.length ? SEQ_PROCESS : ['Q1'],
    test: RAW('function () { return false; }')
  });

  // 10 锚点
  const t10 = table(s['10评分锚点'], /水平/);
  const anchors = t10.rows.filter((r) => ['高', '中高', '中', '偏低', '证据不足'].indexOf((r.A || '').trim()) >= 0).map((r) => {
    const rq = ex.parseAnchorReq(pick(t10.cols, r, ['必要证据点', '证据点']));
    return {
      level: r.A.trim(), core: pick(t10.cols, r, ['核心判断']), performance: pick(t10.cols, r, ['教师回答表现', '回答表现']),
      required: rq.required, weak: rq.weak, typical: pick(t10.cols, r, ['典型回答特征', '典型']),
      lack: pick(t10.cols, r, ['常见不足', '不足']), coding: pick(t10.cols, r, ['编码建议', '编码']),
      support: pick(t10.cols, r, ['可进入支持建议', '支持建议'])
    };
  });

  // 11 建议
  const t11 = table(s['11支持建议'], /支持类型|类型/);
  const suggestions = t11.rows.map((r) => ({
    type: r.A || '', when: pick(t11.cols, r, ['适用依据', '依据']), goal: pick(t11.cols, r, ['核心支持目标', '目标']),
    activities: pick(t11.cols, r, ['建议学习活动', '学习活动', '活动']), materials: pick(t11.cols, r, ['案例/材料建议', '材料', '案例']),
    expect: pick(t11.cols, r, ['预期改变', '预期']), follow: pick(t11.cols, r, ['后续观察指标', '后续观察', '观察指标'])
  })).filter((x) => x.goal || x.activities);

  return {
    kb_id: info['题目编号'] || '', core_orientation: info['核心测评指向'] || '', empirical_note: info['实证赋分协调'] || '',
    paths, evidence_points, biases, triggers, scripts, anchors, suggestions
  };
}

function validate(KB) {
  const errs = [];
  Object.keys(KB).forEach((q) => {
    const it = KB[q];
    const sc = Object.keys(it.scripts);
    it.triggers.forEach((t) => {
      if (!t.scripts.length) errs.push(q + ' ' + t.code + ' 无脚本');
      t.scripts.forEach((c) => { if (sc.indexOf(c) < 0) errs.push(q + ' ' + t.code + ' 引用不存在脚本 ' + c); });
    });
    it.biases.forEach((b) => b.script.forEach((c) => { if (sc.indexOf(c) < 0) errs.push(q + ' ' + b.code + ' 引用不存在脚本 ' + c); }));
    Object.keys(it.scripts).forEach((c) => it.scripts[c].E.forEach((e) => { if (!/^E[1-7]$/.test(e)) errs.push(q + ' ' + c + ' 非法证据码 ' + e); }));
    ['triggers', 'scripts', 'anchors', 'evidence_points', 'paths'].forEach((k) => {
      const len = Array.isArray(it[k]) ? it[k].length : Object.keys(it[k]).length;
      if (!len) errs.push(q + ' 缺 ' + k);
    });
  });
  return errs;
}

function main() {
  const KB = {};
  const summary = [];
  for (let n = 1; n <= 10; n++) {
    KB['Q' + n] = buildItem(n);
    const it = KB['Q' + n];
    summary.push('Q' + n + ' ' + it.kb_id + ': paths' + it.paths.length + ' E' + it.evidence_points.length + ' P' + it.biases.length + ' T' + it.triggers.length + ' scripts' + Object.keys(it.scripts).length + ' anchors' + it.anchors.length + ' sug' + it.suggestions.length);
  }
  const errs = validate(KB);
  if (errs.length) { console.error('校验失败:\n' + errs.join('\n')); process.exit(1); }

  const header =
    '/**\n' +
    ' * 题目知识库 = AI 访谈资料包 —— 全 10 题真实数据（对齐 DOC 13 表结构）。\n' +
    ' * 由 tools/build_knowledge.js 从 DOC/10个题目的知识库/*.xlsx 生成。\n' +
    ' * 访谈运作：教师排序+过程标签 → 命中 T 触发规则 → 调用 Q 追问脚本 → 采集 E 证据点 →\n' +
    ' *           评分锚点(anchors)编码 → 支持建议(suggestions)。\n' +
    ' * 硬约束（CLAUDE.md §2）：访谈不暴露专家排序/得分/标准答案，只围绕教师真实排序追问。\n' +
    ' * 追问脚本码为 09 表基码 Q1..Q7/Q-stop；触发/偏误引用的 Q2-D 等已归一到基码并过滤到本题存在的脚本。\n' +
    ' * 触发规则的排序匹配由 utils/interview.js 依 result_cond 文本（首/末位、靠前靠后）通用判定。\n' +
    ' */\n' +
    "const VERSION = 'DOC-10题';\n\n" +
    'const E_NAME = ' + jsLiteral(E_NAME, 0) + ';\n\n' +
    'const SELECTION_RULES = ' + jsLiteral(SELECTION_RULES, 0) + ';\n\n' +
    'const KB = ' + jsLiteral(KB, 0) + ';\n\n' +
    'module.exports = { VERSION, E_NAME, SELECTION_RULES, KB };\n';
  fs.writeFileSync(OUT, header);
  console.log('OK → knowledge.js（10 题，校验通过）');
  summary.forEach((x) => console.log('  ' + x));
}

function jsLiteral(v, ind) {
  const pad = '  '.repeat(ind), pad1 = '  '.repeat(ind + 1);
  if (v && typeof v === 'object' && v.__raw) return v.__raw; // 原样输出函数源码
  if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => pad1 + jsLiteral(x, ind + 1)).join(',\n') + '\n' + pad + ']' : '[]';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{\n' + keys.map((k) => pad1 + quoteKey(k) + ': ' + jsLiteral(v[k], ind + 1)).join(',\n') + '\n' + pad + '}';
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'";
  return String(v);
}
function quoteKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'"; }

main();
