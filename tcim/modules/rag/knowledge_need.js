'use strict';

/**
 * knowledge_need.js —— RAG V0.2（04-1）：Planner 驱动的 KnowledgeNeedProposal。
 *
 * V0.1 由 Orchestrator 用布尔值判断 knowledge_need；V0.2 改为 **AI Planner 提出结构化**
 * KnowledgeNeedProposal(含 gap/expected_use/budget/fallback_without_rag)，Gate 授权，R05/RAG 执行。
 *
 * RAG 不是第二决策中心：Planner 需要 → Gate 授权范围 → RAG 检索 → 同一 planning lineage 恢复 →
 * 最终只产一个 AgentDecisionProposal。RAG 永远不回写 Evidence / Belief / Action。
 *
 * 本模块是纯逻辑（无需网络）：decideKnowledgeNeed(Planner 侧) + validateProposal(Gate 侧)。
 */

const ROUTES = ['R0', 'R1', 'R2', 'R3'];

// 阶段权限（04-1 §7）：DIAGNOSE_INTERNAL 默认不可 teacher-facing；REFLECT/SUPPORT 条件展示
const PHASE_TEACHER_FACING = { DIAGNOSE_INTERNAL: false, REFLECT: true, SUPPORT: true };

const EMPTY_PROPOSAL = Object.freeze({
  proposal_type: 'KnowledgeNeedProposal',
  need: false,
  gap: '',
  expected_use: '',
  intent: '',
  phase: 'DIAGNOSE_INTERNAL',
  route_ceiling: 'R0',
  budget: { max_refs: 3, query_terms: 3 },
  fallback_without_rag: true,
  source_refs: []
});

/**
 * Planner 侧：判断是否需要知识支持，输出 KnowledgeNeedProposal。
 * 默认克制（R0）；仅当 core slot 大量 level 0 且轮次 >= 3、且存在可用的专业查询词时 need=true。
 * @param {object} ctx { evidence, item, turnNo, budget? }
 * @returns {KnowledgeNeedProposal}
 */
function decideKnowledgeNeed(ctx) {
  const evidence = ctx.evidence || {};
  const item = ctx.item || {};
  const turnNo = ctx.turnNo || 0;
  const core = ((item.ontology && item.ontology.slots) || []).filter((s) => s.core);
  const zeroLevel = core.filter((s) => {
    const st = evidence[s.slot_id];
    return st && (st.level === null || st.level === 0) && st.probe_status !== 'PRUNED';
  }).length;

  const canQuery = Boolean(item.ontology && item.ontology.diagnostic_focus);
  const need = zeroLevel >= 3 && turnNo >= 3 && canQuery;
  if (!need) {
    return { ...EMPTY_PROPOSAL, fallback_without_rag: true, source_refs: [item.item_id] };
  }
  return {
    proposal_type: 'KnowledgeNeedProposal',
    need: true,
    gap: `core slots 材料/机制多处未达 level_2 (zero=${zeroLevel}/${core.length})`,
    expected_use: '为下一行动候选提供可追溯的专业参考，降低不确定性',
    intent: item.ontology.diagnostic_focus || '判断',
    phase: 'SUPPORT', // 知识用于支撑下一步探查
    route_ceiling: 'R2',
    budget: { max_refs: 3, query_terms: 3 },
    fallback_without_rag: true,
    source_refs: [item.item_id, ...core.slice(0, 2).map((s) => s.slot_id)]
  };
}

/**
 * Gate 侧：校验 KnowledgeNeedProposal 合法性（Schema 门）。非法则降级 R0/need=false。
 * @param {object} proposal
 * @returns {{ ok, errors, proposal }}
 */
function validateProposal(proposal) {
  const errors = [];
  const p = proposal && typeof proposal === 'object' ? proposal : EMPTY_PROPOSAL;
  if (typeof p.need !== 'boolean') errors.push('need 应为布尔');
  if (p.need && !p.gap) errors.push('need=true 需 gap');
  if (p.need && !p.expected_use) errors.push('need=true 需 expected_use');
  if (!ROUTES.includes(p.route_ceiling)) errors.push(`route_ceiling 非法: ${p.route_ceiling}`);
  if (!Object.keys(PHASE_TEACHER_FACING).includes(p.phase)) errors.push(`phase 非法: ${p.phase}`);
  // RAG 永不写 Evidence/Belief/Action（此处无需额外校验，硬约束在 rag.process 内保证）
  return { ok: errors.length === 0, errors, proposal: p };
}

module.exports = {
  ROUTES,
  PHASE_TEACHER_FACING,
  EMPTY_PROPOSAL,
  decideKnowledgeNeed,
  validateProposal
};
