'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InputError, createDialogueAgent } = require('../src/dialogue-agent');
const { ProviderError } = require('../src/providers');
const { PROMPT_VERSION } = require('../src/prompts');
const { questionSimilarity } = require('../src/schema');
const { validOutput, compiledCard } = require('./fixtures');

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

test('follow-up understanding must include a non-empty exact quote from the current teacher turn', async () => {
  const provider = {
    id: 'mock', model: 'test', ready: true,
    generate: async () => ({ output: validOutput() })
  };
  await assert.rejects(
    createDialogueAgent({ provider }).run({
      phase: 'next', compiled_card: compiledCard(), teacher_turn: '我会先观察幼儿的反应。'
    }),
    (error) => error instanceof ProviderError && /non-empty exact quote/.test(error.message)
  );
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
  assert.match(correctionPrompt, /程序质检退回：近似复问/);
  assert.equal(result.visible_text, '如果幼儿转身去找同伴，您会怎样调整做法？');
  assert.equal(result.trace.generation_attempts, 2);
  assert.deepEqual(result.usage, { input_tokens: 22, output_tokens: 9, total_tokens: 31 });
});

test('duplicate correction is bounded to one regeneration attempt', async () => {
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
  assert.equal(calls, 2);
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
