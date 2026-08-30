'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InputError, createDialogueAgent } = require('../src/dialogue-agent');
const { ProviderError } = require('../src/providers');
const { PROMPT_VERSION } = require('../src/prompts');
const { questionSimilarity, formulaicRestatementPrefix, relationalMicrocuePrefix } = require('../src/schema');
const { validOutput, compiledCard } = require('./fixtures');

test('foreground question and background evidence use separate compact model calls', async () => {
  const calls = [];
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async (request) => {
      calls.push({ schemaName: request.schemaName, reasoningEffort: request.reasoningEffort, maxOutputTokens: request.maxOutputTokens });
      if (request.schemaName === 'tcim_evidence_analysis_v1') {
        return {
          output: {
            evidence_candidates: [{
              evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
              understanding_id: 'UND-Q01-001',
              relation: 'SUPPORT',
              proposed_status: 'PARTIAL',
              response_origin: 'RO1',
              confidence: 0.7,
              spans: ['我会先观察幼儿'],
              rationale: '教师自主提出观察'
            }]
          },
          provider: 'mock', model: 'test', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
        };
      }
      return { output: validOutput(), provider: 'mock', model: 'test' };
    }
  };
  const agent = createDialogueAgent({ provider });
  const foreground = await agent.run({ phase: 'first', compiled_card: compiledCard(), history: [], evidence_summary: {} });
  const background = await agent.analyzeEvidence({
    compiled_card: compiledCard(),
    teacher_turn: '我会先观察幼儿的表情和同伴反应。',
    history: [{ role: 'assistant', text: foreground.visible_text }],
    evidence_summary: {}
  });
  assert.equal(foreground.evidence_candidates.length, 0);
  assert.equal(background.evidence_candidates.length, 1);
  assert.deepEqual(calls.map((call) => call.schemaName), ['tcim_dialogue_fast_v3', 'tcim_evidence_analysis_v1']);
  assert.equal(calls[0].reasoningEffort, 'low');
  assert.equal(calls[0].maxOutputTokens, 500);
});

test('first turn accepts a valid strict provider result', async () => {
  const provider = { id: 'mock', model: 'test', ready: true, generate: async () => ({ output: validOutput(), provider: 'mock', model: 'test' }) };
  const result = await createDialogueAgent({ provider }).run({ phase: 'first', compiled_card: compiledCard(), history: [], evidence_summary: {} });
  assert.equal(result.ok, true);
  assert.equal(result.visible_text, validOutput().visible_text);
  assert.equal(result.next_question, validOutput().visible_text);
  assert.equal(result.action, 'ASK');
  assert.equal(result.trace.prompt_version, PROMPT_VERSION);
  assert.equal(result.provider, 'mock');
  assert.equal(typeof result.latency_ms, 'number');
});

test('follow-up evidence must quote the current teacher turn exactly', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先观察', meaning: '教师先观察', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-Q01-001',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['并不存在的原话'],
          rationale: '出现观察取向'
        }]
      })
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先观察幼儿的反应。' }),
    (error) => error instanceof ProviderError && error.code === 'invalid_provider_output'
  );
});

test('canonical evidence IDs must be a matching pair from evidencePolicies', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿的活动', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-NOT-IN-TABLE',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['我会先看幼儿'],
          rationale: '教师自主说明关注幼儿活动'
        }]
      })
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先看幼儿怎么继续玩。' }),
    (error) => error instanceof ProviderError && /understanding_id does not match/.test(error.message)
  );
});

test('valid canonical evidence proposal passes the unified validator', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({
      output: validOutput({
        understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿的活动', confidence: 'HIGH' },
        evidence_candidates: [{
          evidence_claim_id: 'ECL-Q01-PLAY-FRAME',
          understanding_id: 'UND-Q01-001',
          relation: 'SUPPORT',
          proposed_status: 'SUFFICIENT',
          response_origin: 'RO1',
          confidence: 0.8,
          spans: ['我会先看幼儿'],
          rationale: '教师自主说明关注幼儿活动'
        }]
      })
    })
  };
  const result = await createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先看幼儿怎么继续玩。' });
  assert.equal(result.evidence_candidates[0].evidence_claim_id, 'ECL-Q01-PLAY-FRAME');
});

