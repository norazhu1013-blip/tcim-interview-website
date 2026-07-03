/**
 * 生成 miniprogram/data/indicatorMap.js —— 全 10 题主/次二级、三级指标 + 观测点 + 访谈焦点。
 * 数据取自各题知识库 01基本信息（主/次二级、三级、观测点、核心测评指向）；指标名→规范编码。
 * 与 0000 指标框架 §5 / 000 10游戏能力映射表 口径一致；禁「五维」。
 * 运行：node tools/build_indicatorMap.js
 */
const fs = require('fs');
const path = require('path');
const ex = require('./_extract.js');

const KBDIR = path.join(__dirname, '..', 'DOC', '10个题目的知识库');
const OUT = path.join(__dirname, '..', 'miniprogram', 'data', 'indicatorMap.js');

const SECONDARY_NAME = {
  A: '对游戏的特点、价值的理解',
  B: '游戏条件的保障',
  C: '游戏支持与指导'
};
const TERTIARY_NAME = {
  A1: '对游戏特点的理解',
  A2: '对游戏价值的理解（游戏中的学习）',
  A3: '对游戏价值实现的认识',
  B1: '游戏环境创设',
  B2: '教师在幼儿游戏中的角色',
  C1: '游戏中的观察',
  C2: '对游戏行为的分析与回应'
};

const norm = (s) => (s || '').replace(/[（）()\s、，。；;]/g, '').trim();
const SEC_TO_CODE = {}; Object.keys(SECONDARY_NAME).forEach((c) => { SEC_TO_CODE[norm(SECONDARY_NAME[c])] = c; });
const TER_TO_CODE = {}; Object.keys(TERTIARY_NAME).forEach((c) => { TER_TO_CODE[norm(TERTIARY_NAME[c])] = c; });

function secCode(name) {
  const n = norm(name);
  if (SEC_TO_CODE[n]) return SEC_TO_CODE[n];
  const hit = Object.keys(SEC_TO_CODE).find((k) => n.indexOf(k) >= 0 || k.indexOf(n) >= 0);
  if (!hit) throw new Error('无法映射二级指标: ' + name);
  return SEC_TO_CODE[hit];
}
function terCode(name) {
  const n = norm(name);
  if (TER_TO_CODE[n]) return TER_TO_CODE[n];
  const hit = Object.keys(TER_TO_CODE).find((k) => n.indexOf(k) >= 0 || k.indexOf(n) >= 0);
  if (!hit) throw new Error('无法映射三级指标: ' + name);
  return TER_TO_CODE[hit];
}
function splitPoints(s) {
  return (s || '').split(/[；;、]/).map((x) => x.trim()).filter(Boolean);
}
function infoDict(sheets) {
  const rows = sheets['01基本信息'] || [];
  const d = {};
  rows.forEach((r) => { if (r.A && r.B) d[r.A.trim()] = r.B.trim(); });
  return d;
}
function kbFileFor(n) {
  return fs.readdirSync(KBDIR).find((f) => new RegExp('^第' + n + '题_').test(f) && !f.startsWith('~$'));
}

function main() {
  const map = {};
  const summary = [];
  for (let n = 1; n <= 10; n++) {
    const sheets = ex.xlsxSheetsX(path.join(KBDIR, kbFileFor(n)));
    const info = infoDict(sheets);
    const ps = secCode(info['主二级指标']);
    const pt = terCode(info['主三级指标']);
    const ss = secCode(info['次二级指标']);
    const st = terCode(info['次三级指标']);
    map['Q' + n] = {
      primary: { secondary: ps, tertiary: pt, observation_points: splitPoints(info['主观测点']) },
      secondary_ind: { secondary: ss, tertiary: st, observation_points: splitPoints(info['次观测点']) },
      interview_focus: info['核心测评指向'] || ''
    };
    summary.push('Q' + n + ' ' + pt + '/' + st);
  }

  const header =
    '/**\n' +
    ' * 指标映射 —— 全 10 题主/次二级、三级指标 + 观测点 + 访谈诊断焦点。\n' +
    ' * 取自各题知识库 01基本信息，指标名→规范编码；与 0000 指标框架 §5 口径一致。禁「五维」。\n' +
    ' *   A 对游戏的特点、价值的理解：A1 特点 / A2 价值(游戏中的学习) / A3 价值实现\n' +
    ' *   B 游戏条件的保障：B1 环境创设 / B2 教师角色\n' +
    ' *   C 游戏支持与指导：C1 观察 / C2 分析与回应\n' +
    ' * 由 tools/build_indicatorMap.js 生成。\n' +
    ' */\n' +
    "const VERSION = 'DOC-10题';\n\n" +
    'const SECONDARY_NAME = ' + jsLiteral(SECONDARY_NAME, 0) + ';\n\n' +
    'const TERTIARY_NAME = ' + jsLiteral(TERTIARY_NAME, 0) + ';\n\n' +
    'const MAP = ' + jsLiteral(map, 0) + ';\n\n' +
    'module.exports = { VERSION, SECONDARY_NAME, TERTIARY_NAME, MAP };\n';
  fs.writeFileSync(OUT, header);
  console.log('OK → indicatorMap.js');
  console.log('  主三级/次三级: ' + summary.join(' · '));
}

function jsLiteral(v, ind) {
  const pad = '  '.repeat(ind), pad1 = '  '.repeat(ind + 1);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => pad1 + jsLiteral(x, ind + 1)).join(',\n') + '\n' + pad + ']' : '[]';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return '{\n' + keys.map((k) => pad1 + quoteKey(k) + ': ' + jsLiteral(v[k], ind + 1)).join(',\n') + '\n' + pad + '}';
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  return String(v);
}
function quoteKey(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'"; }

main();
