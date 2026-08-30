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
  assert.equal(style.relational_move, 'REPAIR');
  assert.equal(style.internal_quote_is_not_visible_script, true);
});

test('a substantive tension invites one brief relational microcue', () => {
  const style = frontstageResponseStyle('不能伤害幼儿游戏的兴趣，但是教育也要有秩序。', []);
  assert.equal(style.relational_move, 'VALIDATE_COMPLEXITY');
  assert.equal(style.relational_cue_budget, 1);
  assert.match(style.relational_guidance, /取舍不容易/);
});

test('relational microcues have a cooldown and do not become a new template', () => {
  const style = frontstageResponseStyle('我再看看。', [
    { role: 'assistant', text: '这个场面确实不好拿捏。那一刻您会先做什么？' }
  ]);
  assert.equal(style.recent_relational_cue_count, 1);
  assert.equal(style.relational_move, 'NONE');
  assert.equal(style.relational_cue_budget, 0);
});

test('the first substantive answer schedules one specific affirmation rather than generic praise', () => {
  const style = frontstageResponseStyle('我会根据她平时的兴趣和能力，再决定是否继续提供材料。', [
    { role: 'assistant', text: '这个取舍确实不容易。您最先会看什么？' },
    { role: 'assistant', text: '什么变化会让您调整做法？' }
  ]);
  assert.equal(style.relational_move, 'AFFIRM_SPECIFICITY');
  assert.equal(style.relational_cue_budget, 1);
  assert.equal(style.warm_affirmation_required, true);
  assert.equal(style.warm_affirmation_count, 0);
  assert.equal(style.support_level, 'OPEN_FIRST');
});

test('controlled warmth is scheduled twice per scenario and then exhausted', () => {
  const questionLedger = [
    { action: 'ASK', questionText: '您在现场会先做什么？' },
    { action: 'ASK', questionText: '这个观察说得很细致。您当时最先留意什么？' },
    { action: 'ASK', questionText: '您平时通常会怎样继续观察？' },
    { action: 'ASK', questionText: '从您的经验看，哪些表现最值得留意？' }
  ];
  const second = frontstageResponseStyle(
    '我会根据孩子后面的表现，再调整支持的程度。',
    [],
    { questionLedger }
  );
  assert.equal(second.warm_affirmation_count, 1);
  assert.equal(second.warm_affirmation_required, true);
  assert.equal(second.warm_affirmations_remaining, 1);

  questionLedger.push({ action: 'ASK', questionText: '这个区别很有分辨。回到当时，您还注意到了什么？' });
  const exhausted = frontstageResponseStyle(
    '我会根据孩子后面的表现，再调整支持的程度。',
    [],
    { questionLedger }
  );
  assert.equal(exhausted.warm_affirmation_count, 2);
  assert.equal(exhausted.warm_affirmation_required, false);
  assert.equal(exhausted.warm_affirmations_remaining, 0);
});

test('a challenge question forces a lower-pressure relief turn and challenges are capped', () => {
  const afterChallenge = frontstageResponseStyle(
    '我会先看看孩子当时的表情和动作，再决定怎么做。',
    [],
    { questionLedger: [
      { action: 'ASK', questionText: '如果孩子还是一直拒绝，您会怎么做？' }
    ] }
  );
  assert.equal(afterChallenge.pressure_pacing.last_question_pressure, 'CHALLENGE');
  assert.equal(afterChallenge.pressure_pacing.must_relax, true);
  assert.equal(afterChallenge.pressure_pacing.next_move, 'RELAX');

  const capped = frontstageResponseStyle(
    '我还会结合平时经验继续观察。',
    [],
    { questionLedger: [
      { action: 'ASK', questionText: '如果孩子还是一直拒绝，您会怎么做？' },
      { action: 'ASK', questionText: '回到当时，您最先看到什么？' },
      { action: 'ASK', questionText: '什么情况下您会改变刚才的判断？' },
      { action: 'ASK', questionText: '从您的经验看，您还会留意什么？' }
    ] }
  );
  assert.equal(capped.pressure_pacing.challenge_question_count, 2);
  assert.equal(capped.pressure_pacing.must_relax, true);
});

test('an explicit clarification request unlocks examples while an ordinary answer stays open-first', () => {
  assert.equal(frontstageResponseStyle('我不清楚你具体问什么，可以解释一下吗？', []).support_level, 'SCAFFOLD_ALLOWED');
  assert.equal(frontstageResponseStyle('我还想继续观察。', []).support_level, 'OPEN_FIRST');
});

test('repeated short answers or clear stagnation may unlock a small scaffold without upgrading its evidence', () => {
  const short = frontstageResponseStyle('不知道。', [{ role: 'teacher', text: '没想过。' }]);
  assert.equal(short.support_level, 'SCAFFOLD_ALLOWED');
  assert.equal(short.scaffold_reason, 'REPEATED_SHORT_ANSWERS');
  const stalled = frontstageResponseStyle('我会再看看。', [], { stagnation: { score: 2 } });
  assert.equal(stalled.support_level, 'SCAFFOLD_ALLOWED');
  assert.equal(stalled.scaffold_reason, 'DIALOGUE_STAGNATION');
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
