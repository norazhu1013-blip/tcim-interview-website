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
const { assessSlot, buildKeywords, overlapCount, updateEvidence, validateProposal, commitProposal, bigramFallback } = require('./evidence_updater.js');
const { analyze } = require('../evidence_semantic/evidence_semantic.js');
const { createBeliefState, validateBeliefMutation, applyBeliefMutation } = require('../context/belief_state.js');
const { buildTeacherModelSnapshot, buildContextInterpretationProposal } = require('../context/teacher_model.js');
const { planDecision } = require('../planner/agent_planner.js');
const { validateDecision } = require('../gate/decision_gate.js');
const { createChallengeQueue, challengeFromDecision } = require('../context/challenge_queue.js');

const MODULE_VERSION = '2026-08-21-ontology-v0.2-sanity';

// TCIM_SEMANTIC_MODE：required | fallback_allowed | shadow | disabled
//   disabled（规则基线）：保留原 bigram updateEvidence，Validator/Committer 不介入。
//   fallback_allowed / required / shadow：LLM Proposal 经 Validator→Committer 提交；
//     LLM 失败时 fallback_allowed 用 bigramFallback（同一 Schema），required 标错，shadow 只透传不写。
const SEMANTIC_MODE = String((typeof process !== 'undefined' && process.env && process.env.TCIM_SEMANTIC_MODE) || 'disabled').trim();
// 测试可注入 setSemanticMode；默认从 env 读取。
let _semanticMode = SEMANTIC_MODE;
function setSemanticMode(mode) { _semanticMode = String(mode || 'disabled').trim(); }
function getSemanticMode() { return _semanticMode; }

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
  const teacherTurn = input.turn_context.teacher_turn;
  const validSlotIds = new Set(((item.ontology && item.ontology.slots) || []).map((s) => s.slot_id));

  let newEvidence;
  let updates = [];
  let semantic = null;
  let semanticMode = getSemanticMode();

  if (semanticMode === 'disabled') {
    // 规则基线：原 bigram updateEvidence（Validator/Committer 不介入，保持确定性与旧基线一致）
    const r = updateEvidence(evidenceState, anchorsBySlot, teacherTurn, input.turn_id, evaluateSlotIds);
    newEvidence = r.state;
    updates = r.updates;
  } else {
    // ---- 语义主路径：LLM Proposal → Validator → Committer ----
    let proposal = null;
    let source = 'nl_llm';
    let llmProposal = null;
    try {
      const semCtx = { itemId: qid, turnId: input.turn_id, anchorBySlot: anchorsBySlot, evidenceSummary: evidenceState, questionTitle: (item.metadata && item.metadata.title) || '', validSlotIds };
      const sem = await analyze(teacherTurn, semCtx);
      semantic = sem;
      if (sem.ok && sem.proposal) { proposal = sem.proposal; llmProposal = sem.proposal; source = 'llm'; }
      else source = 'llm_invalid';
    } catch (e) {
      semantic = { proposal: null, ok: false, errors: [`semantic_crash:${e && e.message}`], provider: 'error' };
      source = 'llm_crash';
    }
    // 若 LLM 未给出任何 slot 证据（空 Proposal），fallback_allowed/required 用 bigramFallback（同一 Schema），
    // 使「无证据」也走同一条提交路径、且规则能兜住离线/空转。
    const llmHasSlots = llmProposal && Array.isArray(llmProposal.slot_evidence_proposals) && llmProposal.slot_evidence_proposals.length > 0;
    if (!llmHasSlots) {
      if (semanticMode === 'required') {
        semanticMode = 'required_degraded';
        proposal = bigramFallback(teacherTurn, anchorsBySlot, evaluateSlotIds);
        source = 'required_fallback';
      } else {
        proposal = bigramFallback(teacherTurn, anchorsBySlot, evaluateSlotIds);
        source = 'rule_fallback';
      }
    }
    // Validator 只查合法性，不重新裁决（无论 LLM 或 fallback 都走同一验证器）
    const validation = validateProposal(proposal, { itemId: qid, validSlotIds, teacherTurn, anchorsBySlot });
    // Committer 提交（唯一写 evidence_state 入口）
    const committed = commitProposal(evidenceState, validation.acceptedUpdates, teacherTurn, input.turn_id);
    newEvidence = committed.state;
    updates = committed.updates;
    // shadow：只透传不写状态（保持 Evidence 原样，供上线前比较）
    if (semanticMode === 'shadow') {
      newEvidence = evidenceState;
      updates = [];
    }
  }

  // ---- V0.2 双状态链：A02B Belief 更新 + Teacher Model 快照 + A03/A04 Planner→Gate ----
  // 仅在语义主路径（非 disabled）执行；disabled 走纯规则，Belief 保持空。
  let beliefState = (ctx && ctx.sharedState && ctx.sharedState.contextual_belief_state) || { beliefs: {}, version: 0 };
  const beliefEvents = [];
  let teacherModelSnapshot = null;
  let agentDecision = null;
  let gateResult = null;
  let challengeQueue = createChallengeQueue();

  if (semanticMode !== 'disabled' && semantic && semantic.ok && semantic.proposal) {
    // A02B：从语义信号推断可撤销 Belief（不含能力/人格判定）。只做 ADD 候选，交由 Belief Manager 校验提交。
    const factRefs = [input.turn_id, qid];
    const uncertainties = (semantic.proposal.uncertainty || []).slice(0, 2);
    for (const u of uncertainties) {
      const mut = { op: 'ADD', claim: u, confidence: 0.6, uncertainty: 0.6, source_refs: factRefs, alternatives: [] };
      const v = validateBeliefMutation(mut, beliefState);
      if (v.ok) {
        const { state: next, event } = applyBeliefMutation(beliefState, mut, input.turn_id);
        beliefState = next;
        beliefEvents.push(event);
      }
    }
    // Teacher Model 快照（派生、只读）：引用当前事实 + 有效 Belief
    teacherModelSnapshot = buildTeacherModelSnapshot({
      factRefs,
      beliefState,
      evidenceStateRef: qid,
      turnId: input.turn_id
    });
    // A03 Planner：用 Evidence 缺口 + Teacher Model 生成候选并选 action
    agentDecision = planDecision({
      item,
      evidence: newEvidence,
      teacherModel: teacherModelSnapshot,
      beliefState
    });
    // A04 Risk Gate：验证 + 裁决（不重做选择）
    gateResult = validateDecision(agentDecision, {
      expectedStateVersion: beliefState.version,
      committedStateVersion: beliefState.version
    });
    // A12：表偏离/表外/冲突 → 登记挑战候选（进 Replay + 专业审核，不自动改 Production）
    challengeQueue = challengeFromDecision(challengeQueue, agentDecision, gateResult);
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

  // V0.2 双状态：把 Belief / Teacher Model / Planner / Gate 结果作为观察与 diagnostics 上报
  //（Belief 实际写入由独立 Belief Manager 模块负责；本模块只读并供 Planner，不写 contextual_belief_state）
  const beliefObservations = beliefEvents.map((ev) => ({ claim: ev.claim || '', op: ev.op, confidence: ev.after && ev.after.confidence, reason: 'belief_' + ev.op }));
  const v2Diagnostics = [];
  if (teacherModelSnapshot) v2Diagnostics.push({ reason: 'teacher_model_snapshot', active_belief_refs: teacherModelSnapshot.active_belief_refs, competing_belief_refs: teacherModelSnapshot.competing_belief_refs });
  if (challengeQueue && challengeQueue.challenges.length) v2Diagnostics.push({ reason: 'challenge_candidate', challenges: challengeQueue.challenges });
  if (agentDecision) v2Diagnostics.push({ reason: 'agent_decision', selected_action_id: agentDecision.selected_action_id, primary_target_slot: agentDecision.primary_target_slot, claimed_table_alignment: agentDecision.claimed_table_alignment, claimed_risk_level: agentDecision.claimed_risk_level, rejected_action_ids: agentDecision.rejected_action_ids });
  if (gateResult) v2Diagnostics.push({ reason: 'gate_result', decision: gateResult.decision, adjudicated_risk_level: gateResult.adjudicated_risk_level, adjudicated_table_alignment: gateResult.adjudicated_table_alignment, evaluator_required: gateResult.evaluator_required });

  // V0.2 结构化 Replay（供研究/审计）：每轮把关键事件 + 版本 + claimed/adjudicated 值序列化
  const replay = buildReplay({
    turnId: input.turn_id,
    semanticMode,
    semanticProposal: semantic ? semantic.proposal : null,
    evidenceUpdates: updates,
    beliefEvents,
    teacherModelSnapshot,
    agentDecision,
    gateResult
  });
  if (replay.length) v2Diagnostics.push({ reason: 'replay', events: replay });

  return {
    module_id: 'ontology_game_support',
    module_version: MODULE_VERSION,
    observations: updates.map((u) => ({ slot: u.slot_id, reason: u.reason })),
    state_updates: { ontology_state: { evidence_state: newEvidence } },
    action_proposals: proposals,
    constraints: gateSignals.map((s) => ({ type: s.type, scope: s.scope })),
    confidence: 0.8,
    evidence_refs: updates.map((u) => u.quote),
    decision_summary: `ontology: ${updates.length} slot updates, ${proposals.length} proposals, ${gateSignals.length} gates, mode=${semanticMode}, belief=${beliefEvents.length}, planner=${agentDecision ? agentDecision.selected_action_id : 'n/a'}, gate=${gateResult ? gateResult.decision : 'n/a'}`,
    diagnostics: [...updates, ...semanticSignals, ...beliefObservations, ...v2Diagnostics]
  };
}

