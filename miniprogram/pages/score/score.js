// P4 评分结果
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');

Page({
  data: { sid: '', scores: {}, rows: [] },

  onLoad(q) {
    const s = store.getSession(q.sid);
    if (!s || !s.scores) {
      wx.showToast({ title: '暂无评分', icon: 'none' });
      return;
    }
    const titleOf = {};
    ITEMS.forEach((it) => (titleOf[it.item_id] = it.title));
    const rows = ITEMS.map((it) => ({
      id: it.item_id,
      title: it.title,
      score: s.scores.perItem[it.item_id] != null ? s.scores.perItem[it.item_id] : '-'
    }));
    this.setData({ sid: q.sid, scores: s.scores, rows });
  },

  onSelect() {
    wx.navigateTo({ url: '/pages/select/select?sid=' + this.data.sid });
  }
});
