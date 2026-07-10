// P8 访谈对话（规则版）
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');
const interview = require('../../utils/interview.js');

const LIMIT_MS = 10 * 60 * 1000; // 单情境 10 分钟

Page({
  data: {
    sid: '',
    itemId: '',
    isReview: false,
    q: {},
    rankRows: [],
    messages: [],
    input: '',
    sending: false,
    thinking: false,
    done: false,
    countdown: '10:00',
    timeLow: false,
    scrollTo: '',
    submittedText: '',
    allDone: false,
    // 自绘导航栏尺寸（px）
    statusBarHeight: 20,
    navContentH: 44,
    navBarH: 64,
    bodyTop: 109
  },

  initNavBar() {
    let info = {};
    try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
    const statusBarHeight = info.statusBarHeight || 20;
    let navContentH = 44;
    try {
      const m = wx.getMenuButtonBoundingClientRect();
      if (m && m.height) navContentH = (m.top - statusBarHeight) * 2 + m.height;
    } catch (e) {}
    const navBarH = statusBarHeight + navContentH;
    const sw = info.windowWidth || 375;
    const ivTopPx = Math.round((90 * sw) / 750); // iv-top 约 90rpx
    this.setData({ statusBarHeight, navContentH, navBarH, bodyTop: navBarH + ivTopPx });
  },

  onExit() {
    const isReview = this.data.isReview;
    wx.showModal({
      title: isReview ? '退出回看' : '退出访谈',
      content: isReview ? '确定退出回看？' : '确定退出本情境访谈？当前对话已保存，可稍后回到情境列表继续。',
      confirmText: '退出',
      success: (r) => {
        if (r.confirm) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
      }
    });
  },

  // 非渲染状态
  _queue: [],
  _qi: -1,
  _ledger: null,
  _startTs: 0,
  _timer: null,
  _noNew: false,
  _timeUpNotified: false,

  onLoad(query) {
    this.initNavBar();
    // 访谈会调用云端 AI 追问，必须先登录；未登录 → 弹窗 + 回上一页
    if (!store.requireLoginWithPrompt('AI 访谈前请先在「我的」填写姓名、园所、教龄')) {
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }
    const sid = query.sid;
    const itemId = query.item;
    const isReview = query.mode === 'review';
    const session = store.getSession(sid);
    const q = ITEMS.find((it) => it.item_id === itemId);
    if (!session || !q) {
      wx.showToast({ title: '访谈情境不存在', icon: 'none' });
      return;
    }
    this._session = session;

    const ans = session.answers[itemId] || {};
    const ranking = (ans.final_ranking || ['A', 'B', 'C', 'D']).slice();
    const rankRows = ranking.map((opt, i) => ({
      opt, pos: i + 1, text: q.options[opt]
    }));

    this.setData({ sid, itemId, isReview, q, rankRows });

    if (isReview) {
      this.renderReview(itemId);
    } else {
      this.startLive(itemId, ranking);
    }
  },

  onUnload() { this.stopTimer(); },

  /* -------- 回看 -------- */
  renderReview(itemId) {
    const iv = (this._session.interview || {})[itemId] || {};
    const messages = (iv.turns || []).map((t) => ({ role: t.role, text: t.text }));
    const submittedText = iv.submittedAt ? this.fmtTime(iv.submittedAt) : '';
    this.setData({ messages, submittedText });
    this.scrollBottom();
  },

  /* -------- 实时访谈 -------- */
  startLive(itemId, ranking) {
    const built = interview.buildScriptQueue(itemId, ranking);
    this._queue = built.queue; // 规则版脚本序列（LLM 不可用时的兜底）
    this._qi = -1;
    this._ledger = {};
    this._pendingE = []; // 教师回答当前问题时应计入的证据点
    this._ranking = ranking.slice();
    this._mode = null; // 'llm' | 'rule'，首轮探测决定
    try {
      const proc = require('../../utils/process.js').computeProcess((this._session.answers || {})[itemId]);
      this._procTags = proc.tags || [];
    } catch (e) { this._procTags = []; }
    this._startTs = Date.now();
    this.startTimer();
    this.askNext();
  },

  // 优先 LLM 动态追问，失败/超时/未配置回退规则版脚本序列
  async askNext() {
    if (this.data.done) return;
    const remain = LIMIT_MS - (Date.now() - this._startTs);
    if (remain <= 60 * 1000 || this._noNew) { this.finalize(); return; }

    if (this._mode !== 'rule') {
      this.setData({ thinking: true });
      const ctx = {
        sessionId: this.data.sid,
        itemId: this.data.itemId,
        itemContext: { stem: this.data.q.stem, options: this.data.q.options, title: this.data.q.title },
        teacherRanking: this._ranking,
        processTags: this._procTags,
        kbSlice: interview.kbSlice(this.data.itemId),
        history: this.data.messages.map((m) => ({ role: m.role, text: m.text })),
        remainingMs: remain
      };
      let r = null;
      try { r = await interview.llmNextQuestion(ctx); } catch (e) { r = null; }
      this.setData({ thinking: false });
      if (r) {
        this._mode = 'llm';
        this._pendingE = r.evidenceHint || [];
        if (r.done) { if (r.question) this.pushMsg('ai', r.question); this.finalize(true); return; }
        this.pushMsg('ai', r.question);
        return;
      }
      this._mode = 'rule'; // 降级
    }

    // 规则版脚本队列
    this._qi += 1;
    if (this._qi >= this._queue.length) { this.finalize(); return; }
    const item = this._queue[this._qi];
    this._pendingE = item.E || [];
    this.pushMsg('ai', item.q);
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  async onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.sending || this.data.done) return;
    this.setData({ sending: true });

    // 记录教师回答
    this.pushMsg('me', text);
    // 证据账本：计入当前问题对应的证据点（LLM 的 evidenceHint 或规则脚本的 E）
    (this._pendingE || []).forEach((e) => (this._ledger[e] = true));
    this._pendingE = [];
    this.setData({ input: '' });
    this.persist(false);

    const remain = LIMIT_MS - (Date.now() - this._startTs);
    const timeUp = remain <= 0;
    // 剩余 <1 分钟：不再生成新问，直接收束保存
    if (remain <= 60 * 1000 || this._noNew) {
      this.finalize();
      // 时间已到且教师完成了这一次回答 → 提示返回
      if (timeUp) {
        wx.showModal({
          title: '本情境访谈已结束',
          content: '感谢作答，本情境时间已到，请返回情境列表。',
          showCancel: false,
          confirmText: '返回列表',
          success: () => this.onBack()
        });
      }
    } else {
      await this.askNext();
    }
    this.setData({ sending: false });
  },

  finalize(skipStop) {
    if (this.data.done) return;
    if (!skipStop) {
      const stop = interview.stopScript(this.data.itemId);
      this.pushMsg('ai', stop.q);
    }
    const coding = interview.codeLevel(this.data.itemId, Object.keys(this._ledger || {}));
    this.setData({ done: true });
    this.persist(true, coding);

    // 异步上报（本地已存；失败不阻塞）
    const s = store.getSession(this.data.sid);
    const api = require('../../utils/api.js');
    api.reportInterview({
      sessionId: this.data.sid,
      itemId: this.data.itemId,
      interviews: s ? s.interview : null
    });

    // 是否全部完成
    const all = s && s.selection && s.selection.final.every((f) => (s.interview[f.id] || {}).status === 'done');
    this.setData({ allDone: !!all });
    // 注:finalize 不再 stopTimer——按用户要求,时间 > 0 时倒计时继续走
    // 到用户主动离开(onUnload)或时间到 0 时才停在 00:00 红色不再跳数。
  },

  /* -------- 持久化 -------- */
  persist(isDone, coding) {
    const turns = this.data.messages.map((m) => ({ role: m.role, text: m.text }));
    const prev = (this._session.interview || {})[this.data.itemId] || {};
    const obj = {
      status: isDone ? 'done' : 'in_progress',
      startedAt: prev.startedAt || this._startTs,
      submittedAt: isDone ? Date.now() : (prev.submittedAt || null),
      turns: turns,
      ledger: Object.keys(this._ledger || {}),
      coding: coding || prev.coding || null
    };
    store.saveInterview(this.data.sid, this.data.itemId, obj);
    this._session = store.getSession(this.data.sid);
  },

  /* -------- 计时 -------- */
  startTimer() {
    this.tick();
    this._timer = setInterval(() => this.tick(), 1000);
  },
  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },
  tick() {
    const remain = LIMIT_MS - (Date.now() - this._startTs);
    if (remain <= 0) {
      // 时间到:显示红色 00:00 保持不动,停止后续 tick(避免每秒 setData);
      // 用户可继续答完并提交(finalize),或直接离开。
      this.setData({ countdown: '00:00', timeLow: true });
      this._noNew = true;
      if (!this._timeUpNotified) {
        this._timeUpNotified = true;
        wx.showToast({ title: '本情境访谈时间已到,可继续完成当前回答', icon: 'none', duration: 2500 });
      }
      this.stopTimer();
      return;
    }
    if (remain <= 60 * 1000) this._noNew = true;
    const sec = Math.floor(remain / 1000);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    this.setData({ countdown: pad(mm) + ':' + pad(ss), timeLow: remain <= 60 * 1000 });
  },

  /* -------- UI 辅助 -------- */
  pushMsg(role, text) {
    const messages = this.data.messages.concat([{ role, text }]);
    this.setData({ messages });
    this.scrollBottom();
  },
  scrollBottom() {
    this.setData({ scrollTo: '' });
    wx.nextTick(() => this.setData({ scrollTo: 'bottom' }));
  },
  fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  onBack() {
    if (this.data.allDone) {
      wx.redirectTo({ url: '/pages/done/done?sid=' + this.data.sid });
    } else {
      wx.navigateBack();
    }
  }
});
