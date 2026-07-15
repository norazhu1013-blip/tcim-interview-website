// P9.5 访谈反馈 —— 三题全部访谈完成后、最终「完成」前收集 3 个反馈问题
// 收集后存 session.interviewFeedback 并随 reportInterview 上报,再进 done 页。
const store = require('../../utils/store.js');
const api = require('../../utils/api.js');

const QUESTIONS = [
  '您对此次 AI 访谈的整体感受如何？',
  '在本次 AI 访谈过程中，哪些问题或交流内容给您留下了较深印象？',
  '您觉得哪些地方还可以进一步改进？'
];

Page({
  data: {
    sid: '',
    questions: QUESTIONS,
    answers: ['', '', ''],
    submitting: false
  },

  onLoad(q) {
    this.setData({ sid: q.sid || '' });
    // 已提交过则回填(允许修改后再次提交)
    const s = store.getSession(q.sid);
    const fb = s && s.interviewFeedback;
    if (fb) this.setData({ answers: [fb.q1 || '', fb.q2 || '', fb.q3 || ''] });
  },

  onInput(e) {
    const i = Number(e.currentTarget.dataset.i);
    const answers = this.data.answers.slice();
    answers[i] = e.detail.value;
    this.setData({ answers });
  },

  onSubmit() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    const a = this.data.answers;
    const fb = {
      q1: (a[0] || '').trim(),
      q2: (a[1] || '').trim(),
      q3: (a[2] || '').trim(),
      submittedAt: Date.now()
    };
    store.saveInterviewFeedback(this.data.sid, fb);
    // 随访谈记录一并上报(本地已存,失败不阻塞)
    const s = store.getSession(this.data.sid);
    api.reportInterview({ sessionId: this.data.sid, interviews: s ? s.interview : null, feedback: fb });
    this.setData({ submitting: false });
    wx.redirectTo({ url: '/pages/done/done?sid=' + this.data.sid });
  }
});
