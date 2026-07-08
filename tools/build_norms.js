/**
 * 从 45 位模拟教师提取过程指标常模 → tools/advisor_norms.js
 * 常模用于端上单教师场景:云函数收到一位教师的作答后,查常模算 P/F/M/O 百分位,
 * 而非"同批次跨教师"(端上根本没有别人)。
 *
 * 数据源:DOC/计算情境选择最终方案(1)/.../模拟数据_45位教师/
 * 上线常模基础:2026-07-08 · 45 位模拟教师(冷启动版本)。
 *
 * 运行:node tools/build_norms.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const advisor = require('./advisor_port.js');

const DATA_DIR = path.join(__dirname, '..', 'DOC', '计算情境选择最终方案(1)', '计算情境选择最终方案', '模拟数据_45位教师');
const OUT = path.join(__dirname, 'advisor_norms.js');

// 与 verify_align 相同的极简 CSV 解析
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

function main() {
  const results = parseCsv(fs.readFileSync(path.join(DATA_DIR, 'exam_results_45teachers.csv'), 'utf8'));
  const logs = parseCsv(fs.readFileSync(path.join(DATA_DIR, '操作日志_result_45teachers.csv'), 'utf8'));
  console.log(`加载:${results.length} 位教师, ${logs.length} 条日志。`);

  // 用批量模式跑一遍,拿 pDetail(过程明细,含 8 个用于百分位的指标)
  const out = advisor.calculate(results, logs, { logQuestionBase: 'auto' });
  console.log(`pDetail = ${out.pDetail.length} 行(应为 45×10=450)。`);

  const METRICS = [
    'effective_first_response_time_sec',
    'effective_post_first_time_sec',
    'revision_count',
    'action_count',
    'unique_state_count',
    'repeated_state_count',
    'backtracking_count',
    'oscillation_count'
  ];

  const norms = { version: '2026-07-08-45sim', cohortSize: results.length, generatedAt: '2026-07-08', Q: {} };
  for (let q = 1; q <= 10; q++) {
    const rows = out.pDetail.filter((r) => r.questionIndex === q);
    if (rows.length !== results.length) {
      console.warn(`  警告:Q${q} 行数 ${rows.length} ≠ 教师数 ${results.length}`);
    }
    norms.Q[q] = {};
    for (const m of METRICS) {
      // 保留 null(percentileRank 内部会过滤,与 Python 一致);排序后仅便于人工审阅
      const arr = rows.map((r) => r[m]);
      const cmp = (a, b) => (a == null ? 1 : b == null ? -1 : a - b);
      norms.Q[q][m] = arr.slice().sort(cmp);
    }
  }

  const src = `// 自动生成于 ${new Date().toISOString().slice(0, 10)} —— 请勿手改。
// 常模来源:DOC 45 位模拟教师(冷启动版本);后续换真实数据后重跑 tools/build_norms.js。
// 结构:Q[pyQuestionIndex][metric] = [升序数值数组, null 排末尾]
// 消费方:advisor_port.js 的 addPScores(rows, norms);云函数 gsyg_selectFinal 引用本文件。
'use strict';
module.exports = ${JSON.stringify(norms, null, 2)};
`;
  fs.writeFileSync(OUT, src, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`已写入 ${OUT} (${kb} KB)`);
}

main();
