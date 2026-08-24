'use strict';

/**
 * GameSupportOntologyModule —— V0.1 首个专业决策模块（02-1 架构）。
 *
 * 职责：读取 Item Package → 匹配 Prior Rule（表3）→ 更新 Evidence（表2）→
 *       对 Slot 进行 ReRank → 形成 Probe/Prune/Reopen 候选 → 输出 ModuleResult。
 * 不做：生成教师可见文本；决定全局 STOP；写其他模块 state。
 *
 * 数据源：tcim/professional_data/game_support/questions/qXX/*.json（Task 2 生成）。
 * 通过 setData(items) 注入；模块不读取文件系统，便于网页/云函数两端复用。
 */

const { createEvidenceState, updateSlot, statusFromLevel } = require('./evidence_state.js');
const { assessSlot, buildKeywords, overlapCount, updateEvidence } = require('./evidence_updater.js');
const { analyze } = require('../evidence_semantic/evidence_semantic.js');

const MODULE_VERSION = '2026-08-21-ontology-v0.1.1';

// 内置数据（注入后覆盖）：items[question_id] = { ontology, anchors, priority, probes, stop }
let _DATA = {};

function setData(items) {
  if (items) _DATA = items;
}

function getData() {
  return _DATA;
}

/** 前测 prior 初始化：由排序/过程特征触发表3 priority 规则 → 目标 slot 的初始 uncertainty/优先级。 */
function initPriorFromPretest(itemId, teacherRanking, processTags, evidenceState) {
  const item = _DATA[itemId];
  if (!item || !evidenceState) return evidenceState;
  const priorityRules = (item.priority && item.priority.rules) || [];
  const rankingStr = Array.isArray(teacherRanking) ? teacherRanking.join('') : String(teacherRanking || '');
  const first = rankingStr[0] || '';
  const last = rankingStr[rankingStr.length - 1] || '';

  for (const rule of priorityRules) {
    const cond = rule.condition || '';
    let matched = false;
    if (cond.includes('0—1分') || cond.includes('0-1分')) {
      // 由实证赋分判定低分区间（此处用过程特征近似：末位 D 或极快作答）
      matched = last === 'D' || (Array.isArray(processTags) && processTags.some((t) => /极快|低确信|反复修改/.test(t)));
    } else if (/实证4分|4分/.test(cond)) {
      matched = rankingStr.startsWith('A') || rankingStr.startsWith('C') || (Array.isArray(processTags) && processTags.some((t) => /高确信|稳定/.test(t)));
    } else if (/实证3分/.test(cond)) {
      matched = /[ABC]/.test(first) && !cond.includes('4分');
    } else if (/实证2分/.test(cond)) {
      matched = true;
    } else if (/D居末|D排前|D靠前/.test(cond)) {
      matched = (cond.includes('末') ? last === 'D' : first === 'D');
    } else if (/A居首/.test(cond)) {
      matched = first === 'A';
    } else {
      matched = true; // 兜底
    }
    if (!matched) continue;

    const uncertaintyBoost = /低确信|反复修改|不确定|0—1分/.test(cond) ? 0.4 : 0.2;
    for (const slotId of rule.target_slots || []) {
      const st = evidenceState[slotId];
      if (st) {
        st.uncertainty = Math.min(1, (st.uncertainty || 0) + uncertaintyBoost);
        // priority P1/P2/P3 转成 0..1 分数存起来供 ReRank
        st._prior_priority = rule.priority === 'P1' ? 0.9 : (rule.priority === 'P2' ? 0.6 : 0.3);
      }
    }
  }
  return evidenceState;
}

