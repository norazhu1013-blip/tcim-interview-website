// 云函数 gsyg_selectFinal —— R/P/G 遴选:从 gsyg_sessions 拉答卷 → 跑 Python advisor 端口 → 写回 selection。
//
// 入参: { sessionId }
// 出参:
//   { ok: true, selection: {final:[{id,...}], routes, algo:'advisor_v1', normsVersion} }
//   { ok: false, error: 'code', message: '' }
//
// 幂等:同一 sessionId 若 selection.algo === 'advisor_v1' 且 selection.normsVersion 匹配当前 norms,直接返回缓存。
//
// 硬约束:
// 1) 权限:调用者 openid 必须与 session.openid 一致(否则 forbidden)。
// 2) 数据齐:session.answers 必须包含 10 题的 final_ranking;否则返回 incomplete_answers。
// 3) 分数不参与 AI:算法为确定性程序(advisor_port),仅使用 answers + 过程埋点 + 常模。
'use strict';

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ⚠️ 以下 4 个文件的 canonical 源在 tools/,由 `node tools/sync_cf.js` 物理拷入本目录。
//    改这几个文件前先改 tools/ 里的原文件,再跑 sync,不要直接改本目录里的副本(会被覆盖)。
const advisor = require('./advisor_port.js');           // canonical: tools/advisor_port.js
const norms = require('./advisor_norms.js');            // canonical: tools/advisor_norms.js
const taskCardBuilder = require('./task_card_builder.js'); // canonical: tools/task_card_builder.js
let KB = null;
try { KB = require('./knowledge.json'); } catch (e) { console.warn('[kb] knowledge.json 加载失败:', e && e.message); KB = { items: {} }; }
// canonical: tools/knowledge.json (由 tools/build_knowledge_v16.js 从 16 表 xlsx 生成)
taskCardBuilder.setKnowledge(KB);

const db = cloud.database();
const SESSIONS = 'gsyg_sessions';
// v1.2: 每题预生成完整 task_card 并挂到 selection.final[i].task_card。老 session 强制重跑。
const ALGO_VERSION = 'advisor_v1.2';

// 2026-07-15 恒等题号:advisor_port 内部题号已重排为「与小程序一致」(见 tools/advisor_port.js 头注),
// MP_TO_PY 翻译层已移除。mp session 直接喂 advisor,输出题号即小程序题号。
const LETTER = ['A', 'B', 'C', 'D'];
function letterToIdx(l) { return LETTER.indexOf(l); }
function mpIdToNum(id) { return parseInt(String(id).replace(/^Q/i, ''), 10); }
function mpQ(qNum) { return 'Q' + qNum; }

/* ---------- 把 mp session 的 answers/埋点合成 advisor.calculate 的入参 ---------- */

/**
 * 把 mp 存的 first_ranking + move_log 回放成 advisor 期望的 change_sorting_option 事件。
 * 用「按 option 定位、忽略 from_pos」的鲁棒版(与 mp utils/process.js 一致),对埋点漂移容错。
 */
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
    events.push({
      ts: Number(m.ts) || 0,
      previousValue: prev,
      currentValue: cur.join(''),
      answer: m.option
    });
  }
  return events;
}

/**
 * session -> { resultsRow, syntheticLogs }
 * resultsRow.answers 键为 Python 题号-1(即 "0".."9"),值为 [0-3] 的 4 位排列。
 * syntheticLogs 每条含 userOpenid / questionIndex(py) / timestamp / action。
 */
