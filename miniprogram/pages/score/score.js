// P4 评分结果 + 访谈情境挑选（合并页）
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');
const { SECONDARY_NAME } = require('../../data/indicatorMap.js');

Page({
  data: {
    sid: '',
    scores: {},
    rows: [],
    // 挑选情境
    hasSelection: false,
    examCount: ITEMS.length,
    finalCount: 3,
    finals: [],
    routeR: '—',
    routeP: '—',
    routeG: '—',
    coverText: ''
  },

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

    const patch = { sid: q.sid, scores: s.scores, rows };

    if (s.selection && s.selection.final && s.selection.final.length) {
      const sel = s.selection;
      const finals = sel.final.map((f) => ({
        id: f.id,
        title: titleOf[f.id] || '',
        secName: (f.sec || '?') + ' · ' + (SECONDARY_NAME[f.sec] || ''),
        sourceText: (f.sources || []).join(' / '),
        tagText: f.tags && f.tags.length ? ' · ' + f.tags.join('、') : ''
      }));
      const covers = Array.from(new Set(sel.final.map((f) => f.sec)));
      Object.assign(patch, {
        hasSelection: true,
        finalCount: finals.length,
        finals,
        routeR: (sel.routes.R || []).join('、') || '—',
        routeP: (sel.routes.P || []).join('、') || '—',
        routeG: (sel.routes.G || []).join('、') || '—',
        coverText: covers.join(' / ')
      });
    }

    this.setData(patch);
  },

  onGo() {
    wx.navigateTo({ url: '/pages/interviewList/interviewList?sid=' + this.data.sid });
  }
});
