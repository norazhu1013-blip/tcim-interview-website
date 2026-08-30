'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompts, frontstageResponseStyle } = require('../src/prompts');
const { compiledCard } = require('./fixtures');

test('ordinary follow-up defaults to natural continuation rather than visible restatement', () => {
  const prompts = buildPrompts({
    phase: 'next',
    compiled_card: compiledCard(),
    teacher_turn: '我会先看看孩子是不是还想继续尝试。',
    history: [{ role: 'assistant', text: '什么情况下您会决定靠近？' }]
  });
  assert.match(prompts.system, /默认直接、自然地接着/);
  assert.match(prompts.system, /不采用每轮“先复述\/核实—再提问”的固定格式/);
  assert.match(prompts.user, /"mode":"NATURAL_CONTINUE"/);
  assert.match(prompts.user, /内部理解写成每轮固定的复述核实/);
});

test('explicit teacher correction allows a brief repair without making repair the default', () => {
  const style = frontstageResponseStyle('不是，我的意思是先等一等再决定。', []);
  assert.equal(style.mode, 'REPAIR_IF_NEEDED');
  assert.equal(style.internal_quote_is_not_visible_script, true);
});

test('recent formulaic restatement is exposed as a variation warning to the model', () => {
  const style = frontstageResponseStyle('我还会看看其他孩子的反应。', [
    { role: 'assistant', text: '我理解您会先观察。那您会观察什么？' }
  ]);
  assert.equal(style.mode, 'NATURAL_CONTINUE');
  assert.equal(style.recent_formulaic_restatement_count, 1);
  assert.equal(style.avoid_repeating_restatement_style, true);
  assert.ok(style.avoid_formulaic_openings.includes('您说'));
});

test('integrative mode asks one final scenario-grounded synthesis question', () => {
  const longHistory = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' : 'teacher',
    text: `第${index + 1}轮${index % 2 === 0 ? '问题？' : '回答'}`
  }));
  const prompts = buildPrompts({
    phase: 'next',
    session_id: 's1',
    item_id: 'Q1',
    teacher_turn: '我会看孩子是否还愿意继续尝试，再决定要不要过去。',
    compiled_card: compiledCard(),
    history: longHistory,
    runtime_limits: { question_mode: 'INTEGRATIVE_SYNTHESIS' }
  });
  assert.equal(prompts.questionMode, 'INTEGRATIVE_SYNTHESIS');
  assert.match(prompts.user, /最后一个新问题/);
  assert.match(prompts.user, /不先展示总结/);
  assert.match(prompts.system, /最能区分能力表现/);
  assert.equal(prompts.history.length, 14);
  assert.equal(prompts.history[0].text, '第3轮问题？');
  assert.match(prompts.user, /整体判断、条件权衡、边界意识或调整依据/);
});
