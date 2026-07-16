const ExcelJS = require('exceljs');

const QUESTION_TITLES = {
  Q1: '篮球架玩水',
  Q2: '幼儿频繁求助',
  Q3: '区域停留短',
  Q4: '未参与小组建构',
  Q5: '游戏兴趣点与常规价值不符',
  Q6: '材料选择无层次',
  Q7: '艾莎公主不运动',
  Q8: '引水难题未解',
  Q9: '飞行棋各走各的',
  Q10: '跳绳秩序混乱'
};

const SHEET_NAMES = [
  '导出说明',
  '教师信息',
  '测验访谈汇总',
  '作答明细',
  '情境筛选',
  '访谈逐字稿',
  '访谈编码',
  '访谈任务卡',
  '访谈反馈'
];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function safeCell(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let out = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!out) return null;
  if (/^[=+\-@]/.test(out)) out = "'" + out;
  if (out.length > 32700) out = out.slice(0, 32690) + '…（已截断）';
  return out;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function formatTs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

function round(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const p = Math.pow(10, digits || 0);
  return Math.round(n * p) / p;
}

function qNumber(qid) {
  const m = String(qid || '').match(/\d+/);
  return m ? Number(m[0]) : 999;
}

function sessionTs(session) {
  return Number(session && (session.examStartTs || session.examSubmitTs || session.createdAt || session.updatedAt) || 0);
}

function rankText(value) {
  if (Array.isArray(value)) return value.join('>');
  const s = text(value);
  if (/^[A-D]{2,}$/.test(s)) return s.split('').join('>');
  return s;
}

function itemTitle(itemId, taskCard) {
  return text(object(taskCard).item_title) || QUESTION_TITLES[itemId] || '';
}

function statusZh(status) {
  const map = {
    submitted: '已提交',
    timeout_submitted: '超时自动提交',
    done: '已完成',
    pending: '待完成'
  };
  return map[status] || text(status);
}

function numberedLines(value) {
  return list(value).map((v, i) => (i + 1) + '. ' + text(v)).join('\n');
}

function profileOf(row) {
  return object(row && row.profile);
}

function identityKey(row) {
  if (!row) return '';
  if (row.openid) return 'openid:' + row.openid;
  if (row.sessionId) return 'session:' + row.sessionId;
  return 'record:' + (row._id || 'unknown');
}

function buildContext(bundle) {
  const data = object(bundle.data);
  const teachers = list(data.teachers);
  const sessions = list(data.sessions).slice().sort((a, b) => sessionTs(a) - sessionTs(b));
  const interviews = list(data.interviews);
  const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
  const interviewBySession = new Map(interviews.map((i) => [i.sessionId, i]));

  const identities = new Set();
  teachers.forEach((r) => identities.add(identityKey(r)));
  sessions.forEach((r) => identities.add(identityKey(r)));
  interviews.forEach((r) => {
    const s = sessionById.get(r.sessionId);
    identities.add(identityKey(s || r));
  });
  identities.delete('');
  const identityList = Array.from(identities).sort();
  const codeByIdentity = new Map(identityList.map((key, i) => [key, 'T' + String(i + 1).padStart(3, '0')]));

  const teacherByIdentity = new Map();
  teachers.forEach((t) => teacherByIdentity.set(identityKey(t), t));
  const sessionsByIdentity = new Map();
  sessions.forEach((s) => {
    const key = identityKey(s);
    if (!sessionsByIdentity.has(key)) sessionsByIdentity.set(key, []);
    sessionsByIdentity.get(key).push(s);
  });

  function metaFor(row, fallbackSession) {
    const base = fallbackSession || row || {};
    const key = identityKey(base);
    const teacher = teacherByIdentity.get(key);
    const current = profileOf(teacher);
    const historical = profileOf(row);
    const fallback = profileOf(fallbackSession);
    const p = Object.assign({}, current, fallback, historical);
    return {
      key,
      code: codeByIdentity.get(key) || '',
      name: text(p.name) || '（无姓名）',
      kindergarten: text(p.kindergarten),
      teachAge: text(p.teachAge)
    };
  }

  const attemptNoBySession = new Map();
  sessionsByIdentity.forEach((rows) => rows.forEach((s, i) => attemptNoBySession.set(s.sessionId, i + 1)));

  return {
    data,
    teachers,
    sessions,
    interviews,
    sessionById,
    interviewBySession,
    identities: identityList,
    codeByIdentity,
    teacherByIdentity,
    sessionsByIdentity,
    attemptNoBySession,
    metaFor
  };
}

