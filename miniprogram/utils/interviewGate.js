/**
 * 访谈入口守卫 —— 用户点「去 AI 访谈」时统一走这里:
 *   1) session 已有 advisor_v1 遴选结果 → 直接进
 *   2) 缺失 → 阻塞式调 gsyg_selectFinal;成功落地后进;失败弹窗「重试 / 取消」
 *
 * 前置:answer 已经通过 reportExam 上报到 gsyg_sessions;若上报有 pending,则先 flush。
 * 消费方:submit.onSelect / home.onInterview / interviewList.onLoad(兜底)。
 */
'use strict';
const store = require('./store.js');
const api = require('./api.js');

const LOADING_TITLE = '正在为您挑选访谈情境…';

/**
 * @param {string} sessionId
 * @param {(sessionAfter:object)=>void} onOk 成功回调(此时 session.selection 已落地)
 * @param {object} [opts] { onCancel?, loadingTitle? }
 */
function ensureFinalThen(sessionId, onOk, opts) {
  opts = opts || {};
  const session = store.getSession(sessionId);
  if (!session) {
    wx.showToast({ title: '会话不存在', icon: 'none' });
    return;
  }
  if (store.hasFinalSelection(session)) { onOk(session); return; }

  wx.showLoading({ title: opts.loadingTitle || LOADING_TITLE, mask: true });
  // 先把 pending 上报 flush 掉,尽量确保云端已有本 session
  api.flushPending().catch(() => {}).then(() => api.selectFinal(sessionId))
    .then((r) => {
      wx.hideLoading();
      if (r && r.ok && r.selection && r.selection.final && r.selection.final.length) {
        const s = store.saveSelection(sessionId, r.selection);
        onOk(s);
        return;
      }
      const err = (r && (r.error || r.message)) || 'unknown';
      showRetry(sessionId, err, onOk, opts);
    })
    .catch((e) => {
      wx.hideLoading();
      showRetry(sessionId, (e && e.message) || 'network', onOk, opts);
    });
}

function showRetry(sessionId, err, onOk, opts) {
  const map = {
    session_not_found: '答卷记录云端暂未同步,请稍等片刻后重试。',
    forbidden: '当前登录身份与答卷记录不匹配。',
    incomplete_answers: '答卷有题目未完成,无法生成访谈情境。',
    algo_failed: '遴选服务临时异常,请重试。',
    algo_incomplete: '遴选服务返回结果异常,请重试。',
    db_read_failed: '云端读取答卷失败,请重试。'
  };
  const content = map[err] || ('遴选暂不可用(' + err + '),请稍后重试。');
  wx.showModal({
    title: '暂时无法开始访谈',
    content,
    confirmText: '重试',
    cancelText: '取消',
    success: (r) => {
      if (r.confirm) ensureFinalThen(sessionId, onOk, opts);
      else if (opts.onCancel) opts.onCancel();
    }
  });
}

module.exports = { ensureFinalThen };
