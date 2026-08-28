// 云函数 gsyg_exportData —— 管理员导出原始 JSON 或研究整理版 Excel
// 认证：调用者的 gsyg_teachers 记录 isAdmin=true。非管理员 return { ok:false, error:'forbidden' }
// event（可选）:
//   collections: ["teachers","sessions","interviews"]  不传则三张全导
//   since: 时间戳 ms  只导 updatedAt >= since 的增量（默认全量）
//   format: "json" | "xlsx"  默认 xlsx；旧版小程序不传 format 时也直接得到整理版 Excel
// 返回：{ ok, format, fileID, downloadURL, expireAt, count:{teachers,sessions,interviews} }
const cloud = require('wx-server-sdk');
const { buildWorkbookBuffer } = require('./workbook');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLL = {
  teachers: 'gsyg_teachers',
  sessions: 'gsyg_sessions',
  interviews: 'gsyg_interviews',
  drafts: 'gsyg_interview_drafts'
};

const PAGE = 100; // 微信云数据库单次 get 上限

function resolveActor(event) {
  const gateway = event && event.__gsygGateway;
  if (
    gateway &&
    gateway.token &&
    gateway.token === process.env.GSYG_WEB_GATEWAY_TOKEN &&
    /^web:[A-Za-z0-9_-]{4,128}$/.test(gateway.actor || '')
  ) return gateway.actor;
  return cloud.getWXContext().OPENID;
}

async function isAdmin(openid) {
  if (!openid) return false;
  const r = await db.collection(COLL.teachers).where({ openid: openid }).limit(1).get();
  return !!(r.data && r.data[0] && r.data[0].isAdmin);
}

