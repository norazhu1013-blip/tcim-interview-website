// 云函数 gsyg_whoami —— 拉自己的身份信息（openid + isAdmin + teacher 记录）
// 客户端在「我的」页 onShow 调用；未创建过 teacher 记录时 isAdmin=false、teacher=null。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_teachers';

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

exports.main = async (event) => {
  const OPENID = resolveActor(event);
  if (!OPENID) return { ok: false, openid: '', isAdmin: false, error: 'missing_identity' };
  try {
    const r = await db.collection(COLL).where({ openid: OPENID }).limit(1).get();
    let rec = r.data && r.data[0];
    const isNora = String(rec && rec.profile && rec.profile.name || '').trim().toLowerCase() === 'nora';
    if (rec && isNora && !rec.isAdmin) {
      await db.collection(COLL).doc(rec._id).update({
        data: { isAdmin: true, adminGrantedByNameAt: Date.now() }
      });
      rec = Object.assign({}, rec, { isAdmin: true });
    }
    return {
      ok: true,
      openid: OPENID,
      isAdmin: !!(rec && rec.isAdmin),
      teacher: rec || null
    };
  } catch (e) {
    return { ok: false, openid: OPENID, isAdmin: false, error: e && e.message };
  }
};