test('formulaic restatement prefix is removed without a second model call', async () => {
  let calls = 0;
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => {
      calls += 1;
      return { output: validOutput({
        visible_text: '您希望孩子理解规则的重要性和含义。您怎么判断他们是真的理解，而不只是当时照着做了？',
        understanding: { teacher_quote: '理解规则到底是什么', meaning: '教师关注规则理解', confidence: 'HIGH' }
      }) };
    }
  };
  const result = await createDialogueAgent({ provider }).run({
    phase: 'next', compiled_card: compiledCard(),
    teacher_turn: '明白规则的重要性，也理解规则到底是什么。'
  });
  assert.equal(calls, 1);
  assert.equal(result.visible_text, '您怎么判断他们是真的理解，而不只是当时照着做了？');
  assert.equal(result.trace.visible_style_adjusted, true);
  assert.equal(result.trace.style_adjustments[0].type, 'REMOVED_FORMULAIC_RESTATEMENT_PREFIX');
  assert.equal(result.trace.question_quality.formulaicRestatementOpening, false);
});

test('observed r1 restatement patterns are recognized while a direct question is preserved', () => {
  for (const text of [
    '您一下就看出是共同游戏规则没理解。当时哪些表现支持这个判断？',
    '明白，您从各玩各的看出问题了。接下来您会怎么做？',
    '您选择先讲解、再示范引导。您希望孩子具体学到什么？',
    '您希望孩子理解规则的重要性。您怎么判断他们是真的理解？',
    '您说要继续观察。接下来会重点看哪些表现？',
    '您会看他们是否围绕一个目标轮流下。如果他们自定玩法，您会怎样看？',
    '您觉得他们自定玩法就更高级了。这个判断来自哪些平时观察？'
  ]) assert.ok(formulaicRestatementPrefix(text), text);
  assert.equal(formulaicRestatementPrefix('您会看到什么变化，才决定从等待转为靠近？'), null);
});

test('follow-up audit quote is deterministically repaired from the current teacher turn', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput() })
  };
  const result = await createDialogueAgent({ provider }).run({
    phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先观察幼儿的反应。'
  });
  assert.equal(result.understanding.teacher_quote, '我会先观察幼儿的反应');
  assert.equal(result.trace.style_adjustments[0].type, 'REPAIRED_TEACHER_QUOTE');
  assert.equal(result.trace.question_quality.contingentOnTeacherTurn, true);
});

test('Chinese duplicate gate catches paraphrased generic moves but preserves different concrete anchors', () => {
  assert.ok(questionSimilarity(
    '如果这个关键条件发生变化，您的做法会怎么调整？',
    '什么新情况出现时，您会改变刚才的处理方向？'
  ) >= 0.78);
  assert.ok(questionSimilarity(
    '如果地面变得湿滑，您会怎么调整做法？',
    '如果同伴加入游戏，您会怎么调整做法？'
  ) < 0.78);
  assert.ok(questionSimilarity('为什么先介入？', '为什么先等待？') < 0.78);
  assert.ok(questionSimilarity('为什么把A放第一位？', '为什么把B放第一位？') < 0.78);
  assert.equal(
    relationalMicrocuePrefix('兴趣和秩序确实要同时顾及，这个度不好拿捏。在现场您会先做什么？'),
    '兴趣和秩序确实要同时顾及'
  );
  assert.equal(
    questionSimilarity('兴趣和秩序确实要同时顾及，这个度不好拿捏。在现场您会先做什么？', '在现场您会先做什么？'),
    1
  );
});

test('near-duplicate question is rejected once and automatically regenerated with a different substantive move', async () => {
  let calls = 0;
  let correctionPrompt = '';
  const teacherTurn = '我会先观察幼儿的表情和同伴反应。';
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async ({ user }) => {
      calls += 1;
      if (calls === 1) {
        return {
          output: validOutput({
            visible_text: '您刚才说孩子很投入，为什么会特别看重这一点？',
            understanding: { teacher_quote: '我会先观察', meaning: '教师会先观察', confidence: 'HIGH' }
          }),
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 }
        };
      }
      correctionPrompt = user;
      return {
        output: validOutput({
          visible_text: '如果幼儿转身去找同伴，您会怎样调整做法？',
          understanding: { teacher_quote: '我会先观察', meaning: '教师会先观察', confidence: 'HIGH' }
        }),
        usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 }
      };
    }
  };
  const result = await createDialogueAgent({ provider }).run({
    phase: 'next',
    compiled_card: compiledCard(),
    teacher_turn: teacherTurn,
    history: [{ role: 'assistant', text: '您刚才提到孩子很开心，您为什么会特别看重这个方面？' }]
  });
  assert.equal(calls, 2);
  assert.match(correctionPrompt, /程序质检退回：第1个候选未通过/);
  assert.equal(result.visible_text, '如果幼儿转身去找同伴，您会怎样调整做法？');
  assert.equal(result.trace.generation_attempts, 2);
  assert.deepEqual(result.usage, { input_tokens: 22, output_tokens: 9, total_tokens: 31 });
});

