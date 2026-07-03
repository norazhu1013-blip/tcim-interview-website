/**
 * 生成 miniprogram/data/questions.js —— 全 10 题真实题干 + A/B/C/D 原文。
 * 题干/选项逐字取自《000 10题游戏测试题.docx》；title/age/game/conflict/kb_id 取自各题知识库 01基本信息。
 * 运行：node tools/build_questions.js
 */
const fs = require('fs');
const path = require('path');
const ex = require('./_extract.js');

const DOC = path.join(__dirname, '..', 'DOC', 'AI 测评 访谈及报告流程', '000 10题游戏测试题.docx');
const KBDIR = path.join(__dirname, '..', 'DOC', '10个题目的知识库');
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'questions.js');

// 知识库文件名（第1..10题）
const KB_FILES = fs.readdirSync(KBDIR).filter((f) => /题目知识库\.xlsx$/.test(f) && !f.startsWith('~$'));
function kbFileFor(n) {
  return KB_FILES.find((f) => new RegExp('^第' + n + '题_').test(f));
}

// 01基本信息 → label:value 字典
function infoDict(sheets) {
  const rows = sheets['01基本信息'] || [];
  const d = {};
  rows.forEach((r) => { if (r.A && r.B) d[r.A.trim()] = r.B.trim(); });
  return d;
}

// docx → 10 组 { stem, options{A,B,C,D} }
function parseQuestions() {
  const paras = ex.docxParas(DOC);
  const groups = [];
  let cur = null;
  paras.forEach((p) => {
    const optM = p.match(/^教师([A-D])[：:]\s*(.+)$/);
    if (/^下面是/.test(p)) return; // 分隔行
    if (/^【问题】/.test(p)) { if (cur) { groups.push(cur); cur = null; } return; }
    if (optM) {
      if (!cur) cur = { stem: '', options: {} };
      cur.options[optM[1]] = optM[2].trim();
      return;
    }
    // 情境题干：新组的起始叙述（去掉可能的 "N. " 前缀）
    if (!cur) cur = { stem: '', options: {} };
    if (Object.keys(cur.options).length === 0) {
      const stem = p.replace(/^\s*\d+\s*[.、]\s*/, '').trim();
      cur.stem = cur.stem ? cur.stem + stem : stem;
    }
  });
  if (cur && Object.keys(cur.options).length) groups.push(cur);
  return groups;
}

function main() {
  const groups = parseQuestions();
  if (groups.length !== 10) throw new Error('docx 解析出 ' + groups.length + ' 组，应为 10');

  const items = groups.map((g, i) => {
    const n = i + 1;
    const sheets = ex.xlsxSheetsX(path.join(KBDIR, kbFileFor(n)));
    const info = infoDict(sheets);
    const ageGame = info['年龄班与游戏类型'] || '';
    const parts = ageGame.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
    const age_group = parts.length ? parts[0].replace(/^年龄班[:：]?/, '') : '未明';
    const game_type = parts.slice(1).join(' / ') || ageGame;
    return {
      item_id: 'Q' + n,
      kb_id: info['题目编号'] || ('GSYG_' + (n < 10 ? '0' + n : n)),
      title: info['题目名称'] || '',
      age_group: age_group,
      game_type: game_type,
      conflict: info['核心情境冲突'] || '',
      stem: g.stem,
      options: g.options
    };
  });

  // 校验：每题 4 选项、题干非空
  items.forEach((it) => {
    ['A', 'B', 'C', 'D'].forEach((k) => { if (!it.options[k]) throw new Error(it.item_id + ' 缺选项 ' + k); });
    if (!it.stem) throw new Error(it.item_id + ' 缺题干');
  });

  const header =
    '/**\n' +
    ' * 题库 —— 全 10 题真实数据（题干/选项逐字取自 DOC《000 10题游戏测试题.docx》）。\n' +
    ' * 由 tools/build_questions.js 生成；title/age/game/conflict/kb_id 取自各题知识库 01基本信息。\n' +
    ' * 题号 Q1–Q10 与 scoreTable / indicatorMap / knowledge 四处一致。指标用规范名，禁「五维」。\n' +
    ' */\n' +
    "const VERSION = 'DOC-10题';\n\n" +
    'const ITEMS = ' + jsLiteral(items, 0) + ';\n\n' +
    'module.exports = { VERSION, ITEMS };\n';
  fs.writeFileSync(OUT, header);
  console.log('OK → questions.js（' + items.length + ' 题）');
  items.forEach((it) => console.log('  ' + it.item_id + ' ' + it.title + ' | ' + it.age_group + ' | opts ' + Object.keys(it.options).join('')));
}

// 生成带缩进的 JS 字面量（字符串用单引号，转义）
function jsLiteral(v, ind) {
  const pad = '  '.repeat(ind);
  const pad1 = '  '.repeat(ind + 1);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return '[\n' + v.map((x) => pad1 + jsLiteral(x, ind + 1)).join(',\n') + '\n' + pad + ']';
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return '{\n' + keys.map((k) => pad1 + quoteKey(k) + ': ' + jsLiteral(v[k], ind + 1)).join(',\n') + '\n' + pad + '}';
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  return String(v);
}
function quoteKey(k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'";
}

main();