function addDataSheet(workbook, name, columns, rows) {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14 }));
  rows.forEach((raw) => {
    const row = {};
    columns.forEach((c) => { row[c.key] = safeCell(raw[c.key]); });
    ws.addRow(row);
  });
  const header = ws.getRow(1);
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3F63D6' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C3E6' } } };
  });
  if (columns.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FC' } };
      });
    }
  });
  return ws;
}

function addReadme(workbook, bundle, ctx, counts) {
  const ws = workbook.addWorksheet('导出说明');
  ws.columns = [{ width: 24 }, { width: 88 }];
  const rows = [
    ['文件用途', '研究者可阅读的整理版数据。原始字段及 openid 请使用同一入口导出的原始 JSON。'],
    ['导出时间（北京时间）', formatTs(bundle.exportedAt)],
    ['数据范围', bundle.since ? '增量：updatedAt ≥ ' + formatTs(bundle.since) : '全量'],
    ['教师身份数', ctx.identities.length],
    ['测验记录数', ctx.sessions.length],
    ['访谈记录数', ctx.interviews.length],
    ['访谈情境数', counts.interviewScenarios],
    ['已完成访谈情境数', counts.doneScenarios],
    ['待完成访谈情境数', counts.pendingScenarios],
    ['任务卡数', counts.taskCards],
    ['姓名口径', '保留教师姓名。若同一教师曾修改姓名，“教师信息”同时列出当前姓名与历史姓名；各测验行保留当次测验所记录的姓名。'],
    ['教师编号口径', 'T001、T002……仅用于本文件内跨工作表关联，不替代姓名。'],
    ['完成状态口径', 'done=已完成，pending=待完成；存在访谈记录不等于三个情境均已完成。'],
    ['时间口径', '所有毫秒时间戳均转换为北京时间；时长统一换算为秒或分钟。'],
    ['工作表', SHEET_NAMES.join('、')],
    ['原始数据提示', '整理版不包含 openid、wxCode、数据库 _id 等运行字段；这些字段仍完整保留在原始 JSON 中。']
  ];
  rows.forEach((r) => ws.addRow(r));
  ws.getColumn(1).font = { bold: true, color: { argb: 'FF27345A' } };
  ws.eachRow((row, i) => {
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = i === 1 ? 32 : 24;
    if (i % 2 === 1) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDFB' } };
  });
  ws.getRow(1).getCell(1).font = { bold: true, color: { argb: 'FF3F63D6' }, size: 14 };
}

function buildTeacherRows(ctx) {
  return ctx.identities.map((key) => {
    const teacher = ctx.teacherByIdentity.get(key);
    const sessions = ctx.sessionsByIdentity.get(key) || [];
    const latest = sessions[sessions.length - 1];
    const currentProfile = profileOf(teacher);
    const latestProfile = profileOf(latest);
    const names = Array.from(new Set(sessions.map((s) => text(profileOf(s).name)).filter(Boolean)));
    if (currentProfile.name && !names.includes(currentProfile.name)) names.push(currentProfile.name);
    const sessionIds = new Set(sessions.map((s) => s.sessionId));
    const interviews = ctx.interviews.filter((i) => sessionIds.has(i.sessionId));
    const latestInterview = interviews.slice().sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0)).pop();
    return {
      teacherCode: ctx.codeByIdentity.get(key),
      name: text(currentProfile.name || latestProfile.name) || '（无姓名）',
      historicalNames: names.join('、') || '（无姓名）',
      kindergarten: text(currentProfile.kindergarten || latestProfile.kindergarten),
      teachAge: text(currentProfile.teachAge || latestProfile.teachAge),
      currentAccount: teacher ? '是' : '否',
      examCount: sessions.length,
      interviewCount: interviews.length,
      latestExamAt: formatTs(latest && (latest.examSubmitTs || latest.updatedAt || latest.createdAt)),
      latestInterviewAt: formatTs(latestInterview && (latestInterview.updatedAt || latestInterview.createdAt))
    };
  });
}

