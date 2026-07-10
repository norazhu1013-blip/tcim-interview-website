/**
 * AI 访谈服务（规则版）。
 *
 * 硬约束（CLAUDE.md 第 7 节）：
 *  - 先呈现完整案例 + 四选项 + 该教师的排序（页面负责渲染）。
 *  - 只围绕教师真实排序追问，不暴露专家排序/得分/标准答案，不诱导预设答案。
 *  - 每轮只问一个问题；单情境限时 10 分钟；剩余 <1 分钟不再生成新问但保存记录。
 *
 * 规则版运作：教师排序 → 命中最高优先级触发规则(T) → 取其追问脚本序列(Q) → 逐轮提问；
 *            教师回答时把该脚本的证据点(E)记入证据账本；序列走完追加 Q-stop 收束；
 *            依据评分锚点(10表)编码本题水平。
 *
 * 真实 LLM 接入见文件末 llmNextQuestion（TODO：经自有已备案后端调用，不在小程序直连 LLM）。
 */
const { KB, E_NAME } = require('../data/knowledge.js');
const { MAP } = require('../data/indicatorMap.js');
const { CLOUD_FUNCTIONS } = require('./config.js');

/**
 * 通用触发匹配：依 08 表的「结果性触发条件」文本(result_cond) 判断教师排序是否命中。
 * 解析首/末位、靠前(位次≤2)、靠后(位次≥3)、X/Y 前两位 等表述，多原子取「或」（宽松命中）。
 * 排序不暴露给教师；此处仅后台用于选择追问脚本。
 * @param {string[]} ranking 教师排序，如 ['C','A','B','D']
 * @param {string} cond result_cond 文本
 */
function triggerMatches(ranking, cond) {
  if (!ranking || !ranking.length || !cond) return false;
  const top = ranking[0];
  const bottom = ranking[ranking.length - 1];
  const idx = (L) => ranking.indexOf(L);
  const atoms = [];

  ['A', 'B', 'C', 'D'].forEach((L) => {
    if (new RegExp(L + '(?:排)?首位|' + L + '首(?![位A-Za-z])').test(cond)) atoms.push(top === L);
    if (new RegExp(L + '(?:排)?末位|' + L + '末(?![位A-Za-z])').test(cond)) atoms.push(bottom === L);
    if (new RegExp(L + '(?:明显)?靠前|' + L + '前置|' + L + '不在末位').test(cond)) atoms.push(idx(L) >= 0 && idx(L) <= 1);
    if (new RegExp(L + '(?:明显)?靠后|' + L + '后置|' + L + '被压低|' + L + '明显排在').test(cond)) atoms.push(idx(L) >= 2);
  });
  // X/Y 前两位
  let m;
  const re = /([A-D])\/([A-D])前两位/g;
  while ((m = re.exec(cond))) atoms.push(idx(m[1]) >= 0 && idx(m[1]) <= 1 && idx(m[2]) >= 0 && idx(m[2]) <= 1);

  return atoms.some(Boolean);
}

/** 命中触发规则：返回优先级最高的匹配项；无匹配则回退到该题第一个触发规则。 */
function fireTrigger(itemId, ranking) {
  const kb = KB[itemId];
  if (!kb || !kb.triggers || !kb.triggers.length) return null;
  const fired = kb.triggers
    .filter((t) => {
      try {
        // 优先用数据内置的 test(ranking)（build_knowledge.js 从 04 paths 派生）；
        // 无 test 时回退到 result_cond 文本通用匹配。
        return typeof t.test === 'function' ? !!t.test(ranking) : triggerMatches(ranking, t.result_cond);
      } catch (e) { return false; }
    })
    .sort((a, b) => b.prio - a.prio);
  return fired[0] || kb.triggers[0];
}

/**
 * 构建追问脚本队列（AI 每一步要问的问题）。
 * @returns {{ trigger, queue:[{code,q,E}] }}
 */
