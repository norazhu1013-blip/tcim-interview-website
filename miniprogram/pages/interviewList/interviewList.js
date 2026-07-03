// P7 访谈情境列表（记录子页）
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');
const { MAP } = require('../../data/indicatorMap.js');

const CIRCLE = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

Page({
  data: { sid: '', list: [], allDone: false },

  onShow() {
    if (this.data.sid) this.refresh(this.data.sid);
  },
  onLoad(q) {
    this.setData({ sid: q.sid });
    this.refresh(q.sid);
  },

  refresh(sid) {
    const s = store.getSession(sid);
    if (!s || !s.selection) {
      wx.showToast({ title: '暂无访谈情境', icon: 'none' });
      return;
    }
    const titleOf = {};
    ITEMS.forEach((it) => (titleOf[it.item_id] = it.title));
    const interview = s.interview || {};
    const list = s.selection.final.map((f) => {
      const num = parseInt(String(f.id).replace(/\D/g, ''), 10);
      const iv = interview[f.id] || {};
      return {
        id: f.id,
        no: (CIRCLE[num - 1] || ('#' + num)) + ' ',
        title: titleOf[f.id] || '',
        focus: (MAP[f.id] && MAP[f.id].interview_focus) || '',
        done: iv.status === 'done'
      };
    });
    const allDone = list.length > 0 && list.every((x) => x.done);
    this.setData({ list, allDone });
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    const done = e.currentTarget.dataset.done;
    wx.navigateTo({
      url: '/pages/interview/interview?sid=' + this.data.sid + '&item=' + id + (done ? '&mode=review' : '')
    });
  },

  onHome() {
    wx.switchTab({ url: '/pages/home/home' });
  }
});
