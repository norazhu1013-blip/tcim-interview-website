// P1 首页（含记录）
const { getProfile, listSessions, deleteSession, createSession, requireLoginWithPrompt } = require('../../utils/store.js');
const { uuid } = require('../../utils/uuid.js');
const { ITEMS } = require('../../data/questions.js');

const TOTAL_INTERVIEW = 3;

Page({
  data: {
    profile: {},
    records: [],
    examCount: ITEMS.length
  },

  onShow() {
    // 首页允许未登录浏览；开始答题 / 继续 / 提交 等动作会按需触发登录
    this.refresh();
  },

  refresh() {
    const profile = getProfile() || {};
    const sessions = listSessions();
    const records = sessions.map((s) => this.toRecord(s));
    // 答题/访谈互斥：存在「已提交但访谈未全部完成」的记录时，禁止开始新测评
    const blockStart = records.some((r) => r.status !== 'in_progress' && !r.interviewDone);
    this.setData({ profile, records, blockStart });
  },

  onGoProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  toRecord(s) {
    const interview = s.interview || {};
    const doneCount = Object.keys(interview).filter((k) => interview[k] && interview[k].status === 'done').length;
    const planned = (s.selection && s.selection.final && s.selection.final.length) || TOTAL_INTERVIEW;
    let pillText = '';
    let pillOn = false;
    let summary = '';
    let interviewDone = false;

    if (s.status === 'in_progress') {
      const answered = Object.keys(s.answers || {}).length;
      pillText = '未完成';
      summary = '答到第 ' + Math.max(1, answered) + ' 题 · 未提交';
    } else {
      pillText = '访谈 ' + doneCount + '/' + planned;
      pillOn = doneCount > 0 && doneCount < planned;
      interviewDone = doneCount >= planned;
      const sc = s.scores || {};
      summary = (this.data.examCount || ITEMS.length) + ' 题 · 总分 ' + (sc.total != null ? sc.total : '-') + ' · ' + (sc.level || '');
    }
    return {
      sessionId: s.sessionId,
      dateText: s.dateText,
      status: s.status,
      pillText,
      pillOn,
      summary,
      interviewDone
    };
  },

  onStart() {
    if (this.data.blockStart) {
      wx.showToast({ title: '请先完成未结束的 AI 访谈', icon: 'none' });
      return;
    }
    if (!requireLoginWithPrompt('开始答题需要先完成微信手机号授权登录')) return;
    const id = uuid();
    createSession(id, { paperCode: (getProfile() || {}).paperCode || '' });
    wx.navigateTo({ url: '/pages/exam/exam?sid=' + id });
  },

  onContinue(e) {
    if (!requireLoginWithPrompt('继续答题需要先完成微信手机号授权登录')) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/exam/exam?sid=' + id });
  },

  onReview(e) {
    wx.navigateTo({ url: '/pages/review/review?sid=' + e.currentTarget.dataset.id });
  },
  onScore(e) {
    wx.navigateTo({ url: '/pages/score/score?sid=' + e.currentTarget.dataset.id });
  },
  onInterview(e) {
    wx.navigateTo({ url: '/pages/interviewList/interviewList?sid=' + e.currentTarget.dataset.id });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条未完成的答题记录？',
      success: (r) => {
        if (r.confirm) {
          deleteSession(id);
          this.refresh();
        }
      }
    });
  }
});
