// 云函数 gsyg_reportDraft —— 逐轮访谈草稿 → 集合 gsyg_interview_drafts
// 按 openid + sessionId + itemId 幂等 upsert；turnSeq 记录第几轮（教师第几条回答），
// 用于乱序保护（旧一轮不得覆盖新草稿）。浏览器本地保存只作离线副本，这里才是研究数据的来源。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_interview_drafts';

function resolveActor(event) {
  const gateway = event && event.__gsygGateway;
  if (gateway && gateway.token && gateway.token === process.env.GSYG_WEB_GATEWAY_TOKEN && /^web:[A-Za-z0-9_-]{4,128}$/.test(gateway.actor || '')) {
    return {
      id: gateway.actor,
      identityType: gateway.identityType === 'web_account' ? 'web_account' : (gateway.identityType === 'web_wechat' ? 'web_wechat' : 'web_anonymous')
    };
  }
  const { OPENID } = cloud.getWXContext();
  return { id: OPENID, identityType: 'wechat' };
}

exports.main = async (event) => {
  const actor = resolveActor(event);
  if (!actor.id) return { ok: false, error: 'missing_identity' };
  const sessionId = event.sessionId;
  const itemId = event.itemId;
  const turnSeq = Number(event.turnSeq || 0);
  if (!sessionId || !itemId || !Number.isFinite(turnSeq) || turnSeq < 0) {
    return { ok: false, error: 'missing_draft_key' };
  }
  try {
    const now = Date.now();
    const existing = await db.collection(COLL).where({ openid: actor.id, sessionId: sessionId, itemId: itemId }).limit(1).get();
    if (existing.data && existing.data.length) {
      const doc = existing.data[0];
      // 乱序保护：拒绝旧一轮覆盖新草稿（幂等返回，不报错）
      if (turnSeq < Number(doc.turnSeq || 0)) {
        return { ok: true, id: doc._id, staleTurnRejected: true, serverUpdatedAt: doc.updatedAt };
      }
      await db.collection(COLL).doc(doc._id).update({
        data: {
          turnSeq: turnSeq,
          status: event.status || 'in_progress',
          messages: event.messages || null,
          updatedAt: now
        }
      });
      return { ok: true, id: doc._id, serverUpdatedAt: now };
    }
    const r = await db.collection(COLL).add({
      data: {
        openid: actor.id,
        identityType: actor.identityType,
        sessionId: sessionId,
        itemId: itemId,
        turnSeq: turnSeq,
        status: event.status || 'in_progress',
        messages: event.messages || null,
        createdAt: now,
        updatedAt: now
      }
    });
    return { ok: true, id: r._id, serverUpdatedAt: now };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
