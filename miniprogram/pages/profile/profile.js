// P0b/P1b 「我的」个人信息 —— 双重身份：
//  ① 首次登录无 profile → 引导填写，保存后 switchTab 进「答题」
//  ② 作为「我的」Tab 常驻，可随时查看/修改，保存后调 gsyg_reportTeacher 更新
const { saveProfile, getProfile } = require('../../utils/store.js');
const api = require('../../utils/api.js');

Page({
  data: {
    grades: ['小班', '中班', '大班', '混龄班'],
    teachAges: ['1 年以下', '1–3 年', '3–5 年', '5–10 年', '10 年以上'],
    gradeIdx: 1,
    teachAgeIdx: 2,
    isFirst: true,
    form: { name: '', kindergarten: '', grade: '中班', teachAge: '3–5 年', paperCode: '' }
  },

  onShow() {
    // 每次进入 Tab 都同步最新（不在编辑途中，故不会覆盖输入）
    const existing = getProfile();
    if (existing && existing.name) {
      const gi = Math.max(0, this.data.grades.indexOf(existing.grade));
      const ti = Math.max(0, this.data.teachAges.indexOf(existing.teachAge));
      this.setData({
        form: Object.assign({}, this.data.form, existing),
        gradeIdx: gi,
        teachAgeIdx: ti,
        isFirst: false
      });
      wx.setNavigationBarTitle({ title: '我的' });
    } else {
      this.setData({ isFirst: true });
      wx.setNavigationBarTitle({ title: '完善信息' });
    }
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['form.' + k]: e.detail.value });
  },
  onGrade(e) {
    const i = Number(e.detail.value);
    this.setData({ gradeIdx: i, 'form.grade': this.data.grades[i] });
  },
  onTeachAge(e) {
    const i = Number(e.detail.value);
    this.setData({ teachAgeIdx: i, 'form.teachAge': this.data.teachAges[i] });
  },

  onSave() {
    const f = this.data.form;
    if (!f.name || !f.name.trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    const wasFirst = this.data.isFirst;
    // 本地优先：先写本地
    const profile = {
      name: f.name.trim(),
      kindergarten: (f.kindergarten || '').trim(),
      grade: f.grade,
      teachAge: f.teachAge,
      paperCode: (f.paperCode || '').trim(),
      wxCode: (function () { try { return wx.getStorageSync('wx_login_code') || ''; } catch (e) { return ''; } })()
    };
    saveProfile(profile);
    const app = getApp();
    if (app && app.globalData) app.globalData.profile = profile;

    // 异步上报（gsyg_reportTeacher），不阻塞
    api.reportProfile(profile);

    if (wasFirst) {
      // 首次：进入「答题」Tab
      wx.switchTab({ url: '/pages/home/home' });
    } else {
      // 编辑：留在本页，刷新头部
      this.setData({ isFirst: false });
      wx.setNavigationBarTitle({ title: '我的' });
      wx.showToast({ title: '已保存', icon: 'success' });
    }
  },

  onAbout() {
    wx.showModal({
      title: '关于测评',
      content: '幼儿园教师「游戏支持与引导能力」测评：10 题情境判断 + AI 一对一访谈，自动评分、非评判、结果可回溯。',
      showCancel: false
    });
  },
  onPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: '仅采集必要的教师信息与作答/访谈数据用于测评与报告；录音仅用于本次访谈转写。详见完整隐私政策。',
      showCancel: false
    });
  }
});