test('leading confirmation question is rejected and regenerated as an open evidence question', async () => {
  let calls = 0;
  const teacherTurn = '我先让他们自己商量，如果争执升级再靠近。';
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => {
      calls += 1;
      return { output: validOutput({
        visible_text: calls === 1
          ? '给孩子自主协商的空间是更好的做法，您也同意吗？'
          : '您会看到什么变化，才判断需要从等待转为靠近？',
        understanding: { teacher_quote: '如果争执升级再靠近', meaning: '教师会按情境变化调整介入', confidence: 'HIGH' }
      }) };
    }
  };
  const result = await createDialogueAgent({ provider }).run({
    phase: 'next',
    compiled_card: compiledCard(),
    teacher_turn: teacherTurn,
    history: [{ role: 'assistant', text: '当时您为什么选择先等待？' }]
  });
  assert.equal(calls, 2);
  assert.equal(result.visible_text, '您会看到什么变化，才判断需要从等待转为靠近？');
  assert.equal(result.trace.question_quality.nonLeading, true);
  assert.equal(result.trace.question_quality.passed, true);
});

test('duplicate correction is bounded to two regeneration attempts', async () => {
  let calls = 0;
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => {
      calls += 1;
      return { output: validOutput({
        visible_text: '您刚才说孩子很投入，为什么会特别看重这一点？',
        understanding: { teacher_quote: '我会先观察', meaning: '教师会先观察', confidence: 'HIGH' }
      }) };
    }
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({
      phase: 'next',
      compiled_card: compiledCard(),
      teacher_turn: '我会先观察幼儿的反应。',
      history: [{ role: 'assistant', text: '您刚才提到孩子很开心，您为什么会特别看重这个方面？' }]
    }),
    (error) => error instanceof ProviderError && error.code === 'invalid_provider_output' && /duplicate_question/.test(error.message)
  );
  assert.equal(calls, 3);
});

test('third candidate can recover a turn that would previously pause the interview', async () => {
  let calls = 0;
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => {
      calls += 1;
      return { output: validOutput({
        visible_text: calls < 3
          ? '您刚才说孩子很投入，为什么会特别看重这一点？'
          : '这个场面确实需要拿捏。您会看到什么变化，才决定从等待转为靠近？',
        understanding: { teacher_quote: '我会先观察', meaning: '教师会先观察', confidence: 'HIGH' }
      }) };
    }
  };
  const result = await createDialogueAgent({ provider }).run({
    phase: 'next',
    compiled_card: compiledCard(),
    teacher_turn: '我会先观察幼儿的表情和同伴反应。',
    history: [{ role: 'assistant', text: '您刚才提到孩子很开心，您为什么会特别看重这个方面？' }]
  });
  assert.equal(calls, 3);
  assert.equal(result.visible_text, '这个场面确实需要拿捏。您会看到什么变化，才决定从等待转为靠近？');
  assert.equal(result.trace.relationship_move_requested, 'ACKNOWLEDGE_PERSPECTIVE');
  assert.equal(result.trace.relational_microcue_observed, true);
  assert.equal(result.trace.question_quality.relationalCuePrefix, '这个场面确实需要拿捏');
});

test('built-in mock completes an end-to-end bounded dialogue without repeating accepted questions', async () => {
  const agent = createDialogueAgent({ env: {} });
  const history = [];
  const questions = [];
  let result = await agent.run({ phase: 'first', item_id: 'Q4', compiled_card: compiledCard(), history });
  assert.equal(result.action, 'ASK');
  questions.push(result.visible_text);
  history.push({ role: 'assistant', text: result.visible_text });

  for (let turn = 1; turn <= 4; turn += 1) {
    const teacherTurn = `第${turn}轮教师回答`;
    result = await agent.run({
      phase: 'next', item_id: 'Q4', compiled_card: compiledCard(),
      teacher_turn: teacherTurn, history
    });
    if (turn < 4) {
      assert.equal(result.action, 'ASK');
      questions.push(result.visible_text);
    } else {
      assert.equal(result.action, 'CLOSE');
    }
    history.push({ role: 'teacher', text: teacherTurn });
    history.push({ role: 'assistant', text: result.visible_text });
  }
  assert.equal(new Set(questions).size, 4);
});

