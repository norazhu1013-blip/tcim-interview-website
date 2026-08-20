'use strict';

/**
 * TCIM Decision Orchestrator（01-1 第8节、01-2 第6节）。
 *
 * 二阶段决策：
 *   Stage A：融合各模块 ModuleResult 的 action_proposals，形成 ProfessionalActionDraft，
 *            判断 knowledge_need（RAG 是否按需调用）。
 *   Stage B：锁定唯一 ProfessionalActionPlan + action_fingerprint。
 *
 * Orchestrator 拥有最终 ProfessionalActionPlan；单一模块不得拥有全局 STOP。
 * PRDM/Generator 只允许读 protected action，不得修改 target_slot/objective/probe_strategy。
 */

const {
  validateProfessionalActionPlan,
  fingerprintActionPlan,
  ACTION_TYPES
} = require('./contracts.js');

const DEFAULT_RANK_WEIGHTS = Object.freeze({
  professional_priority: 1.0,   // 表3/表1 给的专业优先级（P1=3, P2=2, P3=1）
  evidence_gap: 1.0,            // 证据缺口（level<2 且有 anchor 的 slot 更优先）
  pretest_uncertainty: 0.5,     // 前测不确定性（过程特征/低确信）
  conflict_bonus: 1.2,          // 冲突奖金：出现冲突证据的 slot 优先
  probe_cost: 0.3               // 追问成本（已多次追问的 slot 降权）
});

function parsePriority(p) {
  const m = String(p || '').match(/(\d)/);
  return m ? Number(m[1]) : 1; // P1=1, P2=2, P3=3
}

/**
 * 计算单个 proposal 的 ReRank 分数。
 * @param {object} proposal Ontology 提交的 action proposal
 * @param {object} evidenceState 当前 Evidence State（只读）
 * @param {object} opts { weights, processTags }
 */
function rankProposal(proposal, evidenceState = {}, opts = {}) {
  const w = Object.assign({}, DEFAULT_RANK_WEIGHTS, opts.weights || {});
  const slotId = proposal.target_slot;
  const slotState = (evidenceState && evidenceState[slotId]) || {};
  const level = slotState.level ?? 0;

  // professional priority: proposal.priority(0..1) 优先，否则从默认优先级换算
  let professional = proposal.priority ?? 0;
  if (!professional && proposal.priority_code) professional = 0.4 / parsePriority(proposal.priority_code);

  // evidence gap: level<2 时缺口最大；level>=2 视为充分
  const evidenceGap = level < 2 ? (1 - level / 2) : 0;

  // pretest uncertainty: slotState.uncertainty 0..1
  const uncertainty = slotState.uncertainty ?? 0;

  // conflict bonus
  const conflictBonus = (slotState.conflicting_spans && slotState.conflicting_spans.length > 0) ? 1 : 0;

  // probe cost: 已追问次数越多，成本越高
  const probeCount = slotState.probe_count ?? 0;
  const probeCost = Math.min(1, probeCount / 4);

  const score = (
    w.professional_priority * professional +
    w.evidence_gap * evidenceGap +
    w.pretest_uncertainty * uncertainty +
    w.conflict_bonus * conflictBonus -
    w.probe_cost * probeCost
  );
  return Math.max(0, score);
}

/**
 * Stage A：融合 proposals → 选出最高分候选 + knowledge_need。
 * 单一模块不拥有全局 STOP；STOP_CANDIDATE 仅在证据充分时提升。
 */
function stageA(moduleResults, evidenceState, opts = {}) {
  const proposals = [];
  for (const result of moduleResults || []) {
    for (const p of result.action_proposals || []) {
      const scored = rankProposal(p, evidenceState, opts);
      proposals.push(Object.assign({}, p, {
        score: scored,
        source_module: result.module_id,
        source_version: result.module_version
      }));
    }
  }
  if (!proposals.length) {
    return { draft: null, knowledge_need: false, ranked: [], reason: 'no_proposals' };
  }
  proposals.sort((a, b) => b.score - a.score);

  // knowledge_need：仅当证据不足且无稳定规则可走时按需（V0.1 恒 false，RAG 未启用）。
  const knowledge_need = opts.knowledgeNeed || false;
  const draft = proposals[0];
  return { draft, knowledge_need, ranked: proposals, reason: 'highest_ranked' };
}

/** 是否需要调用 RAG（V0.1 骨架：RAG 未启用，恒 false）。 */
function decideKnowledgeNeed(draft, flags) {
  if (!flags.rag_v01) return false;
  // 未来：由 ontology gap + RAG cache 决定；此处留骨架。
  return false;
}

/**
 * Stage B：把 draft 锁定为 ProfessionalActionPlan + fingerprint。
 */
function stageB(draft, opts = {}) {
  if (!draft) {
    return {
      plan: null,
      action_fingerprint: '',
      reason: 'no_action',
      source_module_versions: []
    };
  }
  const plan = {
    action_type: draft.action_type || 'PROBE',
    target_slot: draft.target_slot,
    professional_objective: draft.professional_objective || '',
    probe_strategy: draft.probe_strategy || '',
    hard_constraints: draft.hard_constraints || [],
    supporting_refs: draft.supporting_refs || [],
    action_fingerprint: '',
    source_module_versions: []
  };
  plan.action_fingerprint = fingerprintActionPlan(plan);
  plan.source_module_versions = opts.sourceModuleVersions || [];
  const v = validateProfessionalActionPlan(plan);
  return {
    plan,
    action_fingerprint: plan.action_fingerprint,
    valid: v.ok,
    validation_errors: v.errors,
    reason: draft.reason_summary || draft.rationale_code || 'locked_from_top_proposal'
  };
}

/**
 * 主入口：Stage A → (可选 RAG) → Stage B。
 * @returns { object } { plan, action_fingerprint, knowledge_need, ranked, reason }
 */
function orchestrate(moduleResults, evidenceState, flags = {}, opts = {}) {
  const { draft, knowledge_need, ranked } = stageA(moduleResults, evidenceState, opts);
  const need = knowledge_need || decideKnowledgeNeed(draft, flags);
  const out = stageB(draft, { sourceModuleVersions: opts.sourceModuleVersions || [] });
  return Object.assign({}, out, { knowledge_need: need, ranked });
}

module.exports = {
  DEFAULT_RANK_WEIGHTS,
  rankProposal,
  stageA,
  stageB,
  decideKnowledgeNeed,
  orchestrate
};