function buildScriptQueue(itemId, ranking) {
  const kb = KB[itemId];
  if (!kb) return { trigger: null, queue: [] };
  const trigger = fireTrigger(itemId, ranking);
  const codes = (trigger && trigger.scripts) || ['Q1'];
  const queue = [];
  codes.forEach((code) => {
    const sc = kb.scripts[code];
    if (sc) queue.push({ code: code, q: sc.q, E: sc.E || [] });
  });
  return { trigger: trigger, queue: queue };
}

/** 收束语（Q-stop） */
function stopScript(itemId) {
  const kb = KB[itemId];
  const sc = kb && kb.scripts['Q-stop'];
  return sc ? { code: 'Q-stop', q: sc.q, E: [] } : { code: 'Q-stop', q: '好的，我们进入下一个情境。', E: [] };
}

/**
 * 依据证据账本 + 评分锚点(10表)编码本题水平。
 * 取“已具备证据点覆盖 required 最完整”的最高锚点。
 * @param {string[]} ledger 已采集证据点，如 ['E2','E3','E5']
 */
function codeLevel(itemId, ledger) {
  const kb = KB[itemId];
  if (!kb || !kb.anchors) return { level: '证据不足', coding: '证据不足', got: ledger };
  const have = new Set(ledger || []);
  // anchors 已按高→低排列；返回第一个 required 全部满足的锚点
  for (const a of kb.anchors) {
    const req = a.required || [];
    const ok = req.every((e) => have.has(e));
    if (ok) {
      return {
        level: a.level,
        coding: a.coding || a.level,
        got: Array.from(have),
        weak: a.weak || []
      };
    }
  }
  return { level: '证据不足', coding: '证据不足', got: Array.from(have) };
}

/** 证据点名称展示 */
function evidenceName(code) {
  return E_NAME[code] || code;
}

/**
 * 构建传给云函数的知识库切片（避免云端复制整份数据）：核心指向 / 观测点 / 触发 / 脚本 / 证据点。
 */
function kbSlice(itemId) {
  const kb = KB[itemId] || {};
  const m = MAP[itemId] || {};
  const obs = []
    .concat((m.primary && m.primary.observation_points) || [])
    .concat((m.secondary_ind && m.secondary_ind.observation_points) || []);
  return {
    core_orientation: kb.core_orientation || (m.interview_focus || ''),
    observation_points: obs,
    triggers: (kb.triggers || []).map((t) => ({ code: t.code, result_cond: t.result_cond, target: t.target })),
    scripts: Object.keys(kb.scripts || {}).map((c) => ({ code: c, q: kb.scripts[c].q, E: kb.scripts[c].E })),
    evidence: (kb.evidence_points || []).map((e) => ({ code: e.code, name: e.name }))
  };
}

/**
 * 真实 LLM 动态追问：调用云函数 gsyg_interviewChat。
 * 遵守红线由云函数 system prompt 保证；此处只做调用与降级。
 * @returns {Promise<{question,done,evidenceHint}|null>} 失败/超时/未配置/云不可用 → null（调用方回退规则版）
 */
function llmNextQuestion(ctx) {
  return new Promise((resolve) => {
    if (!wx.cloud || !ctx) return resolve(null);
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    // 兜底超时：云函数自身 30s（LLM_TIMEOUT_MS 默认），客户端 35s 保护（多 5s 缓冲留给 wxai/网络）
    const timer = setTimeout(() => done(null), 35000);
    try {
      wx.cloud.callFunction({
        name: CLOUD_FUNCTIONS.interviewChat,
        data: ctx,
        success: (res) => {
          clearTimeout(timer);
          const r = res && res.result;
          if (r && r.ok && (r.question || r.done)) {
            done({ question: r.question || '', done: !!r.done, evidenceHint: r.evidenceHint || [], stage: r.stage || '', nextStage: r.nextStage || '' });
          } else {
            done(null); // ok:false（未配置/失败）→ 回退规则版
          }
        },
        fail: () => { clearTimeout(timer); done(null); }
      });
    } catch (e) {
      clearTimeout(timer);
      done(null);
    }
  });
}

module.exports = {
  triggerMatches,
  fireTrigger,
  buildScriptQueue,
  kbSlice,
  stopScript,
  codeLevel,
  evidenceName,
  llmNextQuestion,
  E_NAME
};
