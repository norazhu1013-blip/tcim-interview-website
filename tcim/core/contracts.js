'use strict';

/**
 * TCIM Core Contracts —— 模块统一接口与所有权规则（01-2 工程执行规范第4节）。
 *
 * 关键约束（由本文件 + contract tests 强制）：
 *   1. ModuleResult 只能携带 module-owned 的 state_updates；Core 会拒绝越权写。
 *   2. Orchestrator 拥有唯一 ProfessionalActionPlan；action_fingerprint 锁定专业目标。
 *   3. PRDM/RAG/Generator 无 Evidence 写权限，不得修改 target_slot/objective/probe_strategy。
 *   4. 任何模块可 enabled/disabled、versioned、replayable、ablatable。
 */

/** 五表对齐（V0.2，claimed/adjudicated table_alignment）。 */
const TABLE_ALIGNMENT = Object.freeze(['SUPPORT', 'PARTIAL', 'CONFLICT', 'OUT_OF_SCHEMA', 'NO_APPLICABLE_RULE']);

/** 五表政策等级（V0.2 policy_class）。 */
const POLICY_CLASS = Object.freeze(['HARD', 'SOFT', 'PRIOR', 'ADVISORY']);

/** 风险等级（V0.2 claimed/adjudicated risk）。 */
const RISK_LEVEL = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);

/** 动作类型枚举（02-1 Ontology 架构 第10节）。 */
const ACTION_TYPES = Object.freeze([
  'PROBE', 'CONFIRM', 'COMPARE', 'REFRAME', 'SHIFT_CANDIDATE', 'STOP_CANDIDATE', 'CLOSE'
]);

/** SharedState 各 namespace 的 owner（01-2 第5节）。 */
const STATE_OWNERS = Object.freeze({
  session_state: 'core',
  ontology_state: 'ontology',
  contextual_belief_state: 'belief_manager', // V0.2 新增：可撤销情境信念（与 Evidence 并列）
  dialogue_state: 'prdm',
  rag_runtime_state: 'rag',
  teacher_state: 'teacher_state', // future, disabled
  evaluation_state: 'logger'
});

/** ModuleResult.state_updates 允许的 namespace（模块只能更新自己的）。 */
const STATE_NAMESPACES = Object.freeze(Object.keys(STATE_OWNERS));

class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
    this.code = 'CONTRACT_VIOLATION';
  }
}

/** 通用校验器：返回 { ok, errors[] } 而非抛错（便于批量收集）。 */
function validateObject(value, shape, context) {
  const errors = [];
  if (!value || typeof value !== 'object') {
    return { ok: false, errors: [`${context}: 期望对象，得到 ${typeof value}`] };
  }
  for (const [key, spec] of Object.entries(shape)) {
    const val = value[key];
    const required = !!spec.required;
    if (val === undefined || val === null || val === '') {
      if (required) errors.push(`${context}.${key}: 缺少必填字段`);
      continue;
    }
    if (spec.type === 'string' && typeof val !== 'string') errors.push(`${context}.${key}: 期望字符串`);
    if (spec.type === 'array' && !Array.isArray(val)) errors.push(`${context}.${key}: 期望数组`);
    if (spec.type === 'object' && (typeof val !== 'object' || Array.isArray(val))) errors.push(`${context}.${key}: 期望对象`);
    if (spec.type === 'number' && typeof val !== 'number') errors.push(`${context}.${key}: 期望数字`);
    if (spec.type === 'boolean' && typeof val !== 'boolean') errors.push(`${context}.${key}: 期望布尔`);
  }
  return { ok: errors.length === 0, errors };
}

const ModuleInputShape = Object.freeze({
  session_id: { type: 'string', required: true },
  turn_id: { type: 'string', required: true },
  question_id: { type: 'string', required: true },
  turn_context: { type: 'object', required: true },
  shared_state_snapshot: { type: 'object', required: false },
  module_config: { type: 'object', required: false }
});

