/**
 * 云函数 gsyg_selectFinal 的入口翻译层本地对拍。
 *
 * 硬门槛:对 45 位教师,把 Python 参考日志(py 题号)反向"包装成 mp session 结构"
 * (mp 题号 + move_log/enter_ts/submit_ts),再走云函数的 buildAdvisorInput 翻译回去
 * 喂给 advisor,输出应与 Python 批量输出**完全一致**。
 *
 * 相当于测:mp session 结构 → cf 翻译 → advisor 输入 == Python 原始输入。
 * 这一步只验证「翻译无损」,不引入网络/数据库。
 *
 * 运行:node tools/verify_cf_pipeline.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const advisor = require('./advisor_port.js');
const norms = require('./advisor_norms.js');

// 与云函数 index.js 里的翻译逻辑严格一致——从 index.js 拷贝,不 require(避免拉 wx-server-sdk)。
const MP_TO_PY = { 1: 1, 2: 4, 3: 6, 4: 2, 5: 5, 6: 3, 7: 9, 8: 10, 9: 7, 10: 8 };
const PY_TO_MP = MP_TO_PY;
const LETTER = ['A', 'B', 'C', 'D'];

function replayTrajectory(firstRanking, moveLog) {
  const cur = (firstRanking && firstRanking.slice()) || LETTER.slice();
  const events = [];
  for (const m of (moveLog || [])) {
    if (!m || !m.option) continue;
    const prev = cur.join('');
    const idx = cur.indexOf(m.option);
    if (idx >= 0) cur.splice(idx, 1);
    const to = Math.min(cur.length, Math.max(0, (m.to_pos || 1) - 1));
    cur.splice(to, 0, m.option);
    events.push({ ts: Number(m.ts) || 0, previousValue: prev, currentValue: cur.join(''), answer: m.option });
  }
  return events;
}

function buildAdvisorInput(session) {
  const openid = session.openid;
  const participant = (session.profile && session.profile.name) || '';
  const answers = session.answers || {};
  const outAnswers = {};
  const syntheticLogs = [];
  for (let mpNum = 1; mpNum <= 10; mpNum++) {
    const a = answers['Q' + mpNum];
    if (!a) return { missing: ['Q' + mpNum] };
    const pyQ = MP_TO_PY[mpNum];
    outAnswers[String(pyQ - 1)] = a.final_ranking.map((l) => LETTER.indexOf(l));
    const enterTs = Number(a.enter_ts) || 0;
    const submitTs = Number(a.submit_ts) || (enterTs + (Number(a.duration_ms) || 0));
    syntheticLogs.push({ userOpenid: openid, questionIndex: String(pyQ), timestamp: String(enterTs), action: 'enter_question' });
    for (const d of replayTrajectory(a.first_ranking, a.move_log)) {
      syntheticLogs.push({
        userOpenid: openid, questionIndex: String(pyQ), timestamp: String(d.ts),
        action: 'change_sorting_option', previousValue: d.previousValue, currentValue: d.currentValue, answer: d.answer
      });
    }
    syntheticLogs.push({ userOpenid: openid, questionIndex: String(pyQ), timestamp: String(submitTs), action: 'leave_question' });
  }
  return { resultsRow: { participantName: participant, userOpenid: openid, answers: outAnswers }, syntheticLogs };
}

/* ---------- 读 Python 参考数据 → 反向构造 mp session ---------- */

const DATA_DIR = path.join(__dirname, '..', 'DOC', '计算情境选择最终方案(1)', '计算情境选择最终方案', '模拟数据_45位教师');
const REF_DIR = path.join(__dirname, 'advisor_ref_output', 'legacy_csv');

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
function readCsv(p) { return parseCsv(fs.readFileSync(p, 'utf8')); }

const results = readCsv(path.join(DATA_DIR, 'exam_results_45teachers.csv'));
const logs = readCsv(path.join(DATA_DIR, '操作日志_result_45teachers.csv'));
const refFinal = readCsv(path.join(REF_DIR, 'advisor_final_3_interview_items.csv'));

// 分组日志
const logsByUserPyQ = new Map();
for (const l of logs) {
  const u = l.userOpenid;
  const q = parseInt(l.questionIndex, 10);
  if (!u || !Number.isFinite(q) || q === -1) continue;
  const key = u + '|' + q;
  if (!logsByUserPyQ.has(key)) logsByUserPyQ.set(key, []);
  logsByUserPyQ.get(key).push(l);
}
for (const list of logsByUserPyQ.values()) list.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

// 反向构造 mp session:把 py 题号翻回 mp 题号,把日志事件回退为 first_ranking + move_log + enter_ts + submit_ts
const LETTER_ARR = ['A', 'B', 'C', 'D'];
function idxsToLetters(a) { return a.map((i) => LETTER_ARR[i]); }

