/**
 * 从 DOC/inbox_0709/_kb16/*.xlsx(10 题 × 16 表)构建
 * cloudfunctions/gsyg_interviewChat/knowledge.json。
 *
 * 结构:
 *   {
 *     version: '2026-07-09-16sheet',
 *     items: {
 *       Q1: {
 *         title: '篮球架玩水',
 *         sheets: {
 *           '01基本信息': [{ column_a: '...', column_b: '...' }, ...],
 *           '02情境结构': [...],
 *           ... 全 16 表 ...
 *         },
 *         // 按用途聚合的常用切片(避免云函数运行时反复筛)
 *         ai_rules: [...],       // 15AI访谈规则(全部)
 *         scripts: [...],        // 09追问脚本
 *         option_explanations: [...],// 05选项解释
 *         evidence_points: [...],// 06能力证据点
 *         triggers: [...],       // 08访谈触发
 *         output_schema: [...]   // 16访谈输出证据规范
 *       }, ...
 *     }
 *   }
 *
 * mp Q1..Q10 顺序与新知识库文件名顺序完全一致(见 CLAUDE.md 情境映射)。
 *
 * 运行:node tools/build_knowledge_v16.js
 * 依赖:系统 unzip。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC_DIR = path.join(__dirname, '..', 'DOC', 'inbox_0709', '_kb16');
const OUT = path.join(__dirname, '..', 'cloudfunctions', 'gsyg_interviewChat', 'knowledge.json');

// mp Q# → 知识库文件名前缀(1..10 与新 canonical 顺序完全一致)
const ITEM_TITLES = {
  1: '篮球架玩水',
  2: '幼儿频繁求助',
  3: '区域停留短',
  4: '未参与小组建构',
  5: '游戏兴趣点与常规价值不符',
  6: '材料选择无层次',
  7: '艾莎公主不运动',
  8: '引水难题未解',
  9: '飞行棋各走各的',
  10: '跳绳秩序混乱'
};

function readXlsxSheets(xlsxPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb16-'));
  execSync('unzip -o "' + xlsxPath + '" -d "' + tmp + '"', { stdio: 'ignore' });

  const wbXml = fs.readFileSync(path.join(tmp, 'xl', 'workbook.xml'), 'utf8');
  const sheetNames = [];
  // 兼容 <x:sheet .../> 与 <sheet .../>;r:id 值可能是任意非引号串(如 R5dd68bc2bd274265)
  const sheetRe = /<[a-z]*:?sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
  let sm;
  while ((sm = sheetRe.exec(wbXml))) {
    sheetNames.push({ name: sm[1], rid: sm[2] });
  }

  const relsXml = fs.readFileSync(path.join(tmp, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
  const relMap = {};
  const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    relMap[rm[1]] = rm[2];
  }

  const sheets = {};
  for (let i = 0; i < sheetNames.length; i++) {
    const info = sheetNames[i];
    let target = info.rid && relMap[info.rid] ? relMap[info.rid] : 'worksheets/sheet' + (i + 1) + '.xml';
    // rels Target 可能以 /xl/ 开头(绝对包路径),需转成 xl/... 相对
    if (target.startsWith('/xl/')) target = target.slice(4);
    else if (target.startsWith('/')) target = target.slice(1).replace(/^xl\//, '');
    const abs = path.join(tmp, 'xl', target);
    const xml = fs.readFileSync(abs, 'utf8');
    sheets[info.name] = parseSheet(xml);
  }
  return sheets;
}

/**
 * 解析 sheet XML → 二维数组;首行作为 header,后续行转 obj 数组返回。
 * kb16 xlsx 全部用 inlineStr(t="str") + 数值(t="n"),无 sharedStrings。
 */
function parseSheet(xml) {
  const rows = [];
  const rowRe = /<x?:?row\b[^>]*>([\s\S]*?)<\/x?:?row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    const inner = m[1];
    const cells = {};
    const cellRe = /<x?:?c\b[^>]*r="([A-Z]+)\d+"[^>]*(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/x?:?c>/g;
    let cm;
    while ((cm = cellRe.exec(inner))) {
      const col = cm[1];
      const t = cm[2] || '';
      const body = cm[3];
      // <x:v>...</x:v> 或 <x:is><x:t>...</x:t></x:is>
      let val = '';
      const vm = body.match(/<x?:?v>([\s\S]*?)<\/x?:?v>/);
      if (vm) val = vm[1];
      else {
        const tm = body.match(/<x?:?t[^>]*>([\s\S]*?)<\/x?:?t>/);
        if (tm) val = tm[1];
      }
      // XML entity decode
      val = val.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, '\n').replace(/&#13;/g, '');
      if (t === 'n') val = Number(val);
      cells[col] = val;
    }
    rows.push(cells);
  }
  if (!rows.length) return [];

  // header 行 = rows[0];但要把每列的 A/B/C 转成 header 命名
  const header = rows[0];
  const colToKey = {};
  for (const k of Object.keys(header)) {
    const val = String(header[k] || '').trim();
    if (val) colToKey[k] = val;
  }
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    let hasContent = false;
    for (const col of Object.keys(r)) {
      const key = colToKey[col];
      if (!key) continue;
      const v = r[col];
      obj[key] = v;
      if (v !== '' && v != null) hasContent = true;
    }
    if (hasContent) out.push(obj);
  }
  return out;
}

function main() {
  const files = fs.readdirSync(SRC_DIR).filter((f) => /^第(\d+)题.*\.xlsx$/.test(f)).sort((a, b) => {
    const na = Number(a.match(/^第(\d+)题/)[1]);
    const nb = Number(b.match(/^第(\d+)题/)[1]);
    return na - nb;
  });
  if (files.length !== 10) {
    console.warn(`警告:找到 ${files.length} 个 xlsx,预期 10 个`);
  }

  const knowledge = { version: '2026-07-09-16sheet', generatedAt: '2026-07-09', items: {} };

  for (const fname of files) {
    const qNum = Number(fname.match(/^第(\d+)题/)[1]);
    const itemId = 'Q' + qNum;
    const xlsxPath = path.join(SRC_DIR, fname);
    console.log(`  ${itemId} ← ${fname}`);
    const sheets = readXlsxSheets(xlsxPath);

    // 常用切片
    const item = {
      title: ITEM_TITLES[qNum] || fname,
      sheets, // 保留全部 16 表原始行
      ai_rules: sheets['15AI访谈规则'] || [],
      scripts: sheets['09追问脚本'] || [],
      option_explanations: sheets['05选项解释'] || [],
      evidence_points: sheets['06能力证据点'] || [],
      triggers: sheets['08访谈触发'] || [],
      output_schema: sheets['16访谈输出证据规范'] || [],
      basic: (sheets['01基本信息'] || [])[0] || {},
      context_structure: (sheets['02情境结构'] || [])[0] || {},
      assessment_intent: (sheets['03测评意图'] || [])[0] || {}
    };
    // 每题概要打印
    console.log(`    16 表全部:${Object.keys(sheets).length};ai_rules=${item.ai_rules.length};scripts=${item.scripts.length};output_schema=${item.output_schema.length}`);
    knowledge.items[itemId] = item;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(knowledge, null, 0), 'utf8');
  const kb = fs.statSync(OUT).size / 1024;
  console.log(`\n已写入 ${OUT} (${kb.toFixed(1)} KB)`);
}

main();
