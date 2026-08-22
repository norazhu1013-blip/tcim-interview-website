'use strict';

/**
 * RAG V0.1 —— 按需知识支持模块（04-1 RAG总体架构）。
 *
 * 定位：RAG 是「强而克制」的知识支持系统。它不替代五张专业表，不改 Evidence State，
 * 不定义 Slot，不决定最终行动。只在 Orchestrator 判定 knowledge_need=true 时被调用。
 *
 * 检索级别（04-1 第10节）：
 *   R0 No Retrieval（默认）—— Orchestrator knowledge_need=false 时不调用
 *   R1 Cache / Knowledge Capsule
 *   R2 Standard Retrieval（metadata filter + semantic retrieval + rerank）
 *   R3 Agentic Retrieval（例外，V0.1 不实现）
 *
 * 权限门（04-1）：
 *   DIAGNOSE_INTERNAL 默认不得向教师展示；REFLECT 可条件展示中性材料；SUPPORT 可提供解释/案例/来源。
 *
 * V0.1 实现：结构化知识包（来自 ontology/evidence_anchors 的聚合），
 *   R1 走预计算 capsule；R2 走简单的关键词检索（不依赖外部向量库）。
 *   RAGResult 只能作为 support evidence/constraint，不得包含 EvidenceStateMutation。
 */

const VERSION = '2026-08-21-rag-v0.1';
const PHASES = ['DIAGNOSE_INTERNAL', 'REFLECT', 'SUPPORT'];

// 预计算 Knowledge Capsule：题目级聚合（V0.1 从题目数据静态构建，可后续替换为独立语料）
function buildCapsules(itemPackages) {
  const capsules = {};
  for (const [qid, item] of Object.entries(itemPackages || {})) {
    const notes = [];
    for (const slot of (item.ontology && item.ontology.slots) || []) {
      notes.push(`${slot.slot_id} ${slot.name}：${slot.definition}`);
    }
    for (const a of (item.anchors && item.anchors.anchors) || []) {
      notes.push(`${a.slot_id} 高质量证据：${a.level_3}`);
    }
    capsules[qid] = notes;
  }
  return capsules;
}

let _capsules = {};

function setKnowledge(items) {
  _capsules = buildCapsules(items);
}

/**
 * 简单关键词检索（R2 降级实现）：返回匹配的知识条目 + 来源。
 * @param {string} query 查询意图（如 "场地风险 判断"）
 * @param {string} questionId 题目
 * @returns {{ refs: [{source, text}], route: 'R1'|'R2' }}
 */
function retrieve(query, questionId) {
  const notes = _capsules[questionId] || [];
  if (!notes.length) return { refs: [], route: 'R0' };
  const terms = String(query || '').split(/[\s,，、]+/).filter((t) => t.length >= 2);
  if (!terms.length) return { refs: notes.slice(0, 2).map((text, i) => ({ source: `${questionId}-capsule-${i}`, text })), route: 'R1' };
  const scored = notes.map((text, i) => {
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += 1;
    return { text, i, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const refs = scored.slice(0, 3).map((x) => ({ source: `${questionId}-capsule-${x.i}`, text: x.text }));
  return { refs, route: refs.length ? 'R2' : 'R0' };
}

/** 权限门：按对话阶段决定知识是否可 teacher-facing。 */
function permissionFor(phase, refs) {
  const ph = String(phase || '').toUpperCase();
  if (ph === 'DIAGNOSE_INTERNAL') return { teacher_facing: false, refs };
  if (ph === 'REFLECT') return { teacher_facing: true, refs: refs.slice(0, 1) };
  return { teacher_facing: true, refs };
}

/**
 * RAG 主入口：仅当 knowledge_need=true 调用。
 * @param {object} input ModuleInput（含 question_id, turn_context）
 * @param {object} ctx { knowledgeNeed, phase, query }
 * @returns ModuleResult（RAG owner 只写 rag_runtime_state；无 Evidence 写权限）
 */
function process(input, ctx) {
  const qid = input.question_id;
  const opts = (ctx && ctx.opts) || {};
  const knowledgeNeed = !!opts.knowledgeNeed;
  const phase = PHASES.includes(opts.phase) ? opts.phase : 'DIAGNOSE_INTERNAL';

  if (!knowledgeNeed) {
    return {
      module_id: 'rag', module_version: VERSION,
      observations: ['R0 no retrieval'],
      state_updates: { rag_runtime_state: { last_route: 'R0', last_query: null } },
      action_proposals: [], constraints: [], confidence: 0.5,
      evidence_refs: [], decision_summary: 'rag: R0 (not needed)',
      diagnostics: []
    };
  }

  const { refs, route } = retrieve(opts.query || '', qid);
  const gated = permissionFor(phase, refs);
  return {
    module_id: 'rag', module_version: VERSION,
    observations: [`RAG route=${route}, phase=${phase}, teacher_facing=${gated.teacher_facing}`],
    state_updates: { rag_runtime_state: { last_route: route, last_phase: phase, last_query: opts.query || '' } },
    // RAG 只提供 constraint（知识权限约束），不产生专业行动
    action_proposals: [],
    constraints: gated.teacher_facing ? [] : [{ type: 'knowledge_internal', note: 'diagnose 阶段知识不可教师可见' }],
    confidence: 0.5,
    evidence_refs: gated.refs.map((r) => r.source),
    decision_summary: `rag: route=${route}, phase=${phase}, teacher_facing=${gated.teacher_facing}, refs=${gated.refs.length}`,
    diagnostics: gated.refs.map((r) => r.text)
  };
}

module.exports = { id: 'rag', version: VERSION, ownerNamespace: 'rag_runtime_state', setKnowledge, retrieve, permissionFor, process, VERSION };
