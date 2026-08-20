'use strict';

/**
 * FakeUtilityModule —— Task 0 验收用假模块（01-2 第4节 Gate）。
 *
 * 目标：证明「未来模块无需修改 Ontology 内部代码即可接入 Orchestrator」。
 * 它不改变 Evidence、不定义 Anchor、不做专业判断；只基于已有 proposal 的
 * uncertainty/gap 打一个 utility 分，作为额外的 proposal 优先级输入。
 *
 * 生产环境禁用；仅测试与演示接入路径。
 */

const VERSION = '0.0.0-fake';

function process(moduleInput, ctx) {
  const snapshot = (ctx && ctx.snapshot) || (() => ({}));
  const evidence = snapshot('ontology_state') || {};
  const evidenceState = evidence.evidence_state || {};
  const proposals = [];
  const item = moduleInput.turn_context && moduleInput.turn_context.item_package;

  if (item && Array.isArray(item.slots)) {
    for (const slot of item.slots.slice(0, 5)) {
      const st = evidenceState[slot.slot_id] || {};
      const level = st.level ?? 0;
      if (level < 2 && st.probe_status !== 'PRUNED') {
        proposals.push({
          action_type: 'PROBE',
          target_slot: slot.slot_id,
          professional_objective: `（FakeUtility 建议）继续了解 ${slot.name} 的缺口`,
          probe_strategy: 'utility_weighted_probe',
          priority: 0.1, // 故意压到极低，证明接入路径存在但不抢占 Ontology 决策
          expected_evidence: 0.05,
          hard_constraints: [],
          supporting_refs: [],
          confidence: 0.1,
          rationale_code: 'fake_utility'
        });
      }
    }
  }

  return {
    module_id: 'utility',
    module_version: VERSION,
    observations: ['fake utility module: no professional decision'],
    state_updates: {},  // 不写任何 namespace（Utility 不拥有 state）
    action_proposals: proposals,
    constraints: [],
    confidence: 0.1,
    evidence_refs: [],
    decision_summary: 'fake utility attached low-weight probes only',
    diagnostics: []
  };
}

module.exports = { id: 'utility', version: VERSION, ownerNamespace: null, process };