/** 选取本轮最相关的候选 slot（最多 1-3 个，防止泛化过度）。 */
function selectCandidateSlots(item, evidenceState, turnCount) {
  const slots = (item.ontology && item.ontology.slots) || [];
  const candidate = slots
    .filter((s) => {
      const st = evidenceState[s.slot_id];
      if (!st) return false;
      if (st.probe_status === 'PRUNED' || st.probe_status === 'SATURATED') return false;
      // 核心 slot 且证据不足（level<2）优先
      return s.core && st.level < 2;
    })
    .sort((a, b) => {
      const sa = evidenceState[a.slot_id];
      const sb = evidenceState[b.slot_id];
      const scoreFor = (s) => (s._prior_priority || 0) + (s.level === 0 ? 0.5 : 0) + (s.uncertainty || 0);
      return scoreFor(sb) - scoreFor(sa);
    });
  // 每轮 1-3 个
  return candidate.slice(0, Math.min(3, Math.max(1, turnCount % 3 + 1)));
}

/** 依据表5 stop/prune 规则，对候选 slot 做 Gate 信号。 */
function applyStopRules(item, evidenceState, candidateSlots) {
  const signals = [];
  const stopRules = (item.stop && item.stop.rules) || [];
  for (const rule of stopRules) {
    const scope = rule.scope || '';
    if (!scope.includes('~') && !scope.includes('整题')) continue;
    // 分支级规则（如 "Q1-S1~S2"）：检查该分支所有 slot 是否 level>=2
    const slotMatch = scope.match(/Q\d-S\d+[~-]Q?\d?S?(\d+)?/);
    if (slotMatch) {
      const branch = scope.split(' ')[0];
      const ids = branch.split(/[~-]/).filter(Boolean);
      const allSufficient = ids.every((sid) => {
        const st = evidenceState[sid];
        return st && st.level >= 2;
      });
      if (allSufficient) {
        signals.push({ type: 'BRANCH_SUFFICIENT', scope, note: rule.sufficient_condition });
        // 剪枝
        for (const sid of ids) {
          if (evidenceState[sid]) evidenceState[sid].probe_status = 'PRUNED';
        }
      }
    } else if (scope.includes('整题')) {
      // 整题充分条件：核心 slot ≥4 个达到 level>=2
      const coreSlots = ((item.ontology && item.ontology.slots) || []).filter((s) => s.core);
      const sufficient = coreSlots.filter((s) => evidenceState[s.slot_id] && evidenceState[s.slot_id].level >= 2).length;
      if (sufficient >= 4) {
        signals.push({ type: 'ITEM_SUFFICIENT', scope: '整题', note: rule.sufficient_condition });
      }
    }
  }
  return signals;
}

/** 由 probe 表生成一个槽的追问（这是 Ontology 的专业候选，不是教师可见文本）。 */
function buildProbeProposal(item, slot, evidenceState, priorityScore) {
  const probes = (item.probe && item.probes) || [];
  const probe = probes.find((p) => p.slot_id === slot.slot_id) || {};
  const st = evidenceState[slot.slot_id] || {};

  // 若已追问多次或证据已达 2 级 → 建议剪枝/收束
  let actionType = 'PROBE';
  if (st.probe_count >= 3 || st.level >= 2) {
    actionType = 'SHIFT_CANDIDATE';
  }

  const priority = st._prior_priority || (slot.default_priority === 'P1' ? 0.9 : slot.default_priority === 'P2' ? 0.6 : 0.3);
  return {
    action_type: actionType,
    target_slot: slot.slot_id,
    professional_objective: `获得 ${slot.name} 的证据（${slot.definition}）`,
    probe_strategy: probe.preferred_action || (slot.allowed_actions && slot.allowed_actions[0]) || '澄清',
    priority: Math.max(0, priority * (1 - (st.level || 0) * 0.3)),
    expected_evidence: st.level >= 2 ? 0.2 : 0.7,
    hard_constraints: ['单轮一主问', '不泄露标准答案', ...(probe.forbidden_actions || []).map((a) => `禁用:${a}`)],
    supporting_refs: (probe.typical_question ? [{ type: 'probe_template', text: probe.typical_question }] : []),
    confidence: st.confidence || 0.5,
    rationale_code: st.level >= 2 ? 'slot_sufficient_shift' : 'highest_evidence_gap',
    reason_summary: `目标槽 ${slot.slot_id} 当前 level=${st.level || 0}，优先级=${(priority).toFixed(2)}`
  };
}

