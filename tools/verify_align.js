/**
 * 对拍脚本 —— 45 位教师数据 → JS 端口 vs Python 参考输出。
 * 硬门槛:所有 6 份 CSV 逐位一致(数值 1e-5 容差)。任一不一致 → exit 1。
 *
 * 运行:node tools/verify_align.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const advisor = require('./advisor_port.js');

const DATA_DIR = path.join(__dirname, '..', 'DOC', '计算情境选择最终方案(1)', '计算情境选择最终方案', '模拟数据_45位教师');
const REF_DIR = path.join(__dirname, 'advisor_ref_output', 'legacy_csv');
const RESULTS_CSV = path.join(DATA_DIR, 'exam_results_45teachers.csv');
const LOG_CSV = path.join(DATA_DIR, '操作日志_result_45teachers.csv');

/* ============ 简易 CSV 解析(支持 "..." 内的逗号 / 换行 / 双引号转义) ============ */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuote = false; i++; continue;
      }
      cell += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; }
      else if (c === ',') { row.push(cell); cell = ''; i++; }
      else if (c === '\r') { i++; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
      else { cell += c; i++; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0])).map((r) => {
    const o = {};
    for (let k = 0; k < headers.length; k++) o[headers[k]] = r[k] != null ? r[k] : '';
    return o;
  });
}

function readCsv(p) { return parseCsv(fs.readFileSync(p, 'utf8')); }

/* ============ 数值容差比对 ============ */
const TOL = 1e-5;
function eqValue(a, b, key) {
  if (a === b) return true;
  // 空字符串 <-> null/undefined 视为相等
  const isEmpty = (v) => v === '' || v == null;
  if (isEmpty(a) && isEmpty(b)) return true;
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= TOL || (Math.abs(na) > 1 && Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb)) < TOL);
  }
  // 字符串:去空白后比较
  return String(a).trim() === String(b).trim();
}

/* ============ 通用对拍 ============ */
function diffTable(name, jsRows, refRows, keyFields, compareFields) {
  const keyOf = (r) => keyFields.map((k) => String(r[k] != null ? r[k] : '')).join('||');
  const jsMap = new Map(); jsRows.forEach((r) => jsMap.set(keyOf(r), r));
  const refMap = new Map(); refRows.forEach((r) => refMap.set(keyOf(r), r));
  const allKeys = new Set([...jsMap.keys(), ...refMap.keys()]);
  const diffs = [];
  for (const k of allKeys) {
    const jr = jsMap.get(k);
    const rr = refMap.get(k);
    if (!jr) { diffs.push({ key: k, kind: 'missing_in_js' }); continue; }
    if (!rr) { diffs.push({ key: k, kind: 'extra_in_js' }); continue; }
    for (const f of compareFields) {
      if (!eqValue(jr[f], rr[f], f)) {
        diffs.push({ key: k, field: f, js: jr[f], ref: rr[f] });
      }
    }
  }
  return { total: jsRows.length, refTotal: refRows.length, diffs };
}

function report(name, res) {
  const pass = res.diffs.length === 0 && res.total === res.refTotal;
  const emoji = pass ? '✓' : '✗';
  console.log(`\n${emoji} ${name}`);
  console.log(`   JS 行数=${res.total} Ref 行数=${res.refTotal} 差异=${res.diffs.length}`);
  if (res.diffs.length) {
    for (const d of res.diffs.slice(0, 8)) {
      if (d.kind) console.log(`   [${d.kind}] key=${d.key}`);
      else console.log(`   key=${d.key} field=${d.field}\n     js  = ${JSON.stringify(d.js)}\n     ref = ${JSON.stringify(d.ref)}`);
    }
    if (res.diffs.length > 8) console.log(`   ...(还有 ${res.diffs.length - 8} 处)`);
  }
  return pass;
}

