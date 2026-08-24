'use strict';

/**
 * teacher_model.js —— Contextual Teacher Model（V0.2，A00）。
 *
 * 它是**派生只读快照**：只引用事实、有效 Belief、教师显式议题、Evidence 状态，
 * 不保存第二套自由文本假设（Belief State 才是持久假设真源）。
 *
 * 由 A00 ContextInterpretationProposal → Belief Manager 验证提交后，Snapshot Builder
 * 生成；每轮教师回应后重建（只引用当前有效 Belief）。不能输出人格/动机/心理诊断。
 *
 * 结构：
 *   ContextualTeacherModelSnapshot {
 *     snapshot_id, generated_for_turn, confirmed_fact_refs[], teacher_agenda_refs[],
 *     active_belief_refs[], competing_belief_refs[], uncertainty_refs[],
 *     evidence_state_ref, source_refs[], builder_version
 *   }
 */

let _snapshotSeed = 0;

const BUILDER_VERSION = '2026-08-24-teacher-model-v1';

function nextSnapshotId() {
  _snapshotSeed += 1;
  return `CTM-${Date.now().toString(36).slice(-4)}-${_snapshotSeed}`;
}

/**
 * 从当前事实 / Belief State / Evidence 构建 Teacher Model 快照（派生、只读）。
 * @param {object} opts {
 *   factRefs: [],           // 已确认事实引用（测评/过程/历史）
 *   teacherAgendaRefs: [],  // 教师显式议题引用
 *   beliefState,            // { beliefs: {...} } —— 只取 ACTIVE，且排除 RETRACTED/DIVERGED
 *   evidenceStateRef,       // 当前 Evidence 状态引用（只读引用，不复制）
 *   turnId
 * }
 * @returns {ContextualTeacherModelSnapshot}
 */
function buildTeacherModelSnapshot(opts = {}) {
  const beliefState = opts.beliefState || { beliefs: {} };
  const active = [];
  const competing = [];
  const uncertainty = [];
  for (const b of Object.values(beliefState.beliefs || {})) {
    if (b.status === 'RETRACTED') continue;
    if (b.status === 'DIVERGED') { competing.push(b.id); continue; }
    active.push(b.id);
    if ((b.uncertainty || 0) >= 0.5) uncertainty.push(b.id);
  }
  return {
    snapshot_id: nextSnapshotId(),
    generated_for_turn: opts.turnId || null,
    confirmed_fact_refs: Array.isArray(opts.factRefs) ? opts.factRefs.slice() : [],
    teacher_agenda_refs: Array.isArray(opts.teacherAgendaRefs) ? opts.teacherAgendaRefs.slice() : [],
    active_belief_refs: active,
    competing_belief_refs: competing,
    uncertainty_refs: uncertainty,
    evidence_state_ref: opts.evidenceStateRef || null,
    source_refs: Array.isArray(opts.factRefs) ? opts.factRefs.slice() : [],
    builder_version: BUILDER_VERSION
  };
}

/**
 * 从已确认事实生成 A00 ContextInterpretationProposal（AI 语境建模候选）。
 * 幂等：只基于给定 facts，产 belief_candidates / alternatives / uncertainty_candidates。
 * @param {object} opts { factRefs, assessmentSnapshot, processTags, evidenceSummary, questionTitle }
 * @returns {ContextInterpretationProposal}
 */
function buildContextInterpretationProposal(opts = {}) {
  const factRefs = Array.isArray(opts.factRefs) ? opts.factRefs : [];
  const uncertainties = [];
  const beliefs = [];
  const alts = [];

  // 例化：若过程/背景显示教师某判断依据尚不明 → 生成一条可撤销 belief 候选 + uncertainty
  const hasKeyUncertainty = Boolean(
    (opts.assessmentSnapshot && opts.assessmentSnapshot.open_text)
    || (Array.isArray(opts.processTags) && opts.processTags.length)
  );
  if (hasKeyUncertainty) {
    beliefs.push({
      claim: '教师判断儿童当前可达水平的依据尚不清楚',
      confidence: 0.61,
      alternatives: ['PROCESS_EVENT_MAY_BE_CONTEXT_SPECIFIC'],
      source_refs: factRefs.slice(0, 2)
    });
    uncertainties.push('教师依据什么现象判断儿童尚可自主尝试还是需要增加支持');
  }

  return {
    proposal_type: 'ContextInterpretationProposal',
    proposal_id: `A00-${Date.now().toString(36).slice(-6)}`,
    fact_refs: factRefs,
    proposed_beliefs: beliefs,
    alternatives: alts,
    uncertainty_candidates: uncertainties,
    source_refs: factRefs,
    schema_version: 'context-interpretation-v0.2'
  };
}

module.exports = {
  BUILDER_VERSION,
  buildTeacherModelSnapshot,
  buildContextInterpretationProposal,
  nextSnapshotId
};