function interviewStats(interview) {
  const entries = Object.entries(object(interview && interview.transcripts));
  const done = entries.filter(([, value]) => value && value.status === 'done').length;
  const pending = entries.filter(([, value]) => !value || value.status !== 'done').length;
  let status = '未生成';
  if (interview) {
    if (!entries.length || done === 0) status = '未开始';
    else if (pending === 0) status = '已完成';
    else status = '进行中';
  }
  return { total: entries.length, done, pending, status };
}

function buildSummaryRows(ctx) {
  return ctx.sessions.map((session) => {
    const meta = ctx.metaFor(session);
    const interview = ctx.interviewBySession.get(session.sessionId);
    const iv = interviewStats(interview);
    const selection = object(session.selection);
    const finals = list(selection.final);
    const scores = object(session.scores);
    const feedback = object(interview && interview.feedback);
    return {
      teacherCode: meta.code,
      name: meta.name,
      kindergarten: meta.kindergarten,
      teachAge: meta.teachAge,
      attemptNo: ctx.attemptNoBySession.get(session.sessionId) || '',
      sessionId: session.sessionId,
      examAt: formatTs(session.examSubmitTs || session.updatedAt || session.createdAt),
      submitStatus: statusZh(session.submitStatus),
      answerCount: Object.keys(object(session.answers)).length,
      total: session.total !== undefined ? session.total : scores.total,
      mean: round(scores.mean, 2),
      level: text(scores.level),
      totalMinutes: round(Number(session.totalDurationMs || 0) / 60000, 2),
      selectionAlgo: text(selection.algo) || '历史版本/未标记',
      selectedItems: finals.map((f) => f.id).filter(Boolean).join('、'),
      taskCardCount: finals.filter((f) => object(f.task_card).item_id || object(f.task_card).item_title).length,
      interviewStatus: iv.status,
      interviewDone: iv.done,
      interviewTotal: iv.total,
      feedback: Object.keys(feedback).length ? '已填写' : '未填写'
    };
  });
}

function buildAnswerRows(ctx) {
  const rows = [];
  ctx.sessions.forEach((session) => {
    const meta = ctx.metaFor(session);
    const scores = object(session.scores);
    const perItem = object(scores.perItem);
    const rd = object(scores.rd);
    const itemTiming = new Map(list(session.items).map((i) => [i.itemId, i]));
    Object.entries(object(session.answers)).sort((a, b) => qNumber(a[0]) - qNumber(b[0])).forEach(([itemId, answer]) => {
      const a = object(answer);
      const timing = object(itemTiming.get(itemId));
      const initial = list(a.first_ranking);
      const finalRank = list(a.final_ranking);
      rows.push({
        teacherCode: meta.code,
        name: meta.name,
        sessionId: session.sessionId,
        attemptNo: ctx.attemptNoBySession.get(session.sessionId) || '',
        itemId,
        itemTitle: QUESTION_TITLES[itemId] || '',
        initialRanking: rankText(initial),
        finalRanking: rankText(finalRank),
        orderChanged: initial.length && finalRank.length && initial.join('') !== finalRank.join('') ? '是' : '否',
        firstResponse: text(a.first_response_option),
        reviseCount: Number(a.revise_count || 0),
        score: perItem[itemId] !== undefined ? perItem[itemId] : '',
        rd: round(rd[itemId], 3),
        durationSeconds: round(Number(a.duration_ms || timing.durationMs || 0) / 1000, 2),
        enterAt: formatTs(a.enter_ts || timing.enterTs),
        submitAt: formatTs(a.submit_ts || timing.submitTs),
        focusDwell: a.focus_dwell ? JSON.stringify(a.focus_dwell) : '',
        moveLog: list(a.move_log).length ? JSON.stringify(a.move_log) : ''
      });
    });
  });
  return rows;
}