/**
 * 模块入口（Module Contract）：
 *   input.turn_context.teacher_turn 为本轮回答；
 *   snapshot('ontology_state') 提供 evidence_state（只读）；
 *   返回 ModuleResult，state_updates.ontology_state 携带新 evidence_state（Ontology owner）。
 */
async function process(input, ctx) {
  const qid = input.question_id;
  const item = _DATA[qid];
  if (!item) {
    return {
      module_id: 'ontology_game_support',
      module_version: MODULE_VERSION,
      observations: [],
      state_updates: {},
      action_proposals: [],
      constraints: [],
      confidence: 0,
      evidence_refs: [],
      decision_summary: `no_item_package:${qid}`,
      diagnostics: []
    };
  }

  const snapshot = (ctx && ctx.snapshot) || (() => ({}));
  const ontologyState = snapshot('ontology_state') || {};
  let evidenceState = ontologyState.evidence_state || {};

  // 首次：用题目的全部 slot id 建初始状态（前测 prior 由排序触发）
  const slotIds = (item.ontology && item.ontology.slots) || [];
  if (!Object.keys(evidenceState).length && slotIds.length) {
    evidenceState = createEvidenceState(slotIds.map((s) => s.slot_id));
  }
  // 前测 prior：只在首轮初始化（这里由调用方在访谈开始前做一次）
  evidenceState = initPriorFromPretest(qid, input.turn_context.teacher_ranking, input.turn_context.process_tags || [], evidenceState);
  // 前测完整资料（分数/教龄）调 uncertainty（只作 prior，不填等级）—— 与网页端一致
  const pretest = input.turn_context.pretest || {};
  if (pretest && (typeof pretest.mean === 'number' || typeof pretest.total === 'number')) {
    const lowScoreBoost = typeof pretest.mean === 'number' && pretest.mean < 2 ? 0.15 : 0;
    const noviceBoost = /^[0-5]\s*年/.test(String(pretest.teachingYears || '')) ? 0.1 : 0;
    if (lowScoreBoost || noviceBoost) {
      for (const sid of slotIds) {
        if (evidenceState[sid]) evidenceState[sid].uncertainty = Math.min(1, (evidenceState[sid].uncertainty || 0) + lowScoreBoost + noviceBoost);
      }
    }
  }

  // 本轮更新证据（表2 锚点匹配）。
  // 原则（02-1 第8节）：教师回答可能同时触及多个 slot，不能只检查当前 target_slot 而忽略
  // 明确出现的相关证据。因此对所有未剪枝的核心 slot 都做锚点匹配；「焦点候选」只用于决定
  // 下一轮优先追问哪些（proposals），不影响证据采集。
  const anchorsBySlot = {};
  for (const a of ((item.anchors && item.anchors.anchors) || [])) {
    anchorsBySlot[a.slot_id] = a;
  }
  const candidateSlots = selectCandidateSlots(item, evidenceState, input.turn_context.turn_no || 0);
  const evaluateSlotIds = ((item.ontology && item.ontology.slots) || [])
    .filter((s) => s.core && evidenceState[s.slot_id] && evidenceState[s.slot_id].probe_status !== 'PRUNED')
    .map((s) => s.slot_id);
  const { state: newEvidence, updates } = updateEvidence(
    evidenceState,
    anchorsBySlot,
    input.turn_context.teacher_turn,
    input.turn_id,
    evaluateSlotIds
  );

  // 把 updates 应用回 state
  for (const u of updates) {
    if (u.reason.startsWith('anchor_level_')) {
      // 由 updateEvidence 已直接写入 state
    }
  }

  // ---- A01 语义预筛（Step 1：LLM 只做 Proposal，裁决权仍在确定性 EvidenceUpdater）----
  // 只作为语义层的「观察/线索」透传，绝不能改 level/confidence（G04 升级必须回指 span +
  // 确定性锚点命中；G05 不得从短答/犹豫/礼貌推断能力动机）。
  let semantic = null;
  try {
    const semanticCtx = {
      itemId: qid,
      turnId: input.turn_id,
      anchorBySlot: anchorsBySlot,
      evidenceSummary: newEvidence,
      questionTitle: (item.metadata && item.metadata.title) || '',
      validSlotIds: new Set(((item.ontology && item.ontology.slots) || []).map((s) => s.slot_id))
    };
    const sem = await analyze(input.turn_context.teacher_turn, semanticCtx);
    semantic = sem;
  } catch (e) {
    // 语义层失败不得影响主流程（G01：不得丢失教师回答/Evidence）。这里记一条诊断即可。
    semantic = { proposal: null, ok: false, errors: [`semantic_crash:${e && e.message}`], provider: 'error' };
  }

  // 应用 stop/prune gate
  const gateSignals = applyStopRules(item, newEvidence, candidateSlots);

  // 生成 proposals
  const proposals = [];
  for (const slot of (item.ontology && item.ontology.slots) || []) {
    if (slot.core && !['PRUNED', 'SATURATED'].includes(newEvidence[slot.slot_id]?.probe_status)) {
      proposals.push(buildProbeProposal(item, slot, newEvidence, 0));
    }
  }
  // STOP_CANDIDATE：整题充分时提出（由 Orchestrator 裁决，不全局停止）
  if (gateSignals.some((s) => s.type === 'ITEM_SUFFICIENT')) {
    proposals.push({
      action_type: 'STOP_CANDIDATE',
      target_slot: 'ALL',
      professional_objective: '整题核心证据已充分',
      probe_strategy: 'CLOSE',
      priority: 0.95,
      expected_evidence: 0,
      hard_constraints: ['不泄露内部判断'],
      supporting_refs: [],
      confidence: 0.9,
      rationale_code: 'item_sufficient',
      reason_summary: '核心 slot 充分条件满足'
    });
  }

  // A01 语义信号只作为「观察」附注，不改变确定性升级/冲突判定。reason 用 semantic_ 前缀，
  // 不会命中 stress 测试的 anchor_level_ / conflict 统计，也不作为 state 写入依据。
  const semanticSignals = [];
  if (semantic && semantic.ok && semantic.proposal) {
    const p = semantic.proposal;
    for (const span of p.candidate_spans || []) {
      semanticSignals.push({ slot: (span.candidate_slots && span.candidate_slots[0]) || '?', reason: 'semantic_span', span: span.text, slots: span.candidate_slots || [] });
    }
    for (const sp of p.slot_evidence_proposals || []) {
      semanticSignals.push({ slot: sp.slot_id, reason: 'semantic_slot_proposal', proposed_level: sp.proposed_level, confidence: sp.confidence, supporting_spans: sp.supporting_spans || [] });
    }
    for (const c of p.conflict_candidates || []) {
      semanticSignals.push({ slot: c.slot_id || '?', reason: 'semantic_conflict_candidate', note: c.reason });
    }
    for (const n of p.no_change_reasons || []) {
      semanticSignals.push({ slot: n.slot_id || '?', reason: 'semantic_no_change', note: n.reason });
    }
  }

  return {
    module_id: 'ontology_game_support',
    module_version: MODULE_VERSION,
    observations: updates.map((u) => ({ slot: u.slot_id, reason: u.reason })),
    state_updates: { ontology_state: { evidence_state: newEvidence } },
    action_proposals: proposals,
    constraints: gateSignals.map((s) => ({ type: s.type, scope: s.scope })),
    confidence: 0.8,
    evidence_refs: updates.map((u) => u.quote),
    decision_summary: semantic
      ? `ontology: ${updates.length} slot updates, ${proposals.length} proposals, ${gateSignals.length} gates, semantic=${semantic.provider}${semantic.ok ? '' : '(invalid)'}`
      : `ontology: ${updates.length} slot updates, ${proposals.length} proposals, ${gateSignals.length} gates`,
    diagnostics: [...updates, ...semanticSignals]
  };
}

module.exports = {
  id: 'ontology_game_support',
  version: MODULE_VERSION,
  ownerNamespace: 'ontology_state',
  setData,
  getData,
  process,
  initPriorFromPretest,
  selectCandidateSlots,
  applyStopRules
};