function buildAdvisorInput(session) {
  const openid = session.openid;
  const participant = (session.profile && (session.profile.name || session.profile.participantName)) || '';
  const answers = session.answers || {};
  const outAnswers = {};
  const syntheticLogs = [];

  const missing = [];
  for (let mpNum = 1; mpNum <= 10; mpNum++) {
    const mpItemId = 'Q' + mpNum;
    const a = answers[mpItemId];
    if (!a || !Array.isArray(a.final_ranking) || a.final_ranking.length !== 4) {
      missing.push(mpItemId);
      continue;
    }
    // 恒等题号:advisor 内部题号 == 小程序题号,直接用 mpNum,无需翻译。
    // final_ranking (['A','C','D','B']) -> [0,2,3,1];answers 键为题号-1(0-based)。
    outAnswers[String(mpNum - 1)] = a.final_ranking.map(letterToIdx);

    // 合成日志:enter + 逐条 change_sorting_option + leave
    const enterTs = Number(a.enter_ts) || 0;
    const submitTs = Number(a.submit_ts) || (enterTs + (Number(a.duration_ms) || 0));
    syntheticLogs.push({
      userOpenid: openid, questionIndex: String(mpNum),
      timestamp: String(enterTs), action: 'enter_question'
    });
    const drags = replayTrajectory(a.first_ranking, a.move_log);
    for (const d of drags) {
      syntheticLogs.push({
        userOpenid: openid, questionIndex: String(mpNum),
        timestamp: String(d.ts), action: 'change_sorting_option',
        previousValue: d.previousValue, currentValue: d.currentValue, answer: d.answer
      });
    }
    syntheticLogs.push({
      userOpenid: openid, questionIndex: String(mpNum),
      timestamp: String(submitTs), action: 'leave_question'
    });
  }

  if (missing.length) {
    return { missing };
  }
  const resultsRow = { participantName: participant, userOpenid: openid, answers: outAnswers };
  return { resultsRow, syntheticLogs };
}

/* ---------- advisor 输出 → mp 端 session.selection 兼容结构 ---------- */

function toMpSelection(advisorOut, sessionAnswers) {
  const answers = sessionAnswers || {};
  const finalMp = advisorOut.finalSelected.map((f) => {
    const pyQ = Number(f.questionIndex);
    const mpId = mpQ(pyQ);
    // sources: "R/P/G" -> ["R分·结果偏离", "P分·过程异常", "G分·结果×过程"]
    const srcNames = [];
    const raw = (f.source_summary || '').split('/');
    if (raw.includes('R')) srcNames.push('R分·结果偏离');
    if (raw.includes('P')) srcNames.push('P分·过程异常');
    if (raw.includes('G')) srcNames.push('G分·结果×过程');
    if (!srcNames.length) srcNames.push('覆盖增补');

    // 补 task_card 需要的教师作答画像:teacherFinalOrder / teacherInitialOrder / orderChanged
    // 来源:mp session.answers[mpId] 的 first_ranking(埋点持久,不受重进影响)与 final_ranking。
    const ans = answers[mpId] || {};
    const teacherFinalOrder = Array.isArray(ans.final_ranking) ? ans.final_ranking.join('') : '';
    const teacherInitialOrder = Array.isArray(ans.first_ranking) ? ans.first_ranking.join('') : teacherFinalOrder;
    const orderChanged = teacherInitialOrder && teacherFinalOrder && teacherInitialOrder !== teacherFinalOrder;
    const orderChangeSummary = orderChanged
      ? `初始排序${teacherInitialOrder},最终排序${teacherFinalOrder}`
      : `排序相对稳定,最终排序${teacherFinalOrder}`;

    // v1.2 预生成完整 task_card(002 doc 要求;供 gsyg_interviewChat 直接消费 + 导出)
    // 用 15 表 ai_rules 匹配教师排序特征,拿 hypotheses/evidence/probes/flow 等
    const seed = {
      teacherFinalOrder, teacherInitialOrder, orderChanged, orderChangeSummary,
      priorityOption: f.priorityOption || '',
      priorityPair: f.priorityPair || '',
      sources: srcNames.slice(),
      primary_ability_type: f.primary_ability_type || '',
      secondary_ability_type: f.secondary_ability_type || '',
      processTags: [] // 遴选时不必固化 processTags,访谈云函数可按需覆盖
    };
    const task_card = taskCardBuilder.buildTaskCard(mpId, seed);

    return {
      id: mpId, // mp Q1..Q10
      py_item_id: f.final_item_id,
      final_rank: f.final_rank,
      sources: srcNames,
      source_summary: f.source_summary,
      source_count: f.source_count,
      primary_ability_type: f.primary_ability_type,
      secondary_ability_type: f.secondary_ability_type,
      FES: f.FES, RS: f.RS,
      R_rank: f.R_rank, P_rank: f.P_rank, G_rank: f.G_rank,
      IIV_classic: f.IIV_classic, IIV_hybrid: f.IIV_hybrid,
      priorityOption: f.priorityOption, priorityPair: f.priorityPair,
      interview_focus: f.interview_focus,
      selection_reason: f.selection_reason,
      coverage_role: f.coverage_role,
      // task_card 教师作答画像(冗余,便于 mp 端读取)
      teacherFinalOrder,
      teacherInitialOrder,
      orderChanged,
      orderChangeSummary,
      // v1.2 完整任务卡(002 doc 要求的 task_card_json 内容)
      task_card
    };
  });
  const routes = {
    R: (advisorOut.rSelected || []).map((x) => mpQ(x.questionIndex)),
    P: (advisorOut.pSelected || []).map((x) => mpQ(x.questionIndex)),
    G: (advisorOut.gSelected || []).map((x) => mpQ(x.questionIndex))
  };
  return {
    final: finalMp,
    routes,
    algo: ALGO_VERSION,
    normsVersion: norms.version,
    generatedAt: Date.now()
  };
}

