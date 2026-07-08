/**
 * 单教师+常模模式对拍 —— 模拟端上真实场景:云函数每次只收到一位教师的数据,查常模算百分位。
 * 硬门槛:对 45 位教师逐位单独跑,final 3 题选择、FES、RS、IIV 应与 Python 批量输出完全一致
 *   (因常模来自同 45 位;数值 1e-5 容差)。
 *
 * 运行:node tools/verify_norms_mode.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const advisor = require('./advisor_port.js');
const norms = require('./advisor_norms.js');

const DATA_DIR = path.join(__dirname, '..', 'DOC', '计算情境选择最终方案(1)', '计算情境选择最终方案', '模拟数据_45位教师');
const REF_DIR = path.join(__dirname, 'advisor_ref_output', 'legacy_csv');

function parseCsv(t) {
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const rows = []; let r = [], c = '', q = false, i = 0;
  while (i < t.length) {
    const x = t[i];
    if (q) {
      if (x === '"') { if (t[i + 1] === '"') { c += '"'; i += 2; continue; } q = false; i++; continue; }
      c += x; i++;
    } else {
      if (x === '"') { q = true; i++; }
      else if (x === ',') { r.push(c); c = ''; i++; }
      else if (x === '\r') { i++; }
      else if (x === '\n') { r.push(c); rows.push(r); r = []; c = ''; i++; }
      else { c += x; i++; }
    }
  }
  if (c.length || r.length) { r.push(c); rows.push(r); }
  const h = rows[0];
  return rows.slice(1).filter((x) => x.length > 1 || (x.length === 1 && x[0])).map((x) => {
    const o = {}; for (let k = 0; k < h.length; k++) o[h[k]] = x[k] || ''; return o;
  });
}
function readCsv(p) { return parseCsv(fs.readFileSync(p, 'utf8')); }

const TOL = 1e-5;
function eqValue(a, b) {
  if (a === b) return true;
  const isEmpty = (v) => v === '' || v == null;
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= TOL || (Math.abs(na) > 1 && Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb)) < TOL);
  }
  return String(a).trim() === String(b).trim();
}

function main() {
  console.log('加载数据 + Python 参考输出…');
  const results = readCsv(path.join(DATA_DIR, 'exam_results_45teachers.csv'));
  const logs = readCsv(path.join(DATA_DIR, '操作日志_result_45teachers.csv'));
  const refFinal = readCsv(path.join(REF_DIR, 'advisor_final_3_interview_items.csv'));
  console.log(`  ${results.length} 位教师, ${logs.length} 条日志, ${refFinal.length} 条 Python final。`);
  console.log(`  常模版本 = ${norms.version}, cohortSize = ${norms.cohortSize}\n`);

  // 按 openid 分组日志
  const logsByUser = new Map();
  for (const l of logs) {
    const u = l.userOpenid;
    if (!logsByUser.has(u)) logsByUser.set(u, []);
    logsByUser.get(u).push(l);
  }

  const compareFields = ['final_item_id', 'questionIndex', 'source_summary', 'source_count',
    'R_rank', 'P_rank', 'G_rank', 'FES', 'RS', 'primary_ability_type'];

  let totalDiffs = 0, matched = 0, teacherErrors = 0;
  const errorTeachers = [];
  const t0 = Date.now();

  for (const r of results) {
    const uid = r.userOpenid;
    const userLogs = logsByUser.get(uid) || [];
    let out;
    try {
      out = advisor.calculate([r], userLogs, { logQuestionBase: 'auto', norms });
    } catch (e) {
      console.log(`  ✗ ${uid} 报错:${e.message}`);
      teacherErrors++;
      continue;
    }
    // 该教师的 JS final(3 行) vs Python ref(3 行)
    const jsRows = out.finalSelected;
    const refRows = refFinal.filter((x) => x.userOpenid === uid);
    if (jsRows.length !== refRows.length) {
      console.log(`  ✗ ${uid} 行数不同 js=${jsRows.length} ref=${refRows.length}`);
      totalDiffs++; errorTeachers.push(uid); continue;
    }
    // 按 final_rank 匹配
    const byRankJs = new Map(jsRows.map((x) => [String(x.final_rank), x]));
    const byRankRef = new Map(refRows.map((x) => [String(x.final_rank), x]));
    let teacherDiff = 0;
    for (const rank of byRankRef.keys()) {
      const jr = byRankJs.get(rank);
      const rr = byRankRef.get(rank);
      if (!jr) { teacherDiff++; continue; }
      for (const f of compareFields) {
        if (!eqValue(jr[f], rr[f])) {
          if (teacherDiff < 3) {
            console.log(`  ✗ ${uid} rank=${rank} field=${f}\n    js  = ${JSON.stringify(jr[f])}\n    ref = ${JSON.stringify(rr[f])}`);
          }
          teacherDiff++;
        }
      }
    }
    if (teacherDiff) { totalDiffs += teacherDiff; errorTeachers.push(uid); }
    else matched++;
  }

  const dt = Date.now() - t0;
  console.log('\n========================');
  console.log(`45 位教师逐位单教师模式跑完,耗时 ${dt}ms(平均 ${(dt / 45).toFixed(1)}ms/位)`);
  console.log(`完全匹配 = ${matched}/${results.length}`);
  console.log(`差异位数 = ${totalDiffs},出错教师数 = ${errorTeachers.length}`);
  if (teacherErrors) console.log(`运行时报错教师数 = ${teacherErrors}`);
  if (matched === results.length && totalDiffs === 0 && teacherErrors === 0) {
    console.log('✅ 单教师+常模模式与 Python 批量输出完全对齐,可以进入云函数阶段');
    process.exit(0);
  } else {
    console.log('❌ 存在差异');
    process.exit(1);
  }
}

main();
