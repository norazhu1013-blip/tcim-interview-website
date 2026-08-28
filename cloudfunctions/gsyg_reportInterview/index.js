// 云函数 gsyg_reportInterview —— 访谈结束上报 → 集合 gsyg_interviews
// 按 sessionId upsert；transcripts = 该次全部情境访谈记录；feedback = 三题完成后的整体反馈(3 问)。
// feedback 只在有值时写入,避免每题上报(feedback=null)覆盖掉已提交的反馈。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const crypto = require('crypto');

const db = cloud.database();
const COLL = 'gsyg_interviews';

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
    // 乱序保护：客户端每次上报自增 reportRevision；旧 revision 晚到即拒绝覆盖。
    const incomingRevision = Number(event.revision || 0);
    const data = {
      openid: actor.id,
      identityType: actor.identityType,
      sessionId: sessionId,
      studyMode: event.studyMode === 'single_trial' ? 'single_trial' : 'full_assessment',
      targetItemId: event.studyMode === 'single_trial' && event.targetItemId === 'Q4' ? 'Q4' : null,
      transcripts: event.transcripts || null,
      updatedAt: now,
      reportRevision: incomingRevision
    };
    // 仅在带 feedback 时写入(不用 null 覆盖既有反馈)
    if (event.feedback) data.feedback = event.feedback;
    // 回执：客户端据此确认真实落库，避免"页面完成但库无记录"。
    const payloadHash = crypto.createHash('sha256')
      .update(JSON.stringify({ sessionId, studyMode: data.studyMode, targetItemId: data.targetItemId, transcripts: data.transcripts, feedback: event.feedback || null }))
      .digest('hex');
    const existing = await db.collection(COLL).where({ sessionId: sessionId }).limit(1).get();
    if (existing.data && existing.data.length) {
      const id = existing.data[0]._id;
      if (existing.data[0].openid !== actor.id) return { ok: false, error: 'forbidden' };
      const storedRevision = Number(existing.data[0].reportRevision || 0);
      if (Number.isFinite(incomingRevision) && incomingRevision > 0 && incomingRevision < storedRevision) {
        // 旧一轮晚到 → 拒绝覆盖,幂等返回现有回执
        return { ok: true, id, staleRejected: true, serverUpdatedAt: existing.data[0].updatedAt || now, payloadHash: existing.data[0].payloadHash || payloadHash };
      }
      await db.collection(COLL).doc(id).update({ data: data });
      return { ok: true, id: id, serverRecordId: id, serverUpdatedAt: now, payloadHash };
    }
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now }, data) });
    return { ok: true, id: r._id, serverRecordId: r._id, serverUpdatedAt: now, payloadHash };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