/* ---------- 主入口 ---------- */

function resolveActor(event) {
  const gateway = event && event.__gsygGateway;
  if (gateway && gateway.token && gateway.token === process.env.GSYG_WEB_GATEWAY_TOKEN && /^web_demo:[a-f0-9]{48}$/i.test(gateway.actor || '')) {
    return { id: gateway.actor, identityType: 'web_demo' };
  }
  const { OPENID } = cloud.getWXContext();
  return { id: OPENID, identityType: 'wechat' };
}

exports.main = async (event) => {
  const actor = resolveActor(event);
  if (!actor.id) return { ok: false, error: 'missing_identity' };
  const sessionId = event && event.sessionId;
  if (!sessionId) return { ok: false, error: 'missing_sessionId' };

  let sessionDoc;
  try {
    const q = await db.collection(SESSIONS).where({ sessionId }).limit(1).get();
    if (!q.data || !q.data.length) return { ok: false, error: 'session_not_found' };
    sessionDoc = q.data[0];
  } catch (e) {
    return { ok: false, error: 'db_read_failed', message: e && e.message };
  }

  // 权限:必须本人
  if (sessionDoc.openid !== actor.id) return { ok: false, error: 'forbidden' };

  // 幂等缓存
  const cached = sessionDoc.selection;
  if (cached && cached.algo === ALGO_VERSION && cached.normsVersion === norms.version) {
    return { ok: true, selection: cached, cached: true };
  }

  // 组装 advisor 入参
  const built = buildAdvisorInput(sessionDoc);
  if (built.missing) {
    return { ok: false, error: 'incomplete_answers', message: '缺少题目:' + built.missing.join(',') };
  }

  // 跑算法
  let advisorOut;
  try {
    advisorOut = advisor.calculate([built.resultsRow], built.syntheticLogs, { logQuestionBase: 1, norms });
  } catch (e) {
    return { ok: false, error: 'algo_failed', message: e && e.message };
  }
  if (!advisorOut.finalSelected || advisorOut.finalSelected.length !== 3) {
    return { ok: false, error: 'algo_incomplete', message: `final=${(advisorOut.finalSelected || []).length}` };
  }

  const selection = toMpSelection(advisorOut, sessionDoc.answers || {});

  // 写回 gsyg_sessions.selection(不覆盖其他字段)
  // 用 db.command.set() 强制**替换整个 selection 字段**,而非拍平成 sub-path 操作
  // (否则当当前 selection === null 时 MongoDB 报 "Cannot create field 'algo' in element {selection: null}")。
  try {
    const _ = db.command;
    await db.collection(SESSIONS).doc(sessionDoc._id).update({
      data: { selection: _.set(selection), selectionUpdatedAt: Date.now() }
    });
  } catch (e) {
    // 写库失败不阻塞返回结果(前端拿到后自会用),但记日志
    console.warn('write selection back failed:', e && e.message);
  }

  return { ok: true, selection, cached: false };
};
