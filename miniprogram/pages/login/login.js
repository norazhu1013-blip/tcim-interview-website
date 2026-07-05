// P0 登录 —— 授权手机号按钮始终在(功能常驻)：
//   授权成功 → 换号：有权限存真实号；无权限(-604101)/失败则空号，已授权仍放行。
//   拒绝授权 → 据云函数探测的主体权限决定：有权限=强制授权(停留)，无权限=仍放行(免授权)。
const { getProfile, isLoggedIn, saveLogin } = require('../../utils/store.js');
const api = require('../../utils/api.js');

Page({
  data: { logging: false },
  _hasPermission: null, // null=未探测；true/false 来自 checkPhonePermission

  onLoad() {
    if (isLoggedIn()) { this.go(); return; }
    // 后台探测主体是否有手机号组件权限（据云函数返回值，用于"拒绝授权"分支决策）
    api.checkPhonePermission().then((has) => { this._hasPermission = has; });
  },

  go() {
    const profile = getProfile();
    wx.switchTab({ url: profile && profile.name ? '/pages/home/home' : '/pages/profile/profile' });
  },

  // 记录 wx.login code（首次完善信息时可带给后端），不阻塞
  cacheLoginCode() {
    wx.login({ complete: (r) => { try { if (r && r.code) wx.setStorageSync('wx_login_code', r.code); } catch (err) {} } });
  },

  // 手机号授权按钮回调（open-type="getPhoneNumber"）
  onGetPhone(e) {
    if (this.data.logging) return;
    const detail = e && e.detail;
    const code = detail && detail.code;
    const authorized = !!(detail && detail.errMsg === 'getPhoneNumber:ok' && code);

    if (authorized) {
      // 已授权即视为登录成功；换号：有权限存真实号，无权限(-604101)/失败则空号仍放行
      this.setData({ logging: true });
      this.cacheLoginCode();
      api.getPhoneNumber(code).then((res) => {
        saveLogin({ phone: (res && res.phone) || '', openId: (res && res.openId) || '' });
        this.setData({ logging: false });
        this.go();
      });
      return;
    }

    // 用户拒绝授权：有权限 → 强制授权(停留)；无权限 → 免授权放行
    const decide = (has) => {
      if (has) { wx.showToast({ title: '需授权手机号后才能使用', icon: 'none' }); return; }
      this.setData({ logging: true });
      this.cacheLoginCode();
      saveLogin({ phone: '', openId: '' });
      this.setData({ logging: false });
      this.go();
    };
    if (this._hasPermission === null) {
      api.checkPhonePermission().then((h) => { this._hasPermission = h; decide(h); });
    } else {
      decide(this._hasPermission);
    }
  }
});
