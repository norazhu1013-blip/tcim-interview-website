'use strict';

/**
 * TCIM TurnContext Builder（01-1 第12节第2步）。
 *
 * 整合测评、题目、历史、当前回答，生成模块标准输入 ModuleInput。
 * TurnContext Builder 只组装输入，不做任何专业判断。
 */

let _turnCounter = 0;

function nextTurnId(sessionId) {
  _turnCounter += 1;
  const ts = Date.now().toString(36);
  return `t_${sessionId.slice(0, 8)}_${ts}_${_turnCounter}`;
}

/**
 * @param {object} opts
 *   session_id, question_id, teacher_turn（本轮原始回答）, teacher_ranking（前测排序）,
 *   evidence_state（快照）, item_package（ontology 数据包）, module_configs
 * @returns ModuleInput
 */
function buildTurnContext(opts) {
  const {
    session_id,
    question_id,
    teacher_turn,
    teacher_ranking = [],
    evidence_state = {},
    item_package = null,
    module_configs = {}
  } = opts || {};

  const turnContext = {
    teacher_turn: String(teacher_turn || '').trim(),
    teacher_ranking: teacher_ranking || [],
    question_id,
    item_package,          // Ontology 专业数据包（读取用，模块不可改写）
    timing: { received_at: Date.now() }
  };

  return {
    session_id,
    turn_id: nextTurnId(session_id),
    question_id,
    turn_context: turnContext,
    shared_state_snapshot: {
      ontology_state: { evidence_state },
      session_state: { status: 'interviewing', question_id }
    },
    module_config: module_configs
  };
}

module.exports = { buildTurnContext, nextTurnId };