function buildSelectionRows(ctx) {
  const rows = [];
  ctx.sessions.forEach((session) => {
    const meta = ctx.metaFor(session);
    const selection = object(session.selection);
    list(selection.final).forEach((f, i) => {
      const tc = object(f.task_card);
      const profile = object(tc.teacher_answer_profile);
      rows.push({
        teacherCode: meta.code,
        name: meta.name,
        sessionId: session.sessionId,
        examAt: formatTs(session.examSubmitTs || session.createdAt),
        algo: text(selection.algo) || '历史版本/未标记',
        finalRank: f.final_rank || i + 1,
        itemId: text(f.id || tc.item_id),
        itemTitle: itemTitle(f.id || tc.item_id, tc),
        initialRanking: rankText(f.teacherInitialOrder || profile.teacherInitialOrder),
        finalRanking: rankText(f.teacherFinalOrder || profile.teacherFinalOrder),
        orderChanged: (f.orderChanged || profile.orderChanged) ? '是' : '否',
        priorityOption: text(f.priorityOption || profile.priorityOption),
        priorityPair: text(f.priorityPair || profile.priorityPair),
        sources: text(f.sources || profile.sources),
        hasTaskCard: Object.keys(tc).length ? '是' : '否'
      });
    });
  });
  return rows;
}

function buildTranscriptRows(ctx) {
  const rows = [];
  ctx.interviews.forEach((interview) => {
    const session = ctx.sessionById.get(interview.sessionId);
    const meta = ctx.metaFor(session || interview, session);
    Object.entries(object(interview.transcripts)).sort((a, b) => qNumber(a[0]) - qNumber(b[0])).forEach(([itemId, transcript]) => {
      const tr = object(transcript);
      const turns = list(tr.turns);
      if (!turns.length) {
        rows.push({ teacherCode: meta.code, name: meta.name, sessionId: interview.sessionId, itemId, itemTitle: QUESTION_TITLES[itemId] || '', scenarioStatus: statusZh(tr.status), sequence: '', role: '', content: '' });
      } else {
        turns.forEach((turn, i) => {
          const role = turn && turn.role === 'ai' ? 'AI' : (turn && turn.role === 'me' ? '教师' : text(turn && turn.role));
          rows.push({
            teacherCode: meta.code,
            name: meta.name,
            sessionId: interview.sessionId,
            itemId,
            itemTitle: QUESTION_TITLES[itemId] || '',
            scenarioStatus: statusZh(tr.status),
            sequence: i + 1,
            role,
            content: text(turn && turn.text)
          });
        });
      }
    });
  });
  return rows;
}

function buildCodingRows(ctx) {
  const rows = [];
  ctx.interviews.forEach((interview) => {
    const session = ctx.sessionById.get(interview.sessionId);
    const meta = ctx.metaFor(session || interview, session);
    Object.entries(object(interview.transcripts)).sort((a, b) => qNumber(a[0]) - qNumber(b[0])).forEach(([itemId, transcript]) => {
      const tr = object(transcript);
      const turns = list(tr.turns);
      const coding = object(tr.coding);
      const teacherTurns = turns.filter((t) => t && t.role === 'me').length;
      const aiTurns = turns.filter((t) => t && t.role === 'ai').length;
      rows.push({
        teacherCode: meta.code,
        name: meta.name,
        sessionId: interview.sessionId,
        itemId,
        itemTitle: QUESTION_TITLES[itemId] || '',
        status: statusZh(tr.status),
        startedAt: formatTs(tr.startedAt),
        submittedAt: formatTs(tr.submittedAt),
        durationMinutes: tr.startedAt && tr.submittedAt ? round((Number(tr.submittedAt) - Number(tr.startedAt)) / 60000, 2) : '',
        totalTurns: turns.length,
        aiTurns,
        teacherTurns,
        ledger: text(tr.ledger),
        level: text(coding.level),
        got: text(coding.got),
        weak: text(coding.weak),
        coding: text(coding.coding)
      });
    });
  });
  return rows;
}

