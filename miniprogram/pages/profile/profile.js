// P0b/P1b 「我的」个人信息 —— 双重身份：
//  ① 首次登录无 profile → 引导填写，保存后 switchTab 进「答题」
//  ② 作为「我的」Tab 常驻，可随时查看/修改，保存后调 gsyg_reportTeacher 更新
const { saveProfile, getProfile } = require('../../utils/store.js');
const api = require('../../utils/api.js');

Page({
  data: {
    teachAges: ['1 年以下', '1–3 年', '3–5 年', '5–10 年', '10 年以上'],
    teachAgeIdx: 2,
    isFirst: true,
    isAdmin: false,
    // grade / paperCode / openid 已按 2026-07-09 建议移除。姓名/园所/教龄 三项即可完成信息填写。
    form: { name: '', kindergarten: '', teachAge: '3–5 年' }
  },

  onShow() {
    // 「我的」允许未登录浏览。保存时校验必填即可,不再走手机号授权。
    const existing = getProfile();
    if (existing && existing.name) {
      const ti = Math.max(0, this.data.teachAges.indexOf(existing.teachAge));
      this.setData({
        form: Object.assign({}, this.data.form, {
          name: existing.name || '',
          kindergarten: existing.kindergarten || '',
          teachAge: existing.teachAge || this.data.form.teachAge
        }),
        teachAgeIdx: ti,
        isFirst: false
      });
      wx.setNavigationBarTitle({ title: '我的' });
    } else {
      this.setData({ isFirst: true });
      wx.setNavigationBarTitle({ title: '完善信息' });
    }
    // 管理员标记仍需拉云端(用于显示导出入口)
    api.whoami().then((who) => {
      if (who) this.setData({ isAdmin: !!who.isAdmin });
    });
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
  onTeachAge(e) {
    const i = Number(e.detail.value);
    this.setData({ teachAgeIdx: i, 'form.teachAge': this.data.teachAges[i] });
  },

  onSave() {
    const f = this.data.form;
    if (!f.name || !f.name.trim()) { wx.showToast({ title: '请填写姓名', icon: 'none' }); return; }
    if (!f.kindergarten || !f.kindergarten.trim()) { wx.showToast({ title: '请填写园所', icon: 'none' }); return; }
    if (!f.teachAge) { wx.showToast({ title: '请选择教龄', icon: 'none' }); return; }

    const wasFirst = this.data.isFirst;
    const profile = {
      name: f.name.trim(),
      kindergarten: f.kindergarten.trim(),
      teachAge: f.teachAge,
      wxCode: (function () { try { return wx.getStorageSync('wx_login_code') || ''; } catch (e) { return ''; } })()
    };
    saveProfile(profile);
    const app = getApp();
    if (app && app.globalData) app.globalData.profile = profile;

    // 上报教师信息(gsyg_reportTeacher),不阻塞
    api.reportProfile(profile);

    if (wasFirst) {
      wx.switchTab({ url: '/pages/home/home' });
    } else {
      this.setData({ isFirst: false });
      wx.setNavigationBarTitle({ title: '我的' });
      wx.showToast({ title: '已保存', icon: 'success' });
    }
  },

});