const ModuleResultShape = Object.freeze({
  module_id: { type: 'string', required: true },
  module_version: { type: 'string', required: true },
  observations: { type: 'array', required: false },
  state_updates: { type: 'object', required: false }, // { namespace: { ... } } 只允许自己的 namespace
  action_proposals: { type: 'array', required: false },
  constraints: { type: 'array', required: false },
  confidence: { type: 'number', required: false },
  evidence_refs: { type: 'array', required: false },
  decision_summary: { type: 'string', required: false },
  diagnostics: { type: 'array', required: false }
});

const ActionProposalShape = Object.freeze({
  action_type: { type: 'string', required: true },
  target_slot: { type: 'string', required: true },
  professional_objective: { type: 'string', required: true },
  probe_strategy: { type: 'string', required: false },
  priority: { type: 'number', required: false },
  expected_evidence: { type: 'number', required: false },
  hard_constraints: { type: 'array', required: false },
  supporting_refs: { type: 'array', required: false },
  confidence: { type: 'number', required: false },
  rationale_code: { type: 'string', required: false },
  reason_summary: { type: 'string', required: false }
});

const ProfessionalActionPlanShape = Object.freeze({
  action_type: { type: 'string', required: true },
  target_slot: { type: 'string', required: true },
  professional_objective: { type: 'string', required: true },
  probe_strategy: { type: 'string', required: true },
  hard_constraints: { type: 'array', required: true },
  supporting_refs: { type: 'array', required: false },
  action_fingerprint: { type: 'string', required: true },
  source_module_versions: { type: 'array', required: false }
});

/** 校验 ModuleInput。 */
function validateModuleInput(input) {
  return validateObject(input, ModuleInputShape, 'ModuleInput');
}

/** 校验 ModuleResult 且检查 state_updates 是否只写 module 拥有的 namespace。 */
function validateModuleResult(result, moduleOwner) {
  const base = validateObject(result, ModuleResultShape, 'ModuleResult');
  if (!base.ok) return base;
  const errors = [];
  if (result.state_updates) {
    for (const ns of Object.keys(result.state_updates)) {
      if (ns !== moduleOwner) {
        errors.push(`state_updates.${ns}: 模块 ${result.module_id} 只能写自己的 namespace ${moduleOwner}`);
      }
    }
  }
  if (Array.isArray(result.action_proposals)) {
    result.action_proposals.forEach((p, i) => {
      const v = validateObject(p, ActionProposalShape, `ModuleResult.action_proposals[${i}]`);
      if (!v.ok) errors.push(...v.errors);
      else if (ACTION_TYPES.indexOf(p.action_type) < 0) errors.push(`action_proposals[${i}].action_type 非法: ${p.action_type}`);
    });
  }
  return { ok: errors.length === 0, errors };
}

/** 校验 ProfessionalActionPlan。 */
function validateProfessionalActionPlan(plan) {
  const base = validateObject(plan, ProfessionalActionPlanShape, 'ProfessionalActionPlan');
  if (!base.ok) return base;
  const errors = [];
  if (ACTION_TYPES.indexOf(plan.action_type) < 0) errors.push(`action_type 非法: ${plan.action_type}`);
  if (!plan.action_fingerprint) errors.push('缺少 action_fingerprint');
  return { ok: errors.length === 0, errors };
}

/** 计算 ProfessionalActionPlan 的指纹（哈希），用于锁定专业目标。 */
function fingerprintActionPlan(plan) {
  // 不依赖 crypto 的稳定哈希（云函数/浏览器可用）。仅用于一致性比对，非安全用途。
  const payload = JSON.stringify({
    action_type: plan.action_type,
    target_slot: plan.target_slot,
    professional_objective: plan.professional_objective,
    probe_strategy: plan.probe_strategy
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const chr = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

module.exports = {
  ACTION_TYPES,
  STATE_OWNERS,
  STATE_NAMESPACES,
  TABLE_ALIGNMENT,
  POLICY_CLASS,
  RISK_LEVEL,
  ContractError,
  validateModuleInput,
  validateModuleResult,
  validateProfessionalActionPlan,
  fingerprintActionPlan,
  shapes: { ModuleInputShape, ModuleResultShape, ActionProposalShape, ProfessionalActionPlanShape }
};