test('ORIGIN_POLICY rows guide provenance but cannot become evidence candidates', async () => {
  const card = compiledCard();
  card.evidencePolicies.push({
    evidenceClaimId: 'ECL-ORIGIN-RO1', understandingId: 'UND-ORIGIN-RO1',
    claimType: 'ORIGIN_POLICY', runtimeUse: 'ORIGIN_POLICY', allowedResponseOrigins: ['RO1']
  });
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput({
      understanding: { teacher_quote: '我会先看幼儿', meaning: '教师先关注幼儿', confidence: 'HIGH' },
      evidence_candidates: [{
        evidence_claim_id: 'ECL-ORIGIN-RO1', understanding_id: 'UND-ORIGIN-RO1', relation: 'SUPPORT',
        proposed_status: 'SUFFICIENT', response_origin: 'RO1', confidence: 0.8,
        spans: ['我会先看幼儿'], rationale: '来源策略不能作为能力证据'
      }]
    }) })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'next', compiled_card: card, teacher_turn: '我会先看幼儿怎么继续玩。' }),
    (error) => error instanceof ProviderError && /not present in compiled_card\.evidencePolicies/.test(error.message)
  );
});

test('only HARD_BOUNDARY policies may gate a model result', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput({ boundary: { kind: 'SAFETY', policy_id: 'DP-Q01-OPEN' } }) })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({ phase: 'first', compiled_card: compiledCard() }),
    (error) => error instanceof ProviderError && /HARD_BOUNDARY/.test(error.message)
  );
});

test('provider work is aborted at the configured timeout', async () => {
  const provider = {
    id: 'mock', model: 'slow', ready: true,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  };
  await assert.rejects(
    createDialogueAgent({ provider, timeoutMs: 20 }).run({ phase: 'first', compiled_card: compiledCard() }),
    (error) => error instanceof ProviderError && error.code === 'provider_timeout' && error.status === 504
  );
});

test('provider work is aborted when the browser request is cancelled', async () => {
  const provider = {
    id: 'mock', model: 'slow', ready: true,
    generate: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  };
  const controller = new AbortController();
  const pending = createDialogueAgent({ provider, timeoutMs: 5000 }).run(
    { phase: 'first', compiled_card: compiledCard() },
    undefined,
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(
    pending,
    (error) => error instanceof ProviderError && error.code === 'client_aborted' && error.status === 499
  );
});

test('provider switching affects the next run while an in-flight run keeps its provider snapshot', async () => {
  let finishFirst;
  const firstProvider = {
    id: 'first-provider', model: 'first-model', ready: true,
    generate: () => new Promise((resolve) => { finishFirst = resolve; })
  };
  const nextProvider = {
    id: 'next-provider', model: 'next-model', ready: true,
    generate: async () => ({ output: validOutput(), provider: 'next-provider', model: 'next-model' })
  };
  const agent = createDialogueAgent({ provider: firstProvider });
  const pending = agent.run({ phase: 'first', compiled_card: compiledCard() });
  agent.setProvider(nextProvider);
  finishFirst({ output: validOutput() });

  const first = await pending;
  const next = await agent.run({ phase: 'first', compiled_card: compiledCard() });
  assert.equal(first.provider, 'first-provider');
  assert.equal(first.model, 'first-model');
  assert.equal(next.provider, 'next-provider');
  assert.equal(next.model, 'next-model');
  assert.equal(agent.provider, nextProvider);
});

test('a dialogue session provider/model lock rejects a silent cross-tab model switch', async () => {
  const provider = {
    id: 'openai', model: 'model-b', ready: true,
    generate: async () => ({ output: validOutput() })
  };
  const agent = createDialogueAgent({ provider });
  await assert.rejects(
    agent.run({
      phase: 'first', compiled_card: compiledCard(),
      expected_provider: 'kimi', expected_model: 'model-a'
    }),
    (error) => error instanceof InputError && error.code === 'provider_mismatch' && error.status === 409
  );
  await assert.rejects(
    agent.run({
      phase: 'first', compiled_card: compiledCard(),
      expected_provider: 'openai', expected_model: 'model-a'
    }),
    (error) => error instanceof InputError && error.code === 'model_mismatch' && error.status === 409
  );
  const matched = await agent.run({
    phase: 'first', compiled_card: compiledCard(),
    expected_provider: 'openai', expected_model: 'model-b'
  });
  assert.equal(matched.ok, true);
});