function buildTaskCardRows(ctx) {
  const rows = [];
  ctx.sessions.forEach((session) => {
    const meta = ctx.metaFor(session);
    list(object(session.selection).final).forEach((f, i) => {
      const tc = object(f.task_card);
      if (!Object.keys(tc).length) return;
      const focus = object(tc.ability_focus);
      const answer = object(tc.teacher_answer_profile);
      const itemId = text(tc.item_id || f.id);
      rows.push({
        teacherCode: meta.code,
        name: meta.name,
        sessionId: session.sessionId,
        finalRank: f.final_rank || i + 1,
        itemId,
        itemTitle: itemTitle(itemId, tc),
        taskCardVersion: text(tc.task_card_version),
        initialRanking: rankText(answer.teacherInitialOrder || f.teacherInitialOrder),
        finalRanking: rankText(answer.teacherFinalOrder || f.teacherFinalOrder),
        orderChanged: (answer.orderChanged || f.orderChanged) ? '是' : '否',
        orderChangeSummary: text(answer.orderChangeSummary),
        priorityOption: text(answer.priorityOption || f.priorityOption),
        priorityPair: text(answer.priorityPair || f.priorityPair),
        sources: text(answer.sources || f.sources),
        primaryAbility: text(focus.primary_ability_type),
        secondaryAbility: text(focus.secondary_ability_type),
        mainFocus: text(focus.interview_main_focus),
        secondaryFocus: text(focus.interview_secondary_focus),
        hypotheses: numberedLines(tc.interview_hypotheses),
        evidence: numberedLines(tc.must_obtain_evidence),
        probes: numberedLines(tc.recommended_probes),
        flow: numberedLines(tc.interview_flow),
        processHints: numberedLines(tc.process_hints),
        forbiddenDisclosure: numberedLines(tc.forbidden_disclosure)
      });
    });
  });
  return rows;
}

function buildFeedbackRows(ctx) {
  return ctx.interviews.map((interview) => {
    const session = ctx.sessionById.get(interview.sessionId);
    const meta = ctx.metaFor(session || interview, session);
    const feedback = object(interview.feedback);
    return {
      teacherCode: meta.code,
      name: meta.name,
      sessionId: interview.sessionId,
      status: Object.keys(feedback).length ? '已填写' : '未填写',
      q1: text(feedback.q1),
      q2: text(feedback.q2),
      q3: text(feedback.q3),
      submittedAt: formatTs(feedback.submittedAt)
    };
  });
}

