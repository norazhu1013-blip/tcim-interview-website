/**
 * plannerLLM.js —— TCIM V0.2 A03/A04 的 planner provider（网页端）。
 *
 * 负责把「下一专业行动选择」交给云端真实 LLM（经网关 /call → gsyg_planner），
 * 网关/云函数不可用时回退到本地确定性 Planner（agentPlanner.planDecision，同一 Schema）。
 *
 * A03 Planner 输出 AgentDecisionProposal（含 selected_action）+ A04 Risk Gate 裁决。
 * provider 永不抛错：任一失败即回退（空/确定性 fallback），保证 TCIM 能用、不泄露、不改分。
 *
 * 用法：
 *   import { makePlannerProvider } from '../services/plannerLLM.js'
 *   在 engine.setPlannerProvider(makePlannerProvider()) 前调用注册一次（幂等）。
 *
 * 红线：planner 只出 Proposal (selected_action)，不写 Evidence/action_plan；Gate 只裁决不重做选择。
 */
import { callGateway } from './web-gateway.js'
import { planDecision as deterministicPlan } from '../../../../tcim/modules/planner/agent_planner.js'

const LEAK_RE = /得分|分数|标准答案|专家排序|评分|R\/P\/G/

/** 是否应启用云端 planner：网关已配置，且构建变量未显式关闭。 */
function plannerEnabled() {
  if (String(import.meta.env.VITE_TCIM_PLANNER || '').trim() === '0') return false
  const gateway = Boolean(String(import.meta.env.VITE_WEB_API_BASE_URL || '').trim())
  return gateway
}

/** 规范化云端返回的 AgentDecisionProposal（缺失字段补空/默认，G05/泄露剔除）。 */
function normalizeServerDecision(raw) {
  const d = (raw && typeof raw === 'object') ? raw : {}
  let proposal = {
    proposal_type: 'AgentDecisionProposal',
    candidate_actions: Array.isArray(d.candidate_actions) ? d.candidate_actions : [],
    selected_action_id: d.selected_action_id || null,
    rejected_action_ids: Array.isArray(d.rejected_action_ids) ? d.rejected_action_ids : [],
    primary_target_slot: d.primary_target_slot || null,
    supporting_slot_refs: Array.isArray(d.supporting_slot_refs) ? d.supporting_slot_refs : [],
    single_cognitive_task: d.single_cognitive_task !== false,
    cognitive_task_code: d.cognitive_task_code || null,
    claimed_table_alignment: ['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE'].includes(d.claimed_table_alignment) ? d.claimed_table_alignment : 'SUPPORT',
    claimed_risk_level: ['LOW', 'MEDIUM', 'HIGH'].includes(d.claimed_risk_level) ? d.claimed_risk_level : 'LOW',
    why_this_now: d.why_this_now || '',
    prior_disposition: d.prior_disposition || 'NEUTRAL',
    fallback_action_id: d.fallback_action_id || null,
    exit_condition: d.exit_condition || null,
    source_refs: Array.isArray(d.source_refs) ? d.source_refs : [],
    model_prompt_schema_versions: Array.isArray(d.model_prompt_schema_versions) ? d.model_prompt_schema_versions : ['agent-planner-v0.2']
  }
  // G05 / 泄露 拦截 → 整条作废，回退空（不信任越界内容）
  if (LEAK_RE.test(JSON.stringify(proposal)) || /能力|人格|动机|心理/.test(JSON.stringify(proposal))) {
    return { ok: false, decision: null, gate: null, errors: ['planner_llm_guard'] }
  }
  return { ok: true, decision: proposal, gate: d.gate || null, errors: [] }
}

/**
 * 生成一个遵循 A03 契约的 planner provider。
 * 输入 teacherModel / evidence / beliefState / candidateActions；输出 AgentDecisionProposal + gate。
 * 永不抛错；云端不可用时用本地确定性 Planner。
 */
export function makePlannerProvider() {
  return async function plannerProvider(input) {
    const itemId = input?.itemId || ''
    const context = {
      itemId,
      teacherModel: input?.teacherModel || {},
      evidence: input?.evidence || {},
      beliefState: input?.beliefState || { beliefs: {}, version: 0 },
      candidateActions: input?.candidateActions || []
    }
    // 本地确定性 fallback（同一 Schema）
    const local = deterministicPlan({ item: input?.item, evidence: context.evidence, teacherModel: context.teacherModel, beliefState: context.beliefState, candidateActions: context.candidateActions })
    if (!plannerEnabled() || !itemId) return { decision: local, gate: null, source: 'local' }

    try {
      const res = await callGateway('planner', context)
      if (!res || !res.ok || !res.decision) return { decision: local, gate: null, source: 'local' }
      const norm = normalizeServerDecision(res.decision)
      if (!norm.ok) return { decision: local, gate: null, source: 'local' }
      return { decision: norm.decision, gate: norm.gate || (res.gate || null), source: 'cloud' }
    } catch (e) {
      // 网络失败 → 回退本地确定性 Planner（不抛错、不猜测）
      return { decision: local, gate: null, source: 'local' }
    }
  }
}
