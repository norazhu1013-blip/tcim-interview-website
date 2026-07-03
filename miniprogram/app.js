// app.js — 全局入口
const { getProfile } = require('./utils/store.js');
const { CLOUD_ENV } = require('./utils/config.js');

App({
  globalData: {
    profile: null,
    cloudReady: false // 云开发是否可用（基础库支持 wx.cloud 且 init 成功）
  },

  onLaunch() {
    // 初始化微信云开发（CloudBase）。基础库不支持时优雅降级，仅本地存储。
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
      } catch (e) {
        this.globalData.cloudReady = false;
      }
    } else {
      this.globalData.cloudReady = false;
    }

    // 读取本地已保存的教师信息
    try {
      this.globalData.profile = getProfile();
    } catch (e) {
      this.globalData.profile = null;
    }
  },

  onShow() {
    // 网络恢复/再次进入时，尝试重传失败的上报（不阻塞）
    try {
      require('./utils/api.js').flushPending();
    } catch (e) {}
  }
});