async function fetchAll(collName, since, websiteOnly) {
  const out = [];
  const where = since ? { updatedAt: _.gte(Number(since)) } : {};
  let skip = 0;
  // 循环拉，直到不足一页
  // 注：大表建议叠加 orderBy+_id 分页，这里用 skip/limit 简单实现；万级以内没问题
  // 上限 100 页（=1w 条）作保护
  for (let i = 0; i < 100; i++) {
    const r = await db.collection(collName).where(where).skip(skip).limit(PAGE).get();
    const rows = (r && r.data) || [];
    const arr = websiteOnly
      ? rows.filter((row) => String(row && row.openid || '').startsWith('web:'))
      : rows;
    out.push.apply(out, arr);
    if (rows.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function stamp() {
  // 云函数无时区问题，用 UTC+8 手工偏
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + '-' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
}

exports.main = async (event) => {
  event = event || {};
  const OPENID = resolveActor(event);
  const websiteOnly = String(OPENID || '').startsWith('web:');

  // 认证
  if (!(await isAdmin(OPENID))) {
    return { ok: false, error: 'forbidden', hint: '当前 openid 不在管理员列表；请在云开发控制台把该 teacher 记录 isAdmin 改为 true' };
  }

  const which = Array.isArray(event.collections) && event.collections.length ? event.collections : ['teachers', 'sessions', 'interviews', 'drafts'];
  const since = event.since ? Number(event.since) : null;
  // 向后兼容已发布的旧版小程序：旧页面调用 exportData({})，没有 format。
  // 缺省时返回研究者更容易使用的 Excel；只有明确传 json 才导出原始 JSON。
  // 两种格式都只是读取数据库并新建带时间戳的文件，不会修改数据或覆盖既有导出。
  const format = event.format === 'json' ? 'json' : 'xlsx';

  try {
    const bundle = { exportedAt: Date.now(), since: since, operator: OPENID, data: {} };
    const count = {};
    const stats = {}; // 各集合的分类统计,便于导出后 QA
    for (const k of which) {
      if (!COLL[k]) continue;
      const rows = await fetchAll(COLL[k], since, websiteOnly);
      bundle.data[k] = rows;
      count[k] = rows.length;
      // sessions:统计已遴选/待遴选;展平 task_card 索引方便研究者审阅
      if (k === 'sessions') {
        let withCard = 0, withoutCard = 0, pending = 0, otherAlgo = 0;
        const taskCardIndex = []; // [{ participantName, userOpenid, sessionId, final_rank, item_id, item_title, hypotheses, evidence, probes, priorityOption, priorityPair, teacherFinalOrder }]
        for (const r of rows) {
          const s = r.selection;
          if (!s || !s.algo) { pending++; continue; }
          const isAdvisor = typeof s.algo === 'string' && s.algo.indexOf('advisor_v') === 0;
          if (!isAdvisor) { otherAlgo++; continue; }
          if (!Array.isArray(s.final) || !s.final.length) { pending++; continue; }
          const hasCard = !!(s.final[0] && s.final[0].task_card);
          if (hasCard) {
            withCard++;
            const participant = (r.profile && r.profile.name) || '';
            for (const f of s.final) {
              const tc = f.task_card || {};
              taskCardIndex.push({
                participantName: participant,
                userOpenid: r.openid || '',
                sessionId: r.sessionId || '',
                final_rank: f.final_rank,
                item_id: f.id,
                item_title: tc.item_title || '',
                teacherFinalOrder: f.teacherFinalOrder || '',
                teacherInitialOrder: f.teacherInitialOrder || '',
                orderChanged: !!f.orderChanged,
                priorityOption: f.priorityOption || '',
                priorityPair: f.priorityPair || '',
                sources: (f.sources || []).join('/'),
                interview_main_focus: (tc.ability_focus && tc.ability_focus.interview_main_focus) || '',
                hypotheses_count: (tc.interview_hypotheses || []).length,
                must_evidence_count: (tc.must_obtain_evidence || []).length,
                probes_count: (tc.recommended_probes || []).length
              });
            }
          } else { withoutCard++; }
        }
        stats.sessions = {
          selected_with_task_card: withCard,       // v1.2+ 完整任务卡
          selected_no_task_card: withoutCard,      // v1/v1.1 老 session,建议重跑
          missing_selection: pending,              // 未走 gsyg_selectFinal
          other_algo: otherAlgo
        };
        bundle.task_card_index = taskCardIndex;
        stats.task_card_index_size = taskCardIndex.length;
      }
      // 逐轮草稿（1.3）：进行中/已完成统计，让研究者一眼看出哪些访谈尚未收尾
      if (k === 'drafts') {
        let inProgress = 0, done = 0;
        for (const r of rows) { if (r.status === 'done') done++; else inProgress++; }
        stats.drafts = { in_progress: inProgress, done, total: rows.length };
      }
    }
    bundle.stats = stats;

    // 原始 JSON 负责完整备份；整理版 Excel 负责研究阅读与分析。
    // JSON 使用缩进格式，便于必要时人工查看；Excel 不包含 openid/_id/wxCode 等运行字段。
    const suffix = since ? '-since' + since : (format === 'xlsx' ? '-readable' : '-full');
    const cloudPath = 'gsyg-exports/' + stamp() + suffix + '.' + format;
    const buf = format === 'xlsx'
      ? await buildWorkbookBuffer(bundle)
      : Buffer.from(JSON.stringify(bundle, null, 2));
    const up = await cloud.uploadFile({ cloudPath: cloudPath, fileContent: buf });
    const fileID = up.fileID;

    // 拿下载 URL（有效期由平台决定，通常 2 小时）
    const url = await cloud.getTempFileURL({ fileList: [fileID] });
    const first = url && url.fileList && url.fileList[0];
    const downloadURL = (first && first.tempFileURL) || '';

    return {
      ok: true,
      format: format,
      fileID: fileID,
      downloadURL: downloadURL,
      cloudPath: cloudPath,
      bytes: buf.length,
      count: count,
      stats: stats,
      expireAt: Date.now() + 2 * 3600 * 1000, // 名义 2 小时，具体以 downloadURL 为准
      exportedAt: bundle.exportedAt
    };
  } catch (e) {
    return { ok: false, error: (e && (e.errMsg || e.message)) || 'export_failed' };
  }
};
