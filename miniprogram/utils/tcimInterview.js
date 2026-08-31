// tcimInterview.js —— 小程序侧 TCIM 确定性访谈包装。
// 复用 web 端同源、已打包为 CJS 的引擎（./tcim/engine.js），让小程序本机跑与 web 完全相同的
// 确定性访谈（证据/Orchestrator/PRDM/Generator）。语义层在 wx 下引擎自动降级为 bigram 证据。
//
// 用法（在 pages/interview 里）：
//   const t = require('../../utils/tcimInterview.js')
//   t.init(itemId, ranking, processTags, pretest)   // 每次进入情境初始化一次
//   t.first()                                       // 首问
//   t.next(teacherText)                             // 后续轮（传教师最新原话）
//   t.session()                                     // 取引擎会话（含 history/replay/evidence，供回看）
const tcim = require('./tcim/engine.js');
const tcimSemantic = require('./tcimSemantic.js');

let _engine = null;

function init(itemId, ranking, processTags, pretest) {
  const tags = (processTags || []).filter(Boolean);
  // 对齐 web（VITE_TCIM_V2=1 + VITE_TCIM_SEMANTIC_MODE=fallback_allowed）：
  // 启用 V0.2 双状态链 + 语义层(A01 LLM 经 gsyg_semanticProbe；失败降级 bigram)。
  tcim.setV2Enabled(true);
  tcim.setSemanticMode('fallback_allowed');
  tcim.setSemanticProvider(tcimSemantic.makeSemanticProvider());
  // 与 web 一致：前测完整资料进 TurnContext，只作 prior（不确定性/优先级），不填能力等级
  _engine = tcim.initTcisSession(itemId, ranking || [], tags, pretest || {});
  return _engine;
}

function reset() { _engine = null; }

function first() {
  if (!_engine) return { ok: true, question: '', done: false };
  const gen = tcim.firstQuestion(_engine);
  return {
    ok: true,
    question: gen.question || '',
    done: !!(gen.done),
    target_slot: gen.target_slot || ''
  };
}

async function next(teacherText) {
  if (!_engine) return { ok: true, question: '', done: false };
  const out = await tcim.processTeacherTurn(_engine, teacherText);
  return {
    ok: true,
    question: out.question || '',
    done: !!out.done,
    target_slot: (out.actionPlan && out.actionPlan.target_slot) || '',
    followup_reason: (out.actionPlan && out.actionPlan.probe_strategy) || ''
  };
}

function session() { return _engine; }

module.exports = { init, reset, first, next, session };
