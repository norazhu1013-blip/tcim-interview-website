'use strict';

/**
 * TCIM SharedState —— 命名空间所有权与只读快照（01-1 第11节、01-2 第5节）。
 *
 * 每个 namespace 只有一个 owner，其他模块只能读取、只能提 proposal/constraint。
 * 跨模块影响只能以 observation / action_proposal / constraint / signal 提交给 Core。
 */

const { STATE_OWNERS } = require('./contracts.js');

function createEmptyState() {
  return {
    session_state: { status: 'created', question_id: null, turn_id: 0 },
    ontology_state: { evidence_state: {} },
    contextual_belief_state: { beliefs: {}, version: 0 }, // V0.2：Belief State（可撤销情境假设）
    dialogue_state: {},
    rag_runtime_state: {},
    teacher_state: {},
    evaluation_state: {}
  };
}

/**
 * 取某 namespace 的只读快照。
 * @param {object} shared 共享状态
 * @param {string} namespace 例如 'ontology_state'
 */
function snapshotOf(shared, namespace) {
  const value = shared && shared[namespace];
  if (!value) return {};
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * 校验某模块是否有权写某 namespace。只允许写自己的 namespace。
 */
function assertOwner(moduleOwner, namespace) {
  if (moduleOwner !== namespace) {
    throw new Error(`[SharedState] 模块 owner=${moduleOwner} 无权写 namespace=${namespace}（应为 ${STATE_OWNERS[namespace] || '未定义'}）`);
  }
}

/**
 * 模块提交 state_updates：{ namespace: patch }。Core 逐条校验 owner。
 * 只允许顶层字段更新；禁止整体替换其他 namespace。
 */
function applyStateUpdates(shared, moduleOwner, stateUpdates) {
  if (!stateUpdates) return shared;
  for (const [namespace, patch] of Object.entries(stateUpdates)) {
    assertOwner(moduleOwner, namespace);
    if (!shared[namespace]) shared[namespace] = {};
    if (patch && typeof patch === 'object') {
      Object.assign(shared[namespace], patch);
    }
  }
  return shared;
}

/** 整份共享状态的只读快照（供 Replay/日志）。 */
function fullSnapshot(shared) {
  return snapshotOf(shared, 'session_state') === {} ? {} : JSON.parse(JSON.stringify(shared));
}

module.exports = {
  STATE_OWNERS,
  createEmptyState,
  snapshotOf,
  assertOwner,
  applyStateUpdates,
  fullSnapshot
};
