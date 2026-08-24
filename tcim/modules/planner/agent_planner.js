'use strict';

/**
 * agent_planner.js —— AI Agent Planner（V0.2，A03）。
 *
 * 在 Teacher Model 快照后、Decision/Risk Gate 前工作。AI 把 Ontology/五表/RAG/互动摘要当工具，
 * 比较至少两个合法候选，明确 selected_action 与 rejected_actions，形成 AgentDecisionProposal。
 *
 * 权力边界：只能在绿色低风险范围内 real 选择 selected_action，但输出仍以 Proposal 传递；
 * 不能直接写 core.action_plan、不能改分、不能写 Evidence、不能改 Production 五表。
 * Claimed risk / table_alignment 由 AI 自报；Gate 会重新裁决（adjudicate），不采信自报为最终结果。
 *
 * 本模块是纯逻辑（确定性排序 + 一个可插拔 compare 函数 / canned 默认），真实 LLM 语义选择由
 * 云函数 gsyg_planner 承接；本地用 canned candidate-picker 走通链路。
 */

const { TABLE_ALIGNMENT, RISK_LEVEL } = require('../../core/contracts.js');

// 默认候选生成：从当前 Evidence 缺口 + Prior 权重排序出候选（供 Planner 比较/兜底）
// 输入：{ slots: [{slot_id, name, definition}], evidenceState, priorPriorities }
function defaultCandidateActions(item, evidence) {
  const slots = ((item && item.ontology && item.ontology.slots) || []);
  return slots
    .filter((s) => s.core)
    .map((s) => {
      const st = evidence[s.slot_id] || {};
      const level = st.level ?? 0;
      const gap = level < 2 ? (1 - level / 2) : 0;
      return {
        action_id: `C-${s.slot_id}`,
        primary_target_slot: s.slot_id,
        supporting_slot_refs: [],
        professional_objective: `获得 ${s.slot_id} 的专业证据（${s.name || ''}）`,
        probe_strategy: (s.allowed_actions && s.allowed_actions[0]) || '澄清',
        single_cognitive_task: true,
        cognitive_task_code: 'EXPLAIN_ONE',
        expected_evidence_gain: gap,
        risk_level: 'LOW',
        table_alignment: 'SUPPORT',
        prior_disposition: 'NEUTRAL',
        source_refs: [s.definition]
      };
    })
    .sort((a, b) => b.expected_evidence_gain - a.expected_evidence_gain);
}

/**
 * Planner：给定 Teacher Model + Evidence + Belief + 工具，比较候选并选 selected_action。
 * @param {object} input {
 *   teacherModel, evidence, beliefState, item, tools?, candidateActions?,
 *   chooseAction?  // 可插拔:(candidates, input)=>AgentDecisionProposal;缺省用确定性 gap 排序
 * }
 * @returns {AgentDecisionProposal}
 */
function planDecision(input) {
  const candidates = input.candidateActions || defaultCandidateActions(input.item || {}, input.evidence || {});
  const chosen = (typeof input.chooseAction === 'function')
    ? input.chooseAction(candidates, input)
    : defaultSelect(candidates, input);

  const selected = chosen.selected || candidates[0];
  const selectedId = selected.action_id || `C-${selected.primary_target_slot}`;

  return {
    proposal_type: 'AgentDecisionProposal',
    proposal_id: `ADP-${Date.now().toString(36).slice(-6)}`,
    contextual_interpretation: (input.teacherModel && input.teacherModel.active_belief_refs) ? 'PROCESS_EVENT_SHAPES_NEXT_PROBE' : 'DEFAULT',
    candidate_hypotheses: (input.teacherModel && input.teacherModel.active_belief_refs) || [],
    candidate_actions: candidates.map((c) => c.action_id),
    selected_action_id: selectedId,
    rejected_action_ids: candidates.map((c) => c.action_id).filter((id) => id !== selectedId),
    why_this_now: chosen.why_this_now || 'top_evidence_gap',
    evidence_needed: selected.evidence_needed || [],
    primary_target_slot: selected.primary_target_slot,
    supporting_slot_refs: selected.supporting_slot_refs || [],
    single_cognitive_task: selected.single_cognitive_task !== false,
    cognitive_task_code: selected.cognitive_task_code || 'EXPLAIN_ONE',
    claimed_table_alignment: TABLE_ALIGNMENT.includes(selected.table_alignment) ? selected.table_alignment : 'SUPPORT',
    rule_alignment_details: selected.rule_alignment_details || [],
    prior_disposition: selected.prior_disposition || 'NEUTRAL',
    prior_reason: selected.prior_reason || '',
    claimed_risk_level: RISK_LEVEL.includes(selected.risk_level) ? selected.risk_level : 'LOW',
    fallback_action_id: selected.fallback_action_id || null,
    exit_condition: selected.exit_condition || null,
    interpretation_confidence: chosen.interpretation_confidence != null ? chosen.interpretation_confidence : 0.7,
    action_confidence: chosen.action_confidence != null ? chosen.action_confidence : 0.8,
    source_refs: (input.teacherModel && input.teacherModel.source_refs) || [],
    model_prompt_schema_versions: ['agent-planner-v0.2', 'agent-decision-v0.2']
  };
}

// 确定性选择：取 evidence_gap 最高且单一认知任务、低风险的候选
function defaultSelect(candidates, input) {
  const ranked = candidates
    .filter((c) => c.risk_level === 'LOW' || c.risk_level === undefined) // 绿色默认
    .slice()
    .sort((a, b) => (b.expected_evidence_gain || 0) - (a.expected_evidence_gain || 0));
  const selected = ranked[0] || candidates[0];
  return { selected, why_this_now: selected ? 'top_gap_low_risk' : 'fallback' };
}

module.exports = {
  planDecision,
  defaultCandidateActions,
  defaultSelect
};
