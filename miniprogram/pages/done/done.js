// P9 访谈完成
const store = require('../../utils/store.js');

Page({
  data: {},
  onShow() {
    if (!store.requireLogin()) return;
  },
  onHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
