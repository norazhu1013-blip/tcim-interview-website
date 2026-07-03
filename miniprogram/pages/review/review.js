// P6 看答题（回看排序）
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');

Page({
  data: { sid: '', pages: [], swiperIdx: 0, cur: {} },

  onLoad(q) {
    const s = store.getSession(q.sid);
    if (!s) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    const pages = ITEMS.map((it) => {
      const a = s.answers[it.item_id];
      const ranking = (a && a.final_ranking) || ['A', 'B', 'C', 'D'];
      const rows = ranking.map((opt, i) => ({
        opt,
        pos: i + 1,
        last: i === ranking.length - 1,
        text: it.options[opt]
      }));
      const score = s.scores && s.scores.perItem[it.item_id] != null ? s.scores.perItem[it.item_id] : '-';
      return { id: it.item_id, title: it.title, rows, score };
    });
    this.setData({ sid: q.sid, pages, cur: { id: pages[0].id, title: pages[0].title } });
  },

  onSwipe(e) {
    const i = e.detail.current;
    const p = this.data.pages[i];
    this.setData({ swiperIdx: i, cur: { id: p.id, title: p.title } });
  }
});
