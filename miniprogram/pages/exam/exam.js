// P2 答题（排序 + 过程埋点）
const store = require('../../utils/store.js');
const { ITEMS } = require('../../data/questions.js');
const { computeScores, selectThree } = require('../../utils/scoring.js');
const api = require('../../utils/api.js');

const LIMIT_MS = 20 * 60 * 1000; // 20 分钟

Page({
  data: {
    sid: '',
    total: ITEMS.length,
    idx: 0,
    q: {},
    order: ['A', 'B', 'C', 'D'],
    progress: 10,
    countdown: '20:00',
    timeLow: false,
    // 拖拽状态
    draggingIndex: -1,
    dragOverIndex: -1,
    isDragging: false,
    touchStartY: 0,
    itemHeight: 0
  },

  // 当前题的过程埋点（非渲染字段）
  _cur: null,
  _timer: null,

  onLoad(query) {
    const sid = query.sid;
    let session = store.getSession(sid);
    if (!session) {
      wx.showToast({ title: '会话不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    if (!session.examStartTs) {
      session.examStartTs = Date.now();
      store.saveSession(session);
    }
    this._session = session;

    // 恢复到第一道未作答题
    let start = 0;
    for (let i = 0; i < ITEMS.length; i++) {
      if (!session.answers[ITEMS[i].item_id]) { start = i; break; }
      start = i;
    }
    this.setData({ sid: sid });
    this.loadQuestion(start);
    this.startTimer();
  },

  onUnload() {
    this.stopTimer();
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
    const remain = LIMIT_MS - (Date.now() - this._session.examStartTs);
    if (remain <= 0) {
      this.setData({ countdown: '00:00', timeLow: true });
      this.stopTimer();
      this.doSubmit(true);
      return;
    }
    const s = Math.floor(remain / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    this.setData({ countdown: pad(mm) + ':' + pad(ss), timeLow: remain <= 60 * 1000 });
  },

  /* -------- 题目加载 / 埋点 -------- */
  loadQuestion(idx) {
    // 先保存上一题
    this.persistCurrent();

    const q = ITEMS[idx];
    const saved = this._session.answers[q.item_id];
    const order = saved && saved.final_ranking ? saved.final_ranking.slice() : ['A', 'B', 'C', 'D'];

    // 初始化本题埋点（若已答，沿用已有 move_log/首排，追加本次修改）
    this._cur = {
      itemId: q.item_id,
      enterTs: Date.now(),
      firstRanking: saved && saved.first_ranking ? saved.first_ranking.slice() : order.slice(),
      firstResponseOption: saved && saved.first_response_option ? saved.first_response_option : order[0],
      moveLog: saved && saved.move_log ? saved.move_log.slice() : [],
      reviseCount: saved ? saved.revise_count || 0 : 0,
      accMs: saved ? saved.duration_ms || 0 : 0
    };

    this.setData({
      idx: idx,
      q: q,
      order: order,
      progress: Math.round(((idx + 1) / ITEMS.length) * 100)
    });
  },

  /* -------- 真·拖动排序（长按拖动 + 震动）；提交成功时写 move_log -------- */
  // 触摸开始：记录初始 Y
  onTouchStart(e) {
    const t = e.touches[0];
    this.setData({ touchStartY: t.pageY });
  },

  // 长按：进入拖拽态，测量行高 + 震动
  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    const query = wx.createSelectorQuery();
    query.select('.opt').boundingClientRect();
    query.exec((res) => {
      const h = res && res[0] ? res[0].height : 80;
      this._dragStartIndex = index;
      this._dragBase = this.data.order.slice(); // 拖拽起点的完整排序
      this._dragLetter = this.data.order[index]; // 被拖动的选项
      this.setData({
        draggingIndex: index,
        dragOverIndex: index,
        isDragging: true,
        itemHeight: h
      });
      try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
    });
  },

  // 拖动中：按位移换算目标位次，实时预览排序
  onTouchMove(e) {
    if (!this.data.isDragging || this.data.draggingIndex === -1) return;
    const t = e.touches[0];
    const deltaY = t.pageY - this.data.touchStartY;
    const h = this.data.itemHeight || 80;
    const moveCount = Math.round(deltaY / h);
    const maxIndex = this._dragBase.length - 1;
    const target = Math.max(0, Math.min(this._dragStartIndex + moveCount, maxIndex));
    if (target !== this.data.dragOverIndex) {
      // 基于拖拽起点重排，避免累积漂移
      const preview = this._dragBase.slice();
      const li = preview.indexOf(this._dragLetter);
      if (li > -1) preview.splice(li, 1);
      preview.splice(target, 0, this._dragLetter);
      this.setData({ dragOverIndex: target, order: preview });
    }
  },

  // 拖动结束：提交 from→to，顺序有变则追加一条 move_log
  onTouchEnd() {
    if (!this.data.isDragging || this.data.draggingIndex === -1) return;
    const from = this._dragStartIndex;
    const to = this.data.dragOverIndex;
    this.setData({ draggingIndex: -1, dragOverIndex: -1, isDragging: false });

    if (to >= 0 && to !== from) {
      // order 已是预览后的最终排序；记录过程埋点（位次 1-based）
      this._cur.moveLog.push({ ts: Date.now(), option: this._dragLetter, from_pos: from + 1, to_pos: to + 1 });
      this._cur.reviseCount += 1;
      // 首次形成完整排序：若尚未记录过修改，firstRanking 保持初始（loadQuestion 已设）
      this.persistCurrent();
    } else {
      // 未变化：还原到拖拽起点排序
      this.setData({ order: this._dragBase.slice() });
    }
    this._dragBase = null;
    this._dragLetter = null;
  },

  persistCurrent() {
    if (!this._cur) return;
    const c = this._cur;
    const now = Date.now();
    const dur = c.accMs + (now - c.enterTs);
    this._session.answers[c.itemId] = {
      final_ranking: this.data.order.slice(),
      first_ranking: c.firstRanking,
      first_response_option: c.firstResponseOption,
      duration_ms: dur,
      revise_count: c.reviseCount,
      move_log: c.moveLog,
      focus_dwell: null,
      enter_ts: c.enterTs,
      submit_ts: now
    };
    store.saveSession(this._session);
  },

  onPrev() {
    if (this.data.idx === 0) return;
    this.loadQuestion(this.data.idx - 1);
  },

  onNext() {
    if (this.data.idx === this.data.total - 1) {
      this.doSubmit(false);
    } else {
      this.loadQuestion(this.data.idx + 1);
    }
  },

  /* -------- 提交：本地评分 + 筛选 + 保存 + 上报 -------- */
  doSubmit(isTimeout) {
    if (this._submitting) return;
    this._submitting = true;
    this.stopTimer();
    this.persistCurrent();

    const session = this._session;
    const itemIds = ITEMS.map((q) => q.item_id);
    const scores = computeScores(session.answers, itemIds);
    const selection = selectThree(scores, session.answers, itemIds);

    session.scores = scores;
    session.selection = selection;
    session.status = isTimeout ? 'timeout_submitted' : 'submitted';
    session.submittedAt = Date.now();
    session.examSubmitTs = session.submittedAt;
    session.totalExamMs = session.examSubmitTs - session.examStartTs; // 整卷总用时
    // 初始化访谈占位
    session.interview = session.interview || {};
    selection.final.forEach((f) => {
      if (!session.interview[f.id]) session.interview[f.id] = { status: 'pending' };
    });
    store.saveSession(session);

    // 异步上报（本地已成功；失败不阻塞）
    api.reportExam({
      sessionId: session.sessionId,
      profile: session.profileSnapshot,
      answers: session.answers,
      scores: scores,
      selection: selection,
      submitStatus: session.status,
      examStartTs: session.examStartTs,
      examSubmitTs: session.examSubmitTs,
      totalExamMs: session.totalExamMs
    });

    wx.redirectTo({ url: '/pages/submit/submit?sid=' + session.sessionId });
  }
});
