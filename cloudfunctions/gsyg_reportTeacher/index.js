// 云函数 gsyg_reportTeacher —— 完善信息时上报教师信息 → 集合 gsyg_teachers
// 客户端不直写 DB：本函数用 wx-server-sdk 拿 openid 并按 openid upsert。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }); // 自动用当前云环境（= cloud1-2gefzeri3cb333f2）

const db = cloud.database();
const COLL = 'gsyg_teachers';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const now = Date.now();
    const payload = { openid: OPENID, profile: event.profile || null, updatedAt: now };
    const existing = await db.collection(COLL).where({ openid: OPENID }).limit(1).get();
    if (existing.data && existing.data.length) {
      const id = existing.data[0]._id;
      await db.collection(COLL).doc(id).update({ data: payload });
      return { ok: true, id: id };
    }
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now }, payload) });
    return { ok: true, id: r._id };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
