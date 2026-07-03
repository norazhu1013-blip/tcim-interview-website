// 云函数 gsyg_whoami —— 拉自己的身份信息（openid + isAdmin + teacher 记录）
// 客户端在「我的」页 onShow 调用；未创建过 teacher 记录时 isAdmin=false、teacher=null。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'gsyg_teachers';

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  try {
    const r = await db.collection(COLL).where({ openid: OPENID }).limit(1).get();
    const rec = r.data && r.data[0];
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
