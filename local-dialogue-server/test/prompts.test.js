'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompts } = require('../src/prompts');
const { compiledCard } = require('./fixtures');

test('static card is in the system prefix while dynamic dialogue stays in user input', () => {
  const card = compiledCard();
  card.datasetId = 'five-tables-v2';
  card.configFingerprint = 'dataset-config-v7';
  const prompts = buildPrompts({
    phase: 'next', item_id: 'Q1', session_id: 'private-session', compiled_card: card,
    teacher_turn: '这是当前原话', history: [
      { role: 'assistant', text: '您最先注意到什么？' },
      { role: 'teacher', text: '历史回答' }
    ], evidence_summary: { current: [] },
    dialogue_progress_state: {
      schemaVersion: 'dialogue-agent.progress-state/v1', itemId: 'Q1', version: 3, phase: 'DEEPENING',
      questionLedger: [{ action: 'ASK', questionText: '哪一个现场线索支持您的判断？', goalLabel: '澄清现场线索', rationale: '不应重复发送', answerExcerpt: '不应重复发送' }],
      openThreads: [{ openThreadId: 'risk-thread', status: 'ACTIVE', statement: '安全与游戏延续', rationale: '不应重复发送' }],
      coveredCues: [{ span: '地面是否湿滑', sourceTurnId: 'turn-1', formalEvidenceIds: ['不应重复发送'] }],
      stagnation: { score: 2, consecutiveSimilarGoals: 2, repeatedQuestionCount: 1, lastQuestionSemanticKey: '不应重复发送' }
    }
  });
  assert.match(prompts.system, /dataset-config-v7/);
  assert.doesNotMatch(prompts.user, /professionalLenses/);
  assert.match(prompts.user, /这是当前原话/);
  assert.match(prompts.user, /recent_assistant_questions/);
  assert.match(prompts.user, /您最先注意到什么/);
  assert.match(prompts.user, /questionLedger/);
  assert.match(prompts.user, /risk-thread/);
  assert.match(prompts.user, /地面是否湿滑/);
  assert.match(prompts.user, /consecutiveSimilarGoals/);
  assert.doesNotMatch(prompts.user, /private-session|不应重复发送/);
  assert.match(prompts.system, /不得复问同一问句/);
  assert.match(prompts.system, /stagnation\.score/);
  assert.match(prompts.promptCacheKey, /^tcim-dialogue:[a-f0-9]{48}$/);
  assert.ok(prompts.promptCacheKey.length <= 64);
  assert.doesNotMatch(prompts.promptCacheKey, /private-session/);
  assert.equal(prompts.promptCacheKey, buildPrompts({ phase: 'first', item_id: 'Q1', compiled_card: card }).promptCacheKey);
});
