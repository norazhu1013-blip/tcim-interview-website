// 云函数 gsyg_reportInterview —— 访谈结束上报 → 集合 gsyg_interviews
// 按 sessionId upsert；transcripts = 该次全部情境访谈记录。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_interviews';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const sessionId = event.sessionId;
  if (!sessionId) return { ok: false, error: 'missing_sessionId' };
  try {
    const now = Date.now();
    const data = {
      openid: OPENID,
      sessionId: sessionId,
      transcripts: event.transcripts || null,
      updatedAt: now
    };
    const existing = await db.collection(COLL).where({ sessionId: sessionId }).limit(1).get();
    if (existing.data && existing.data.length) {
      const id = existing.data[0]._id;
      await db.collection(COLL).doc(id).update({ data: data });
      return { ok: true, id: id };
    }
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now }, data) });
    return { ok: true, id: r._id };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