async function buildWorkbookBuffer(bundle) {
  const ctx = buildContext(bundle);
  const teacherRows = buildTeacherRows(ctx);
  const summaryRows = buildSummaryRows(ctx);
  const answerRows = buildAnswerRows(ctx);
  const selectionRows = buildSelectionRows(ctx);
  const transcriptRows = buildTranscriptRows(ctx);
  const codingRows = buildCodingRows(ctx);
  const taskCardRows = buildTaskCardRows(ctx);
  const feedbackRows = buildFeedbackRows(ctx);
  const counts = {
    interviewScenarios: codingRows.length,
    doneScenarios: codingRows.filter((r) => r.status === '已完成').length,
    pendingScenarios: codingRows.filter((r) => r.status !== '已完成').length,
    taskCards: taskCardRows.length
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '幼教慧谈';
  workbook.lastModifiedBy = '幼教慧谈';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  addReadme(workbook, bundle, ctx, counts);
  addDataSheet(workbook, '教师信息', [
    { header: '教师编号', key: 'teacherCode', width: 12 },
    { header: '当前姓名', key: 'name', width: 16 },
    { header: '历史使用姓名', key: 'historicalNames', width: 24 },
    { header: '园所', key: 'kindergarten', width: 24 },
    { header: '教龄', key: 'teachAge', width: 14 },
    { header: '当前教师账户中存在', key: 'currentAccount', width: 18 },
    { header: '测验次数', key: 'examCount', width: 12 },
    { header: '访谈记录数', key: 'interviewCount', width: 14 },
    { header: '最近测验时间', key: 'latestExamAt', width: 20 },
    { header: '最近访谈更新时间', key: 'latestInterviewAt', width: 20 }
  ], teacherRows);
  addDataSheet(workbook, '测验访谈汇总', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: '园所', key: 'kindergarten', width: 22 }, { header: '教龄', key: 'teachAge', width: 14 },
    { header: '第几次测验', key: 'attemptNo', width: 12 }, { header: 'Session ID', key: 'sessionId', width: 38 },
    { header: '测验提交时间', key: 'examAt', width: 20 }, { header: '提交状态', key: 'submitStatus', width: 16 },
    { header: '作答题数', key: 'answerCount', width: 12 }, { header: '总分', key: 'total', width: 10 },
    { header: '均分', key: 'mean', width: 10 }, { header: '水平', key: 'level', width: 12 },
    { header: '测验总时长（分钟）', key: 'totalMinutes', width: 18 }, { header: '筛选算法', key: 'selectionAlgo', width: 20 },
    { header: '入选访谈题目', key: 'selectedItems', width: 20 }, { header: '任务卡数', key: 'taskCardCount', width: 12 },
    { header: '访谈状态', key: 'interviewStatus', width: 12 }, { header: '已完成情境数', key: 'interviewDone', width: 14 },
    { header: '访谈情境总数', key: 'interviewTotal', width: 14 }, { header: '访谈反馈', key: 'feedback', width: 12 }
  ], summaryRows);
  addDataSheet(workbook, '作答明细', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '测验序次', key: 'attemptNo', width: 10 },
    { header: '题号', key: 'itemId', width: 8 }, { header: '情境简称', key: 'itemTitle', width: 24 },
    { header: '初始排序', key: 'initialRanking', width: 14 }, { header: '最终排序', key: 'finalRanking', width: 14 },
    { header: '是否修改排序', key: 'orderChanged', width: 14 }, { header: '首反应选项', key: 'firstResponse', width: 12 },
    { header: '修改次数', key: 'reviseCount', width: 10 }, { header: '该题得分', key: 'score', width: 10 },
    { header: 'RD', key: 'rd', width: 10 }, { header: '作答时长（秒）', key: 'durationSeconds', width: 15 },
    { header: '进入时间', key: 'enterAt', width: 20 }, { header: '提交时间', key: 'submitAt', width: 20 },
    { header: '停顿数据', key: 'focusDwell', width: 30 }, { header: '排序移动日志', key: 'moveLog', width: 45 }
  ], answerRows);
  addDataSheet(workbook, '情境筛选', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '测验时间', key: 'examAt', width: 20 },
    { header: '筛选算法', key: 'algo', width: 20 }, { header: '最终优先级', key: 'finalRank', width: 12 },
    { header: '题号', key: 'itemId', width: 8 }, { header: '情境简称', key: 'itemTitle', width: 24 },
    { header: '初始排序', key: 'initialRanking', width: 14 }, { header: '最终排序', key: 'finalRanking', width: 14 },
    { header: '排序是否变化', key: 'orderChanged', width: 14 }, { header: '重点选项', key: 'priorityOption', width: 12 },
    { header: '重点比较对', key: 'priorityPair', width: 14 }, { header: '入选来源', key: 'sources', width: 30 },
    { header: '是否有完整任务卡', key: 'hasTaskCard', width: 18 }
  ], selectionRows);
  addDataSheet(workbook, '访谈逐字稿', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '题号', key: 'itemId', width: 8 },
    { header: '情境简称', key: 'itemTitle', width: 24 }, { header: '情境访谈状态', key: 'scenarioStatus', width: 14 },
    { header: '发言序号', key: 'sequence', width: 10 }, { header: '发言者', key: 'role', width: 10 },
    { header: '逐字内容', key: 'content', width: 90 }
  ], transcriptRows);
  addDataSheet(workbook, '访谈编码', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '题号', key: 'itemId', width: 8 },
    { header: '情境简称', key: 'itemTitle', width: 24 }, { header: '状态', key: 'status', width: 12 },
    { header: '开始时间', key: 'startedAt', width: 20 }, { header: '提交时间', key: 'submittedAt', width: 20 },
    { header: '访谈时长（分钟）', key: 'durationMinutes', width: 17 }, { header: '总发言轮数', key: 'totalTurns', width: 12 },
    { header: 'AI发言数', key: 'aiTurns', width: 10 }, { header: '教师发言数', key: 'teacherTurns', width: 12 },
    { header: '证据账本', key: 'ledger', width: 24 }, { header: '编码水平', key: 'level', width: 14 },
    { header: '已获得证据', key: 'got', width: 28 }, { header: '薄弱/缺失证据', key: 'weak', width: 28 },
    { header: '编码说明', key: 'coding', width: 60 }
  ], codingRows);
  addDataSheet(workbook, '访谈任务卡', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '最终优先级', key: 'finalRank', width: 12 },
    { header: '题号', key: 'itemId', width: 8 }, { header: '情境简称', key: 'itemTitle', width: 24 },
    { header: '任务卡版本', key: 'taskCardVersion', width: 16 }, { header: '初始排序', key: 'initialRanking', width: 14 },
    { header: '最终排序', key: 'finalRanking', width: 14 }, { header: '排序是否变化', key: 'orderChanged', width: 14 },
    { header: '排序变化摘要', key: 'orderChangeSummary', width: 32 }, { header: '重点选项', key: 'priorityOption', width: 12 },
    { header: '重点比较对', key: 'priorityPair', width: 14 }, { header: '入选来源', key: 'sources', width: 30 },
    { header: '主要能力方向', key: 'primaryAbility', width: 30 }, { header: '次要能力方向', key: 'secondaryAbility', width: 30 },
    { header: '访谈主焦点', key: 'mainFocus', width: 60 }, { header: '访谈次焦点', key: 'secondaryFocus', width: 60 },
    { header: '待检验假设', key: 'hypotheses', width: 70 }, { header: '必须获得的证据', key: 'evidence', width: 70 },
    { header: '建议追问', key: 'probes', width: 80 }, { header: '建议访谈流程', key: 'flow', width: 70 },
    { header: '过程提示', key: 'processHints', width: 50 }, { header: '禁止透露内容', key: 'forbiddenDisclosure', width: 55 }
  ], taskCardRows);
  addDataSheet(workbook, '访谈反馈', [
    { header: '教师编号', key: 'teacherCode', width: 12 }, { header: '姓名', key: 'name', width: 16 },
    { header: 'Session ID', key: 'sessionId', width: 38 }, { header: '反馈状态', key: 'status', width: 12 },
    { header: 'Q1 整体感受', key: 'q1', width: 50 }, { header: 'Q2 印象较深的问题或内容', key: 'q2', width: 65 },
    { header: 'Q3 可改进之处', key: 'q3', width: 65 }, { header: '提交时间', key: 'submittedAt', width: 20 }
  ], feedbackRows);

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  SHEET_NAMES,
  buildWorkbookBuffer,
  formatTs
};
