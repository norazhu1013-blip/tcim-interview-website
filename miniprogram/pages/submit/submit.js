// P3 提交完成
const store = require('../../utils/store.js');

Page({
  data: { sid: '', planned: 3, timeout: false },

  onLoad(q) {
    const s = store.getSession(q.sid) || {};
    const planned = (s.selection && s.selection.final && s.selection.final.length) || 3;
    this.setData({ sid: q.sid, planned, timeout: s.status === 'timeout_submitted' });
  },

  onSelect() {
    wx.redirectTo({ url: '/pages/interviewList/interviewList?sid=' + this.data.sid });
  },
  onHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
