// 云函数 gsyg_getPhoneNumber —— 两用：
//  1) 换号：传 { code }（getPhoneNumber 新版返回的手机号 code）→ 换真实手机号。
//  2) 探测权限：传 { probe:true }（无真实 code）→ 用占位 code 触发 openapi 的权限前置校验，
//     据返回区分主体是否具备「手机号快速验证组件」权限。
// 客户端据 noPermission 决定登录页是「强制授权」还是「免授权」。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }); // 自动用当前云环境（= cloud1-2gefzeri3cb333f2）

// 判定是否为「无权限」错误（-604101 function has no permission to call this API）
function isNoPermission(e) {
  const msg = (e && (e.errMsg || e.message)) || '';
  const code = e && (e.errCode || e.code);
  return code === -604101 || /-?604101|has no permission|no permission to call/i.test(String(msg));
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const probe = !!(event && event.probe);
  // 探测模式用占位 code 强制走到 openapi（权限校验先于 code 校验发生）
  const code = (event && event.code) || (probe ? 'permission-probe' : '');
  if (!code) return { ok: false, error: 'missing_code', openid: OPENID };
  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code: code });
    const info = (res && res.phoneInfo) || {};
    return {
      ok: true,
      phone: info.phoneNumber || '',
      purePhone: info.purePhoneNumber || '',
      countryCode: info.countryCode || '',
      openid: OPENID
    };
  } catch (e) {
    const noPermission = isNoPermission(e);
    return {
      ok: false,
      error: (e && (e.errMsg || e.message)) || 'openapi_fail',
      errCode: (e && (e.errCode || e.code)) || null,
      noPermission: noPermission, // true=主体无手机号组件权限；false=有权限（本次多因占位/无效 code 失败）
      openid: OPENID
    };
  }
};
