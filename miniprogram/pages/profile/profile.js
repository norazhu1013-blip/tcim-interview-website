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
    openid: '',
    isAdmin: false,
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
      wx.setNavigationBarTitle({ title: this.data.isFirst ? '完善信息' : '我的' });
    } else {
      this.setData({ isFirst: true });
      wx.setNavigationBarTitle({ title: this.data.isFirst ? '完善信息' : '我的' });
    }
    // 拉云端身份（openid + isAdmin），失败静默
    api.whoami().then((who) => {
      if (who) this.setData({ openid: who.openid || '', isAdmin: !!who.isAdmin });
    });
  },

  onCopyOpenid() {
    if (!this.data.openid) return;
    wx.setClipboardData({ data: this.data.openid, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
  },

  onExport() {
    if (!this.data.isAdmin) return;
    if (this._exporting) return;
    this._exporting = true;
    wx.showLoading({ title: '导出中…', mask: true });
    api.exportData({}).then((r) => {
      wx.hideLoading();
      this._exporting = false;
      if (!r || !r.ok) {
        wx.showModal({
          title: '导出失败',
          content: (r && r.error) || '云端返回空，请检查 gsyg_exportData 是否已部署及 isAdmin 是否已设置。',
          showCancel: false
        });
        return;
      }
      const url = r.downloadURL || '';
      if (!url) {
        wx.showModal({ title: '导出成功但无下载链接', content: '文件已生成：' + r.cloudPath, showCancel: false });
        return;
      }
      wx.setClipboardData({
        data: url,
        success: () => {
          const kb = Math.round((r.bytes || 0) / 1024);
          wx.showModal({
            title: '导出成功',
            content: '下载链接已复制到剪贴板\n\n共 ' + kb + ' KB\nteachers=' + (r.count.teachers || 0) + ' / sessions=' + (r.count.sessions || 0) + ' / interviews=' + (r.count.interviews || 0) + '\n\n粘贴到浏览器打开即可下载（有效期约 2 小时）',
            showCancel: false
          });
        }
      });
    });
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    const patch = { ['form.' + k]: e.detail.value };
    this.setData(patch);
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
      wx.setNavigationBarTitle({ title: this.data.isFirst ? '完善信息' : '我的' });
      wx.showToast({ title: '已保存', icon: 'success' });
    }
  },

});
