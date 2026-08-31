// 云函数 gsyg_reportSession —— 答题结束上报 → 集合 gsyg_sessions
// 按 sessionId（前端 UUID，业务主键）upsert；含 answers/scores/total/selection + 答题时间字段。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_sessions';

function resolveActor(event) {
  const gateway = event && event.__gsygGateway;
  if (gateway && gateway.token && gateway.token === process.env.GSYG_WEB_GATEWAY_TOKEN && /^web:[A-Za-z0-9_-]{4,128}$/.test(gateway.actor || '')) {
    return { id: gateway.actor, identityType: gateway.identityType === 'web_account' ? 'web_account' : (gateway.identityType === 'web_wechat' ? 'web_wechat' : 'web_anonymous') };
  }
  const { OPENID } = cloud.getWXContext();
  return { id: OPENID, identityType: 'wechat' };
}

exports.main = async (event) => {
  const actor = resolveActor(event);
  if (!actor.id) return { ok: false, error: 'missing_identity' };
  const sessionId = event.sessionId;
  if (!sessionId) return { ok: false, error: 'missing_sessionId' };
  try {
    const now = Date.now();
    const data = {
      openid: actor.id,
      identityType: actor.identityType,
      sessionId: sessionId,
      studyMode: event.studyMode === 'single_trial' ? 'single_trial' : 'full_assessment',
      targetItemId: event.studyMode === 'single_trial' && event.targetItemId === 'Q4' ? 'Q4' : null,
      profile: event.profile || null,
      answers: event.answers || {},
      scores: event.scores || null,
      total: event.total != null ? event.total : null,
      submitStatus: event.submitStatus || null,
      // 时间字段（用于 P-IVI/筛选与后续分析；评分不依赖时间）
      items: event.items || [],
      examStartTs: event.examStartTs || null,
      examSubmitTs: event.examSubmitTs || null,
      totalDurationMs: event.totalDurationMs || 0,
      releaseSnapshot: event.releaseSnapshot && typeof event.releaseSnapshot === 'object'
        ? event.releaseSnapshot
        : null,
      updatedAt: now
    };
    // selection 只在客户端传了完整对象时才写;传 null / 空则不入 data,避免把
    // 字段值置为 null(后续 gsyg_selectFinal 用 sub-path update 会报
    // -502001 "Cannot create field 'algo' in element {selection: null}")。
    if (event.selection && typeof event.selection === 'object') {
      data.selection = event.selection;
    }
    const existing = await db.collection(COLL).where({ sessionId: sessionId }).limit(1).get();
    if (existing.data && existing.data.length) {
      const id = existing.data[0]._id;
      if (existing.data[0].openid !== actor.id) return { ok: false, error: 'forbidden' };
      // 发布身份按首次写入冻结，后续重传不得把历史会话改写成新版本。
      data.releaseSnapshot = existing.data[0].releaseSnapshot || data.releaseSnapshot;
      await db.collection(COLL).doc(id).update({ data: data });
      return { ok: true, id: id };
    }
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now }, data) });
    return { ok: true, id: r._id };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
