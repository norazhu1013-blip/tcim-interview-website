'use strict';

/**
 * evidence_semantic —— A01 语义预筛模块（AI 作用重新定义版 / 责任表 V0.1 的 A01 调用点）。
 *
 * 职责（严格限定）：对教师这一轮的原话做「语义理解与证据抽取」的 Proposal 产出，
 * 即 What the teacher meant。它**只**贡献候选信号（candidate_spans / candidate_slots /
 * conflict_candidates / no_change_reasons），供 Ontology 的确定性 EvidenceUpdater
 * 在裁决时参考 —— **绝不**直接设定 level / confidence，**绝不**写 evidence_state。
 *
 * 这是 Step 1 的边界：LLM 做「语义预筛」，确定性引擎仍持有「裁决权」（A02）。
 * 这样既把 A01「AI 核心智能参与专业判断」落实到代码，又不破坏既有的三条确定性基线
 * （720 轮升级=6 / 低能力教师绝不误升 / 冲突检出=0），也不触碰「计分与筛题是确定性程序、
 * AI 不参与打分」的红线。
 *
 * 设计要点：
 *  - `analyze()` 是**纯函数**：输入教师原话 + 相关槽/锚点/当前证据摘要，输出
 *    `EvidenceAnalysisProposal`（责任表 A01 的结构化输出），不读写任何模块状态。
 *  - 提供者（provider）是可插拔的：默认 `offlineProvider` 返回空 Proposal（无任何增益），
 *    因此缺省行为与「不加这个模块」完全一致、字节级不变。真实 LLM 语义层接入时，
 *    实现一个 `semanticProvider(teacherTurn, ctx)` 注入即可，无需改动本模块之外的结构。
 *  - 硬性约束（G04/G05）：`analyze()` 只认教师**原话里真实出现的** span；任何 proposal
 *    的档位判断都必须能回指 `span`，否则视为 `no_change_reason`，不得猜测能力/人格/动机。
 */

// A01 结构化的输出字段天然是「Proposal」：不含 level/confidence 的最终裁决。
// 所有档位信息都表达为「关于 span 的观察」，最终由 Ontology EvidenceUpdater 裁决。

const EMPTY_PROPOSAL = Object.freeze({
  proposal_type: 'EvidenceAnalysisProposal',
  candidate_spans: [],        // [{ text, candidate_slots[] }] —— 多 Slot 取词
  slot_evidence_proposals: [], // [{ slot_id, proposed_level, confidence, supporting_spans[] }]
  conflict_candidates: [],    // [{ slot_id, reason }] 疑似与当前已有证据冲突
  false_evidence_flags: [],   // [{ slot_id, reason }] 疑似「伪证据/空话/泛泛而谈」的信号
  uncertainty: [],            // [string] 若干条尚不清楚、需澄清的判断
  no_change_reasons: [],      // 解释「为何不升级」的原因（供审计/回放）
  source_turn: null,
  provider_version: 'offline-v0.2'
});

/**
 * 默认离线提供者：什么都不提供。
 * 返回空 Proposal，因此默认路径与「未接入语义模块」等价。
 * @returns {EvidenceAnalysisProposal}
 */
function offlineProvider() {
  return { ...EMPTY_PROPOSAL, candidate_spans: [], slot_evidence_proposals: [], conflict_candidates: [], false_evidence_flags: [], no_change_reasons: [] };
}

/** 供外部注册的真实提供者；缺省为离线。 */
let _provider = offlineProvider;

/**
 * 注入一个语义提供者。`provider(teacherTurn, ctx)` 返回合格 Proposal（或 Promise<Proposal>）。
 * 注入后无需改动其它代码；传 null 可回到离线默认。
 * @param {function} provider
 */
function setProvider(provider) {
  _provider = typeof provider === 'function' ? provider : offlineProvider;
}

function getProvider() {
  return _provider;
}

/** 规范化 Proposal：缺失的数组字段补空数组（LLM 输出天然不完整），保证下游始终拿到合格形状。 */
function normalizeProposal(proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {};
  return {
    proposal_type: p.proposal_type || 'EvidenceAnalysisProposal',
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    slot_evidence_proposals: Array.isArray(p.slot_evidence_proposals) ? p.slot_evidence_proposals : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: Array.isArray(p.uncertainty) ? p.uncertainty : [],
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    source_turn: p.source_turn || null,
    provider_version: p.provider_version || 'custom'
  };
}