function buildMpSessionFromRefData(r) {
  const openid = r.userOpenid;
  const answers = {};
  const rawAnswers = JSON.parse(r.answers);
  for (const [pyIdxStr, idxs] of Object.entries(rawAnswers)) {
    const pyQ = parseInt(pyIdxStr, 10) + 1;
    const mpQNum = PY_TO_MP[pyQ];
    const mpId = 'Q' + mpQNum;
    const final_ranking = idxsToLetters(idxs);
    // 逆推 first_ranking + move_log:从该题日志里拆
    const evs = logsByUserPyQ.get(openid + '|' + pyQ) || [];
    const enterEv = evs.find((e) => e.action === 'enter_question');
    const leaveEvs = evs.filter((e) => e.action === 'leave_question');
    const drags = evs.filter((e) => e.action === 'change_sorting_option');
    // Python CSV 里 previousValue/currentValue/answer 带引号+逗号(如 "A,B,C,D"),需清洗成纯字母串
    const cleanLetters = (v) => (String(v).toUpperCase().match(/[ABCD]/g) || []).join('');
    const first_ranking = drags.length && drags[0].previousValue
      ? cleanLetters(drags[0].previousValue).split('')
      : final_ranking.slice();
    const move_log = drags.map((d) => {
      const opt = cleanLetters(d.answer).slice(0, 1);
      const prev = cleanLetters(d.previousValue);
      const cur = cleanLetters(d.currentValue);
      const to = (cur.indexOf(opt) + 1) || 1;
      const from = (prev.indexOf(opt) + 1) || 1;
      return { ts: Number(d.timestamp), option: opt, from_pos: from, to_pos: to };
    });
    const enter_ts = enterEv ? Number(enterEv.timestamp) : (drags.length ? Number(drags[0].timestamp) : 0);
    const submit_ts = leaveEvs.length ? Number(leaveEvs[leaveEvs.length - 1].timestamp) : (drags.length ? Number(drags[drags.length - 1].timestamp) : enter_ts);
    answers[mpId] = { final_ranking, first_ranking, move_log, enter_ts, submit_ts, duration_ms: submit_ts - enter_ts };
  }
  return { openid, profile: { name: r.participantName }, answers };
}

/* ---------- 对拍 ---------- */

let matched = 0, totalDiffs = 0;
const compareFields = ['final_item_id', 'questionIndex', 'source_summary', 'source_count', 'R_rank', 'P_rank', 'G_rank', 'FES', 'RS'];
const TOL = 1e-5;
function eqValue(a, b) {
  if (a === b) return true;
  if ((a === '' || a == null) && (b === '' || b == null)) return true;
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) <= TOL;
  return String(a).trim() === String(b).trim();
}

const t0 = Date.now();
for (const r of results) {
  const mpSession = buildMpSessionFromRefData(r);
  const built = buildAdvisorInput(mpSession);
  if (built.missing) { console.log(`  ✗ ${r.userOpenid} missing:`, built.missing); totalDiffs++; continue; }
  const out = advisor.calculate([built.resultsRow], built.syntheticLogs, { logQuestionBase: 1, norms });

  // out.finalSelected 用 py item_id (Q1..Q10 按 py 编号)。参考 refFinal 也是 py Q 名。可直接比。
  const jsRows = out.finalSelected;
  const refRows = refFinal.filter((x) => x.userOpenid === r.userOpenid);
  if (jsRows.length !== refRows.length) { console.log(`  ✗ ${r.userOpenid} 行数 js=${jsRows.length} ref=${refRows.length}`); totalDiffs++; continue; }
  const byJs = new Map(jsRows.map((x) => [String(x.final_rank), x]));
  const byRef = new Map(refRows.map((x) => [String(x.final_rank), x]));
  let diff = 0;
  for (const rk of byRef.keys()) {
    const jr = byJs.get(rk); const rr = byRef.get(rk);
    if (!jr) { diff++; continue; }
    for (const f of compareFields) {
      if (!eqValue(jr[f], rr[f])) {
        if (diff < 2) console.log(`  ✗ ${r.userOpenid} rank=${rk} field=${f} js=${JSON.stringify(jr[f])} ref=${JSON.stringify(rr[f])}`);
        diff++;
      }
    }
  }
  if (diff === 0) matched++; else totalDiffs += diff;
}
const dt = Date.now() - t0;
console.log(`\n========================`);
console.log(`45 位教师逐位跑 云函数翻译层 + advisor,耗时 ${dt}ms (${(dt / 45).toFixed(1)}ms/位)`);
console.log(`完全匹配 = ${matched}/${results.length}, 差异 = ${totalDiffs}`);
if (matched === results.length && totalDiffs === 0) {
  console.log('✅ 云函数翻译层 → advisor 输出 与 Python 完全对齐,可以部署');
  process.exit(0);
} else {
  console.log('❌ 存在差异');
  process.exit(1);
}
