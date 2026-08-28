// 云函数 gsyg_reportTeacher —— 完善信息时上报教师信息 → 集合 gsyg_teachers
// 客户端不直写 DB：本函数用 wx-server-sdk 拿 openid 并按 openid upsert。
// isAdmin 由后台在数据库控制台手工置 true，客户端上传的 profile 里的 isAdmin 会被忽略。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_teachers';

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
  try {
    const now = Date.now();
    const payload = { openid: actor.id, identityType: actor.identityType, profile: event.profile || null, updatedAt: now };
    const existing = await db.collection(COLL).where({ openid: actor.id }).limit(1).get();
    if (existing.data && existing.data.length) {
      const rec = existing.data[0];
      await db.collection(COLL).doc(rec._id).update({ data: payload });
      return { ok: true, id: rec._id, openid: actor.id, isAdmin: !!rec.isAdmin };
    }
    // 新建：isAdmin 默认 false；管理员由后台在控制台改为 true
    const r = await db.collection(COLL).add({ data: Object.assign({ createdAt: now, isAdmin: false }, payload) });
    return { ok: true, id: r._id, openid: actor.id, isAdmin: false };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
};
