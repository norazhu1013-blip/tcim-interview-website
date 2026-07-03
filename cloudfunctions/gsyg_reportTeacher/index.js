// 云函数 gsyg_reportTeacher —— 完善信息时上报教师信息 → 集合 gsyg_teachers
// 客户端不直写 DB：本函数用 wx-server-sdk 拿 openid 并按 openid upsert。
// isAdmin 由后台在数据库控制台手工置 true，客户端上传的 profile 里的 isAdmin 会被忽略。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_teachers';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const now = Date.now();
    const payload = { openid: OPENID, profile: event.profile || null, updatedAt: now };
    const existing = await db.collection(COLL).where({ openid: OPENID }).limit(1).get();
    if (existing.data && existing.data.length) {
      const rec = existing.data[0];
      await db.collection(COLL).doc(rec._id).update({ data: payload });
      return { ok: true, id: rec._id, openid: OPENID, isAdmin: !!rec.isAdmin };
    }
    // 新建：isAdmin 默认 false；管理员由后台在控制台改为 true
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now, isAdmin: false }, payload) });
    return { ok: true, id: r._id, openid: OPENID, isAdmin: false };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
