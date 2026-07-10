// P0 登录 —— 简化版(2026-07-09 建议):去掉手机号授权,只做静默 wx.login 取 openid。
//   进入即静默 wx.login;有 profile 直接跳 home,没有跳 profile 引导填写。
const { getProfile, isLoggedIn, saveLogin } = require('../../utils/store.js');

Page({
  onLoad() {
    // 静默 wx.login 取 code(用于后端换 openid;不阻塞跳转)
    wx.login({ complete: (r) => { try { if (r && r.code) wx.setStorageSync('wx_login_code', r.code); } catch (err) {} } });
    // 老用户 phoneAuthed 也算已登录;新用户看是否已有 profile
    if (isLoggedIn()) { this.go(); return; }
    // 首次进入:标记 loginState,后续以 profile 是否已填为准
    saveLogin({ phone: '', openId: '' });
  },

  go() {
    const profile = getProfile();
    wx.switchTab({ url: profile && profile.name ? '/pages/home/home' : '/pages/profile/profile' });
  },

  onEnter() { this.go(); }
});
