// P5 自动筛选 3 题
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');
const { SECONDARY_NAME } = require('../../data/indicatorMap.js');

Page({
  data: {
    sid: '',
    examCount: ITEMS.length,
    finalCount: 3,
    finals: [],
    routeR: '—', routeP: '—', routeG: '—',
    coverText: ''
  },

  onLoad(q) {
    const s = store.getSession(q.sid);
    if (!s || !s.selection) {
      wx.showToast({ title: '暂无筛选结果', icon: 'none' });
      return;
    }
    const titleOf = {};
    ITEMS.forEach((it) => (titleOf[it.item_id] = it.title));

    const sel = s.selection;
    const finals = sel.final.map((f) => ({
      id: f.id,
      title: titleOf[f.id] || '',
      secName: (f.sec || '?') + ' · ' + (SECONDARY_NAME[f.sec] || ''),
      sourceText: (f.sources || []).join(' / '),
      tagText: f.tags && f.tags.length ? ' · ' + f.tags.join('、') : ''
    }));
    const covers = Array.from(new Set(sel.final.map((f) => f.sec)));

    this.setData({
      sid: q.sid,
      finalCount: sel.final.length,
      finals,
      routeR: (sel.routes.R || []).join('、') || '—',
      routeP: (sel.routes.P || []).join('、') || '—',
      routeG: (sel.routes.G || []).join('、') || '—',
      coverText: covers.join(' / ')
    });
  },

  onGo() {
    wx.redirectTo({ url: '/pages/interviewList/interviewList?sid=' + this.data.sid });
  }
});
