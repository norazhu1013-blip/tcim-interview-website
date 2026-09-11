/**
 * 一次性构建脚本：研究团队《新10题赋分表 new.xlsx》 → miniprogram/data/scoreTable.js
 *
 * 用途：把真实赋分表转成小程序内置的 JS 数据（小程序运行时不读 xlsx）。
 * 运行：node tools/build_scoreTable.js
 * 依赖：系统 `unzip`（Git Bash / macOS / Linux 自带；xlsx 本质是 zip）。
 *
 * ★ 排列顺序口径：xlsx 首列「选项组合」显式给出每行对应排列（ABCD…DCBA，恰为字典序），
 *   因此 行号↔排列 映射来自原表、非假设。排列串语义 = 最理想→最不理想（左→右）。
 *   若研究团队确认口径不同（如列为位次而非排序），只改下方 permToKey 一处即可。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const XLSX = path.join(__dirname, '..', 'DOC', 'AI 测评 访谈及报告流程', '000 10题赋分.xlsx');
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'scoreTable.js');

// 排列串 "ABCD" → 查表键 "A>B>C>D"（口径转换的唯一位置）
function permToKey(perm) {
  return perm.split('').join('>');
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scoretable-'));
  execSync('unzip -o "' + XLSX + '" -d "' + tmp + '"', { stdio: 'ignore' });

  const ss = fs.readFileSync(path.join(tmp, 'xl', 'sharedStrings.xml'), 'utf8');
  const shared = [];
  ss.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => {
    let txt = '';
    inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, t) => { txt += t; return ''; });
    shared.push(txt);
    return '';
  });

  const sheet = fs.readFileSync(path.join(tmp, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
  const rows = [];
  sheet.replace(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, (m, rn, inner) => {
    const cells = {};
    inner.replace(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g, (mm, col, attrs, cont) => {
      const isStr = /t="s"/.test(attrs);
      let v = null;
      const vm = cont.match(/<v>([\s\S]*?)<\/v>/);
      if (vm) v = vm[1];
      cells[col] = isStr && v != null ? shared[Number(v)] : v;
      return '';
    });
    rows.push({ rn: Number(rn), cells });
    return '';
  });

  const data = rows.slice(1); // 去表头
  const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']; // Q1..Q10
  const out = {};
  for (let qi = 1; qi <= 10; qi++) out['Q' + qi] = {};
  data.forEach((r) => {
    const key = permToKey(r.cells.A);
    cols.forEach((c, qi) => { out['Q' + (qi + 1)][key] = Number(r.cells[c]); });
  });

  // 校验：每题 24 排列不重不漏，分值 0-4
  Object.keys(out).forEach((q) => {
    const keys = Object.keys(out[q]);
    if (keys.length !== 24) throw new Error(q + ' 排列数 ' + keys.length + ' ≠ 24');
    keys.forEach((k) => {
      const v = out[q][k];
      if (!(v >= 0 && v <= 4)) throw new Error(q + ' ' + k + ' 分值越界: ' + v);
    });
  });

  let body = '';
  for (let qi = 1; qi <= 10; qi++) {
    const q = 'Q' + qi;
    const lines = Object.keys(out[q]).map((k) => "    '" + k + "': " + out[q][k]);
    body += '  ' + q + ': {\n' + lines.join(',\n') + '\n  }' + (qi < 10 ? ',' : '') + '\n';
  }

  const header =
    '/**\n' +
    ' * 赋分表 —— 由研究团队《新10题赋分表 new.xlsx》真实数据生成（2026-09-11 核对）。\n' +
    ' * 生成脚本：tools/build_scoreTable.js（一次性 xlsx→JS；小程序运行时不读 xlsx）。\n' +
    ' * 每题 by_order: 排列串("A>B>C>D") → 0-4 整数分。含全部 10 题 × 24 排列。\n' +
    ' *\n' +
    ' * ★★★ 排列顺序口径 ★★★\n' +
    ' * xlsx 首列「选项组合」**显式**给出每行对应的排列（ABCD、ABDC … DCBA，恰为字典序）。\n' +
    ' * 行号↔排列 映射来自原表，**非假设**。排列串语义 = 最理想→最不理想（左→右）。\n' +
    ' * 若口径不同，只需改 tools/build_scoreTable.js 的 permToKey 一处，无需改评分逻辑。\n' +
    ' */\n' +
    "const VERSION = 'new-10题赋分-20260911';\n" +
    'const SCALE = [0, 4];\n\n' +
    'const SCORES = {\n';
  const footer = '};\n\nmodule.exports = { VERSION, SCALE, SCORES };\n';

  fs.writeFileSync(OUT, header + body + footer);
  console.log('OK → ' + OUT + '（10 题 × 24 排列，分值 0-4 校验通过）');
}

main();