/**
 * 把本轮关键事件序列化为结构化 Replay（V0.2 A11 增强）。只读、无副作用。
 * 保留：turn_id、semantic_mode、Evidence before/after、Belief 变更、Planner 决策、Gate 裁决、
 * claimed/adjudicated risk + table_alignment、model/schema 版本、source_refs、fallback。
 */
function buildReplay(ctx) {
  const events = [];
  const turn = ctx.turnId;
  const base = { turn_id: turn, ts: Date.now() };

  if (ctx.semanticMode && ctx.semanticMode !== 'disabled') {
    events.push({ ...base, phase: 'SemanticProposal', semantic_mode: ctx.semanticMode, candidate_spans: (ctx.semanticProposal && ctx.semanticProposal.candidate_spans || []).length, slot_evidence_proposals: (ctx.semanticProposal && ctx.semanticProposal.slot_evidence_proposals || []).length, schema_version: (ctx.semanticProposal && ctx.semanticProposal.provider_version) || 'n/a' });
  }
  for (const u of (ctx.evidenceUpdates || [])) {
    events.push({ ...base, phase: 'EvidenceCommit', slot_id: u.slot_id, before: u.before, after: u.after, quote: u.quote, reason: u.reason });
  }
  for (const b of (ctx.beliefEvents || [])) {
    events.push({ ...base, phase: 'BeliefCommit', op: b.op, claim: b.claim || null, before: b.before, after: b.after });
  }
  if (ctx.teacherModelSnapshot) {
    events.push({ ...base, phase: 'TurnResolutionSnapshot', active_belief_refs: ctx.teacherModelSnapshot.active_belief_refs, competing_belief_refs: ctx.teacherModelSnapshot.competing_belief_refs, uncertainty_refs: ctx.teacherModelSnapshot.uncertainty_refs, builder_version: ctx.teacherModelSnapshot.builder_version });
  }
  if (ctx.agentDecision) {
    const a = ctx.agentDecision;
    events.push({ ...base, phase: 'PlannerDecision', selected_action_id: a.selected_action_id, rejected_action_ids: a.rejected_action_ids, primary_target_slot: a.primary_target_slot, claimed_table_alignment: a.claimed_table_alignment, claimed_risk_level: a.claimed_risk_level, why_this_now: a.why_this_now, model_schema_versions: a.model_prompt_schema_versions, fallback_action_id: a.fallback_action_id });
  }
  if (ctx.gateResult) {
    const g = ctx.gateResult;
    events.push({ ...base, phase: 'GateResult', decision: g.decision, approved_action_id: g.approved_action_id, adjudicated_risk_level: g.adjudicated_risk_level, adjudicated_table_alignment: g.adjudicated_table_alignment, evaluator_required: g.evaluator_required, reason_codes: g.reason_codes });
  }
  return events;
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
  applyStopRules,
  setSemanticMode,
  getSemanticMode,
  buildReplay
};
