'use strict';

function validOutput(overrides = {}) {
  return {
    action: 'ASK',
    visible_text: '您会先观察哪些具体表现？',
    direction: { label: '澄清观察依据', open_thread_id: 'open-observation', rationale: '继续了解教师判断', consulted_policy_ids: [] },
    evidence_candidates: [],
    completion_recommendation: { recommended: false, reason: '仍有可澄清内容' },
    boundary: { kind: 'NONE', policy_id: '' },
    understanding: { teacher_quote: '', meaning: '需要继续了解教师的判断依据', confidence: 'LOW' },
    working_hypotheses: [],
    ...overrides
  };
}

function compiledCard() {
  return {
    schema_version: 'tcim-five-tables-v0.1',
    item_id: 'Q1',
    scenarioBrief: { scenarioId: 'SC-Q1', text: '幼儿在户外生成了新的玩水方式。' },
    professionalLenses: [{ capabilityId: 'C02-Q01-PLAY-FRAME', name: '理解游戏框架' }],
    evidencePolicies: [{
      evidenceClaimId: 'ECL-Q01-PLAY-FRAME',
      understandingId: 'UND-Q01-001',
      claimType: 'CAPABILITY_EVIDENCE',
      runtimeUse: 'EVIDENCE_ANCHOR',
      allowedResponseOrigins: ['RO0', 'RO1', 'RO2'],
      minEvidenceLevel: 'L2'
    }],
    dialoguePolicies: [
      { policyId: 'DP-Q01-OPEN', type: 'AFFORDANCE', constraintLevel: 'ADVISORY' },
      { policyId: 'DP-Q01-HARD', type: 'HARD_BOUNDARY', constraintLevel: 'HARD' }
    ],
    synthesisPolicies: [],
    rankingPrior: null,
    processPrior: null
  };
}

function fullAnswers() {
  return Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return [`Q${number}`, {
      first_ranking: ['A', 'B', 'C', 'D'],
      first_ranking_source: 'teacher_choice',
      final_ranking: number % 2 ? ['A', 'B', 'C', 'D'] : ['D', 'C', 'B', 'A'],
      move_log: [],
      enter_ts: 1_700_000_000_000 + number * 60_000,
      submit_ts: 1_700_000_030_000 + number * 60_000,
      duration_ms: 30_000
    }];
  }));
}

module.exports = { validOutput, compiledCard, fullAnswers };
