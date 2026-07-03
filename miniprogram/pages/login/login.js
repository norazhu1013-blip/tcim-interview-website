// P0 微信登录
const { getProfile } = require('../../utils/store.js');

Page({
  data: { logging: false },

  onLoad() {
    // 已登录并完善信息则直接进「答题」Tab
    const profile = getProfile();
    if (profile && profile.name) {
      wx.switchTab({ url: '/pages/home/home' });
    }
  },

  onLogin() {
    if (this.data.logging) return;
    this.setData({ logging: true });
    // wx.login 占位：换取 code，交由后端换 openId（此处仅演示，不阻塞）
    wx.login({
      complete: (res) => {
        const code = res && res.code ? res.code : '';
        const profile = getProfile();
        // 记录本次登录 code（首次完善信息时可带给后端）
        try { if (code) wx.setStorageSync('wx_login_code', code); } catch (e) {}
        this.setData({ logging: false });
        if (profile && profile.name) {
          // 已完善信息，直接进「答题」Tab
          wx.switchTab({ url: '/pages/home/home' });
        } else {
          // 首次登录 → 「我的」Tab 完善信息
          wx.switchTab({ url: '/pages/profile/profile' });
        }
      }
    });
  }
});