/** 合格的 Proposal 形状（G04/G05 Schema 门）：span 必须回指原话；含 slot_evidence_proposals 且合法。 */
function validateProposal(proposal, teacherTurn, validSlotIds) {
  const errors = [];
  if (!proposal || typeof proposal !== 'object') return { ok: false, errors: ['proposal 不是对象'] };
  // G04：candidate_spans[].text 必须回指教师原话
  const spans = Array.isArray(proposal.candidate_spans) ? proposal.candidate_spans : [];
  for (const s of spans) {
    const text = s && s.text;
    if (!text) { errors.push('candidate_spans 某条缺少 text'); continue; }
    if (teacherTurn && !teacherTurn.includes(text)) errors.push(`span「${text}」未出现在教师原话中`);
  }
  // G04 + 合法 Slot：slot_evidence_proposals 的 slot_id 属本题、proposed_level 0-3、supporting_spans 回指
  const sps = Array.isArray(proposal.slot_evidence_proposals) ? proposal.slot_evidence_proposals : [];
  for (const sp of sps) {
    if (!sp || !sp.slot_id) { errors.push('slot_evidence_proposal 缺 slot_id'); continue; }
    if (validSlotIds && !validSlotIds.has(sp.slot_id)) errors.push(`slot 「${sp.slot_id}」不存在于本题`);
    if (typeof sp.proposed_level === 'number' && (sp.proposed_level < 0 || sp.proposed_level > 3)) {
      errors.push(`slot 「${sp.slot_id}」 proposed_level 越界: ${sp.proposed_level}`);
    }
    if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length) {
      for (const t of sp.supporting_spans) {
        if (!teacherTurn || !teacherTurn.includes(t)) errors.push(`slot 「${sp.slot_id}」 supporting_span「${t}」未回指教师原话`);
      }
    }
  }
  // G05：不得出现能力/人格/动机的直接判定词（这些是确定性裁决的事，不在语义预筛）
  const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
  const joined = JSON.stringify(proposal);
  if (judgeRe.test(joined)) errors.push('proposal 出现能力/人格/动机直接判定词（G05）');
  return { ok: errors.length === 0, errors };
}

/**
 * analyze —— 语义预筛入口（纯函数）。
 * @param {string} teacherTurn 教师本轮原话
 * @param {object} [ctx] 上下文 { itemId, anchorBySlot, evidenceSummary, turnId, questionTitle }
 * @returns {Promise<{ proposal, ok, errors, provider }>} 总是返回结构；proposal 恒为合法形状。
 */
async function analyze(teacherTurn, ctx) {
  const turn = String(teacherTurn || '').trim();
  let proposal;
  try {
    proposal = await _provider(turn, ctx || {});
  } catch (e) {
    // Provider 崩溃：降级空 Proposal，不丢教师回答（G01/G03）。
    return { proposal: { ...EMPTY_PROPOSAL, source_turn: turn, provider_version: 'provider-error' }, ok: false, errors: [`semantic_provider_error:${e && e.message}`], provider: 'error' };
  }
  // Schema 门（G03）：先规范化（缺失数组补空），再校验内容合法性（G04/G05 + 合法 Slot）。
  const normalized = normalizeProposal(proposal);
  const { ok, errors } = validateProposal(normalized, turn, ctx && ctx.validSlotIds);
  if (!ok) {
    // Provider 输出了越界内容（span 不在原话 / 能力人格判定）→ 降级为空 Proposal，不信任其内容。
    return { proposal: { ...EMPTY_PROPOSAL, source_turn: turn, provider_version: normalized.provider_version || 'invalid' }, ok: false, errors, provider: _provider === offlineProvider ? 'offline' : 'custom' };
  }
  // 注入 source_turn + provider 版本元数据（不改变内容）
  const stamped = Object.assign({}, normalized, {
    source_turn: normalized.source_turn || turn,
    provider_version: normalized.provider_version || (_provider === offlineProvider ? 'offline-v0.1' : 'custom')
  });
  return { proposal: stamped, ok: true, errors: [], provider: _provider === offlineProvider ? 'offline' : 'custom' };
}

module.exports = {
  EMPTY_PROPOSAL,
  offlineProvider,
  setProvider,
  getProvider,
  validateProposal,
  analyze
};