/* ============ 主流程 ============ */
function main() {
  console.log('读取数据…');
  const resultsRows = readCsv(RESULTS_CSV);
  const logRows = readCsv(LOG_CSV);
  console.log(`  results = ${resultsRows.length} 行,logs = ${logRows.length} 行`);

  console.log('运行 JS 端口…');
  const t0 = Date.now();
  const out = advisor.calculate(resultsRows, logRows, { logQuestionBase: 'auto' });
  const dt = Date.now() - t0;
  console.log(`  完成,耗时 ${dt}ms;final=${out.finalSelected.length},iiv=${out.iivDetail.length}`);

  console.log('读取 Python 参考输出…');
  const refFinal = readCsv(path.join(REF_DIR, 'advisor_final_3_interview_items.csv'));
  const refIiv = readCsv(path.join(REF_DIR, 'comprehensive_iiv_question_detail.csv'));
  const refR = readCsv(path.join(REF_DIR, 'advisor_R_result_deviation_candidates.csv'));
  const refP = readCsv(path.join(REF_DIR, 'advisor_P_process_candidates.csv'));
  const refPDetail = readCsv(path.join(REF_DIR, 'advisor_P_process_detail.csv'));
  const refG = readCsv(path.join(REF_DIR, 'advisor_G_result_process_candidates.csv'));

  let ok = true;

  // 1. P 明细(过程特征 + F/M/B/O + P_IVI)—— 最基础层,优先对齐
  ok = report('P 明细(过程特征)',
    diffTable('P_detail', out.pDetail, refPDetail,
      ['userOpenid', 'questionIndex'],
      ['effective_first_response_time_sec', 'effective_post_first_time_sec', 'effective_item_time_sec',
        'revision_count', 'action_count', 'first_position_change_count', 'last_position_change_count',
        'top_bottom_swap_count', 'unique_state_count', 'repeated_state_count', 'backtracking_count',
        'oscillation_count', 'F_score', 'M_score', 'B_score', 'O_score', 'P_IVI',
        'interruption_flag', 'time_removed_sec',
        'priorityOption', 'priorityPair', 'process_type', 'selection_status']
    )) && ok;

  // 2. R 候选
  ok = report('R 候选',
    diffTable('R', out.rSelected, refR,
      ['userOpenid', 'candidate_rank'],
      ['item_id', 'questionIndex', 'item_score', 'RD', 'candidate_type', 'teacher_level']
    )) && ok;

  // 3. P 候选(top2)
  ok = report('P 候选',
    diffTable('P', out.pSelected, refP,
      ['userOpenid', 'candidate_rank'],
      ['item_id', 'questionIndex', 'P_IVI', 'main_process_trigger']
    )) && ok;

  // 4. G 候选
  ok = report('G 候选',
    diffTable('G', out.gSelected, refG,
      ['userOpenid', 'candidate_rank'],
      ['item_id', 'questionIndex', 'relation_type', 'G_candidate_score', 'process_type']
    )) && ok;

  // 5. IIV 明细
  ok = report('IIV 明细',
    diffTable('IIV', out.iivDetail, refIiv,
      ['userOpenid', 'questionIndex'],
      ['ResultRisk', 'RelativeDeviation', 'ProcessConflict', 'RevisionSignal',
        'TimeSignal', 'OptionFocus', 'P_IVI_norm', 'IIV_classic', 'IIV_hybrid']
    )) && ok;

  // 6. 最终 3 题(硬门槛,必须完全对齐)
  ok = report('最终 3 题',
    diffTable('final', out.finalSelected, refFinal,
      ['userOpenid', 'final_rank'],
      ['final_item_id', 'questionIndex', 'source_summary', 'source_count',
        'R_rank', 'P_rank', 'G_rank', 'FES', 'RS', 'primary_ability_type']
    )) && ok;

  console.log('\n========================');
  if (ok) {
    console.log('✅ 全部对齐,可以推进');
    process.exit(0);
  } else {
    console.log('❌ 存在差异,需要定位');
    process.exit(1);
  }
}

main();
