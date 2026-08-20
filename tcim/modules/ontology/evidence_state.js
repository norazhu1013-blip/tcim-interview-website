'use strict';

/**
 * EvidenceState —— Evidence Slot 状态存储（02-1 第6节）。
 *
 * EvidenceSlotState { slot_id, status, level 0..3, confidence, supporting_spans[],
 *                     conflicting_spans[], false_evidence_flags[], uncertainty,
 *                     probe_status, probe_count, last_updated_turn, state_version }
 *
 * 只允许 Ontology owner 修改。前测作为 prior 初始化 uncertainty/优先级，
 * 不能直接把能力等级填进去。
 */

const STATE_VERSION = '2026-08-21-evidence-v1';

function createSlotState(slotId, opts = {}) {
  return {
    slot_id: slotId,
    status: opts.status || 'UNKNOWN',      // UNKNOWN|PARTIAL|SUFFICIENT|HIGH_QUALITY
    level: typeof opts.level === 'number' ? opts.level : 0, // 0..3
    confidence: opts.confidence ?? 0,       // 0..1
    supporting_spans: opts.supporting_spans ? opts.supporting_spans.slice() : [],
    conflicting_spans: opts.conflicting_spans ? opts.conflicting_spans.slice() : [],
    false_evidence_flags: opts.false_evidence_flags ? opts.false_evidence_flags.slice() : [],
    uncertainty: opts.uncertainty ?? 0,     // 前测先验不确定度 0..1
    probe_status: opts.probe_status || 'OPEN', // OPEN|PRUNED|REOPEN_CANDIDATE|SATURATED
    probe_count: opts.probe_count || 0,
    last_updated_turn: opts.last_updated_turn || null,
    state_version: STATE_VERSION
  };
}

function createEvidenceState(slotIds, prior = {}) {
  const state = {};
  for (const slotId of slotIds) {
    const p = prior[slotId] || {};
    state[slotId] = createSlotState(slotId, {
      uncertainty: p.uncertainty ?? 0,
      probe_status: p.probe_status,
      level: 0,
      status: 'UNKNOWN'
    });
  }
  return state;
}

function statusFromLevel(level) {
  if (level <= 0) return 'UNKNOWN';
  if (level === 1) return 'PARTIAL';
  if (level === 2) return 'SUFFICIENT';
  return 'HIGH_QUALITY';
}

/** 更新一个 slot：支持 升级 / 不变 / 降置信 / 冲突增加 四种情况。 */
function updateSlot(state, slotId, patch) {
  const current = state[slotId];
  if (!current) return state;
  const next = Object.assign({}, current);
  if (typeof patch.level === 'number') {
    next.level = patch.level;
    next.status = statusFromLevel(patch.level);
  }
  if (typeof patch.confidence === 'number') next.confidence = patch.confidence;
  if (Array.isArray(patch.supporting_spans)) next.supporting_spans = patch.supporting_spans.slice();
  if (Array.isArray(patch.conflicting_spans)) next.conflicting_spans = patch.conflicting_spans.slice();
  if (Array.isArray(patch.false_evidence_flags)) next.false_evidence_flags = patch.false_evidence_flags.slice();
  if (patch.probe_status) next.probe_status = patch.probe_status;
  if (typeof patch.probe_count === 'number') next.probe_count = patch.probe_count;
  if (patch.last_updated_turn) next.last_updated_turn = patch.last_updated_turn;
  state[slotId] = next;
  return state;
}

module.exports = { createSlotState, createEvidenceState, updateSlot, statusFromLevel, STATE_VERSION };
