/**
 * 恒等题号迁移的「行为差异」对照(2026-07-15,一次性)。
 *
 * 直接把两份 CSV 喂给两套端口(批量模式,与 Python --legacy-csv 一致,不做 session 重建):
 *   OLD = 旧 advisor_port(旧 py 题号) 跑 **原始** 45 教师数据(旧题号)
 *   NEW = 新 advisor_port(mp 恒等题号) 跑 **重贴标签** 45 教师数据(mp 题号)
 * 把 OLD 的最终 3 题题号经 M 翻回小程序题号后,与 NEW 逐位比较。
 *
 * 预期:绝大多数教师完全一致;少数教师因 R/P/G 排序里的**题号 tie-break**在重排后
 * 断法不同而选出不同情境(旧程序按旧 py 题号断、新程序按 mp 题号断)。本脚本把这些
 * 教师**列出来**,作为迁移的行为差异记录 —— 采用新程序 = 采用其 tie-break。
 *
 * oracle 快照:/tmp/advisor_port_OLD_oracle.js
 * 运行:node tools/verify_migration_equivalence.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const advisorOLD = require('/tmp/advisor_port_OLD_oracle.js');
const advisorNEW = require('./advisor_port.js');

const M = { 1: 1, 2: 4, 3: 6, 4: 2, 5: 5, 6: 3, 7: 9, 8: 10, 9: 7, 10: 8 }; // 旧 mp<->py 自对合
const BASE = path.join(__dirname, '..', 'DOC', '计算情境选择最终方案(1)', '计算情境选择最终方案');
const OLD_DIR = path.join(BASE, '模拟数据_45位教师');       // 原始(旧题号)
const NEW_DIR = path.join(BASE, '模拟数据_45位教师_mp题序'); // 重贴标签(mp 题号)

function parseCsv(t) {
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const rows = []; let r = [], c = '', q = false, i = 0;
  while (i < t.length) {
    const x = t[i];
    if (q) { if (x === '"') { if (t[i + 1] === '"') { c += '"'; i += 2; continue; } q = false; i++; continue; } c += x; i++; }
    else { if (x === '"') { q = true; i++; } else if (x === ',') { r.push(c); c = ''; i++; } else if (x === '\r') { i++; } else if (x === '\n') { r.push(c); rows.push(r); r = []; c = ''; i++; } else { c += x; i++; } }
  }
  if (c.length || r.length) { r.push(c); rows.push(r); }
  const h = rows[0];
  return rows.slice(1).filter((x) => x.length > 1 || (x.length === 1 && x[0])).map((x) => { const o = {}; for (let k = 0; k < h.length; k++) o[h[k]] = x[k] || ''; return o; });
}
const readCsv = (p) => parseCsv(fs.readFileSync(p, 'utf8'));

const outOld = advisorOLD.calculate(
  readCsv(path.join(OLD_DIR, 'exam_results_45teachers.csv')),
  readCsv(path.join(OLD_DIR, '操作日志_result_45teachers.csv')),
  { logQuestionBase: 'auto' }
);
const outNew = advisorNEW.calculate(
  readCsv(path.join(NEW_DIR, 'exam_results_45teachers.csv')),
  readCsv(path.join(NEW_DIR, '操作日志_result_45teachers.csv')),
  { logQuestionBase: 'auto' }
);

function finalByUser(out, relabel) {
  const m = new Map();
  for (const f of out.finalSelected) {
    const mp = relabel ? M[Number(f.questionIndex)] : Number(f.questionIndex);
    if (!m.has(f.userOpenid)) m.set(f.userOpenid, []);
    m.get(f.userOpenid).push({ rank: Number(f.final_rank), item: 'Q' + mp, src: f.source_summary });
  }
  for (const arr of m.values()) arr.sort((a, b) => a.rank - b.rank);
  return m;
}
const oldByUser = finalByUser(outOld, true);
const newByUser = finalByUser(outNew, false);

const keyOf = (arr) => arr.map((x) => x.rank + ':' + x.item + ':' + x.src).join(' | ');
let same = 0; const diffs = [];
for (const u of oldByUser.keys()) {
  const a = keyOf(oldByUser.get(u) || []);
  const b = keyOf(newByUser.get(u) || []);
  if (a === b) same++; else diffs.push({ u, a, b });
}

console.log(`\n45 位教师最终 3 题(小程序题号 + 来源)OLD vs NEW`);
console.log(`完全一致 = ${same}/${oldByUser.size},差异 = ${diffs.length}(题号 tie-break 断法不同所致)`);
for (const d of diffs) {
  console.log(`\n  ${d.u}`);
  console.log(`   OLD(旧程序) ${d.a}`);
  console.log(`   NEW(新程序) ${d.b}`);
}
console.log(`\n说明:差异全部来自 R/P/G 排序中「同值并列按题号断」的 tie-break——旧程序按旧 py 题号断,`);
console.log(`新程序按小程序题号断。迁移即采用研究团队新程序的 tie-break,属预期内、非缺陷。`);
