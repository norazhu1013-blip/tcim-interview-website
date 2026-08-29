'use strict';

const ACTIONS = ['ASK', 'CLOSE'];
const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'];
const HYPOTHESIS_STATUS = ['ACTIVE', 'SUPPORTED', 'WEAKENED', 'REJECTED', 'UNKNOWN'];
const RESPONSE_ORIGINS = ['RO0', 'RO1', 'RO2', 'RO3', 'RO4'];
const EVIDENCE_RELATIONS = ['SUPPORT', 'CONTRADICT', 'REVISE'];
const EVIDENCE_STATUSES = ['NOT_DEMONSTRATED', 'PARTIAL', 'SUFFICIENT', 'HIGH_QUALITY'];
const BOUNDARY_KINDS = ['NONE', 'SAFETY', 'PRIVACY', 'EXIT'];

const DIALOGUE_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTIONS },
    visible_text: { type: 'string' },
    direction: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string' },
        open_thread_id: { type: 'string' },
        rationale: { type: 'string' },
        consulted_policy_ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['label', 'open_thread_id', 'rationale', 'consulted_policy_ids']
    },
    evidence_candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidence_claim_id: { type: 'string' },
          understanding_id: { type: 'string' },
          relation: { type: 'string', enum: EVIDENCE_RELATIONS },
          proposed_status: { type: 'string', enum: EVIDENCE_STATUSES },
          response_origin: { type: 'string', enum: RESPONSE_ORIGINS },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          spans: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' }
        },
        required: ['evidence_claim_id', 'understanding_id', 'relation', 'proposed_status', 'response_origin', 'confidence', 'spans', 'rationale']
      }
    },
    completion_recommendation: {
      type: 'object',
      additionalProperties: false,
      properties: { recommended: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['recommended', 'reason']
    },
    boundary: {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', enum: BOUNDARY_KINDS }, policy_id: { type: 'string' } },
      required: ['kind', 'policy_id']
    },
    understanding: {
      type: 'object',
      additionalProperties: false,
      properties: {
        teacher_quote: { type: 'string' },
        meaning: { type: 'string' },
        confidence: { type: 'string', enum: CONFIDENCE }
      },
      required: ['teacher_quote', 'meaning', 'confidence']
    },
    working_hypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hypothesis_id: { type: 'string' }, statement: { type: 'string' },
          status: { type: 'string', enum: HYPOTHESIS_STATUS }, confidence: { type: 'number', minimum: 0, maximum: 1 },
          source_refs: { type: 'array', items: { type: 'string' } }
        },
        required: ['hypothesis_id', 'statement', 'status', 'confidence', 'source_refs']
      }
    }
  },
  required: ['action', 'visible_text', 'direction', 'evidence_candidates', 'completion_recommendation', 'boundary', 'understanding', 'working_hypotheses']
});

const ROOT_KEYS = new Set(DIALOGUE_RESPONSE_SCHEMA.required);
const DIRECTION_KEYS = new Set(['label', 'open_thread_id', 'rationale', 'consulted_policy_ids']);
const EVIDENCE_KEYS = new Set(['evidence_claim_id', 'understanding_id', 'relation', 'proposed_status', 'response_origin', 'confidence', 'spans', 'rationale']);
const COMPLETION_KEYS = new Set(['recommended', 'reason']);
const BOUNDARY_KEYS = new Set(['kind', 'policy_id']);
const UNDERSTANDING_KEYS = new Set(['teacher_quote', 'meaning', 'confidence']);
const HYPOTHESIS_KEYS = new Set(['hypothesis_id', 'statement', 'status', 'confidence', 'source_refs']);
const VISIBLE_LEAK_RE = /得分|分数|标准答案|专家排序|能力等级|题目入选原因|R\s*\/\s*P\s*\/\s*G|P-?IVI|\b(?:ECL|UND)-/i;

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function exactKeys(value, allowed, path, errors) {
  if (!isPlainObject(value)) { errors.push(`${path} must be an object`); return false; }
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
  return true;
}

function collectEvidencePolicyIndex(compiledCard) {
  const index = new Map();
  for (const policy of Array.isArray(compiledCard && compiledCard.evidencePolicies) ? compiledCard.evidencePolicies : []) {
    if (policy && (policy.claimType === 'ORIGIN_POLICY' || policy.runtimeUse === 'ORIGIN_POLICY')) continue;
    if (policy && policy.claimType && policy.claimType !== 'CAPABILITY_EVIDENCE') continue;
    const claimId = String(policy && policy.evidenceClaimId || '').trim();
    const understandingId = String(policy && policy.understandingId || '').trim();
    if (!claimId || !understandingId) continue;
    index.set(claimId, {
      understandingId,
      allowedResponseOrigins: Array.isArray(policy.allowedResponseOrigins) ? policy.allowedResponseOrigins.filter((origin) => RESPONSE_ORIGINS.includes(origin)) : []
    });
  }
  return index;
}

function collectDialoguePolicyIndex(compiledCard) {
  const all = new Set();
  const hard = new Set();
  for (const policy of Array.isArray(compiledCard && compiledCard.dialoguePolicies) ? compiledCard.dialoguePolicies : []) {
    const id = String(policy && policy.policyId || '').trim();
    if (!id) continue;
    all.add(id);
    if (policy.type === 'HARD_BOUNDARY') hard.add(id);
  }
  return { all, hard };
}

function validateDialogueOutput(value, context = {}) {
  const errors = [];
  if (!exactKeys(value, ROOT_KEYS, 'output', errors)) return { ok: false, errors };
  const policyIndex = collectDialoguePolicyIndex(context.compiledCard);
  if (!ACTIONS.includes(value.action)) errors.push('output.action must be ASK or CLOSE');
  if (typeof value.visible_text !== 'string') errors.push('output.visible_text must be a string');

  if (exactKeys(value.direction, DIRECTION_KEYS, 'output.direction', errors)) {
    if (typeof value.direction.label !== 'string' || !value.direction.label.trim()) errors.push('output.direction.label must be non-empty');
    if (typeof value.direction.open_thread_id !== 'string') errors.push('output.direction.open_thread_id must be a string');
    if (typeof value.direction.rationale !== 'string') errors.push('output.direction.rationale must be a string');
    if (!Array.isArray(value.direction.consulted_policy_ids) || value.direction.consulted_policy_ids.some((id) => typeof id !== 'string')) errors.push('output.direction.consulted_policy_ids must be a string array');
    else for (const id of value.direction.consulted_policy_ids) if (!policyIndex.all.has(id)) errors.push(`output.direction.consulted_policy_ids contains unknown policy: ${id}`);
  }

  if (!Array.isArray(value.evidence_candidates)) errors.push('output.evidence_candidates must be an array');
  else {
    const evidencePolicyIndex = collectEvidencePolicyIndex(context.compiledCard);
    value.evidence_candidates.forEach((candidate, index) => {
      const path = `output.evidence_candidates[${index}]`;
      if (!exactKeys(candidate, EVIDENCE_KEYS, path, errors)) return;
      const claimId = String(candidate.evidence_claim_id || '').trim();
      const understandingId = String(candidate.understanding_id || '').trim();
      const evidencePolicy = evidencePolicyIndex.get(claimId);
      if (!claimId) errors.push(`${path}.evidence_claim_id must be non-empty`);
      else if (!evidencePolicy) errors.push(`${path}.evidence_claim_id is not present in compiled_card.evidencePolicies`);
      if (!understandingId) errors.push(`${path}.understanding_id must be non-empty`);
      else if (evidencePolicy && evidencePolicy.understandingId !== understandingId) errors.push(`${path}.understanding_id does not match its evidence policy`);
      if (!EVIDENCE_RELATIONS.includes(candidate.relation)) errors.push(`${path}.relation is invalid`);
      if (!EVIDENCE_STATUSES.includes(candidate.proposed_status)) errors.push(`${path}.proposed_status is invalid`);
      if (!RESPONSE_ORIGINS.includes(candidate.response_origin)) errors.push(`${path}.response_origin must be RO0 through RO4`);
      else if (evidencePolicy && evidencePolicy.allowedResponseOrigins.length && !evidencePolicy.allowedResponseOrigins.includes(candidate.response_origin)) errors.push(`${path}.response_origin is not allowed by its evidence policy`);
      if (typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1) errors.push(`${path}.confidence must be from 0 to 1`);
      if (!Array.isArray(candidate.spans) || !candidate.spans.length) errors.push(`${path}.spans must contain at least one exact quote`);
      for (const span of Array.isArray(candidate.spans) ? candidate.spans : []) if (typeof span !== 'string' || !span || !String(context.teacherTurn || '').includes(span)) errors.push(`${path}.spans must quote the current teacher turn exactly`);
      if (typeof candidate.rationale !== 'string') errors.push(`${path}.rationale must be a string`);
    });
  }

  if (exactKeys(value.completion_recommendation, COMPLETION_KEYS, 'output.completion_recommendation', errors)) {
    if (typeof value.completion_recommendation.recommended !== 'boolean') errors.push('output.completion_recommendation.recommended must be a boolean');
    if (typeof value.completion_recommendation.reason !== 'string') errors.push('output.completion_recommendation.reason must be a string');
  }
  if (exactKeys(value.boundary, BOUNDARY_KEYS, 'output.boundary', errors)) {
    if (!BOUNDARY_KINDS.includes(value.boundary.kind)) errors.push('output.boundary.kind is invalid');
    if (typeof value.boundary.policy_id !== 'string') errors.push('output.boundary.policy_id must be a string');
    if (value.boundary.kind === 'NONE' && value.boundary.policy_id) errors.push('output.boundary.policy_id must be empty when kind=NONE');
    if (value.boundary.kind !== 'NONE' && !policyIndex.hard.has(value.boundary.policy_id)) errors.push('output.boundary.policy_id must identify a HARD_BOUNDARY policy');
    if (value.boundary.kind === 'EXIT' && value.action !== 'CLOSE') errors.push('output.action must be CLOSE when boundary.kind=EXIT');
  }
  if (exactKeys(value.understanding, UNDERSTANDING_KEYS, 'output.understanding', errors)) {
    if (typeof value.understanding.teacher_quote !== 'string') errors.push('output.understanding.teacher_quote must be a string');
    if (typeof value.understanding.meaning !== 'string') errors.push('output.understanding.meaning must be a string');
    if (!CONFIDENCE.includes(value.understanding.confidence)) errors.push('output.understanding.confidence is invalid');
  }
  if (!Array.isArray(value.working_hypotheses)) errors.push('output.working_hypotheses must be an array');
  else value.working_hypotheses.forEach((hypothesis, index) => {
    const path = `output.working_hypotheses[${index}]`;
    if (!exactKeys(hypothesis, HYPOTHESIS_KEYS, path, errors)) return;
    if (typeof hypothesis.hypothesis_id !== 'string' || !hypothesis.hypothesis_id.trim()) errors.push(`${path}.hypothesis_id must be non-empty`);
    if (typeof hypothesis.statement !== 'string' || !hypothesis.statement.trim()) errors.push(`${path}.statement must be non-empty`);
    if (!HYPOTHESIS_STATUS.includes(hypothesis.status)) errors.push(`${path}.status is invalid`);
    if (typeof hypothesis.confidence !== 'number' || hypothesis.confidence < 0 || hypothesis.confidence > 1) errors.push(`${path}.confidence must be from 0 to 1`);
    if (!Array.isArray(hypothesis.source_refs) || hypothesis.source_refs.some((ref) => typeof ref !== 'string')) errors.push(`${path}.source_refs must be a string array`);
  });

  const teacherTurn = String(context.teacherTurn || '');
  const quote = value.understanding && String(value.understanding.teacher_quote || '');
  if (context.phase === 'first' && quote) errors.push('output.understanding.teacher_quote must be empty on the first turn');
  if (context.phase === 'next' && quote && !teacherTurn.includes(quote)) errors.push('output.understanding.teacher_quote must quote the current teacher turn exactly');
  if (context.phase === 'first' && value.evidence_candidates && value.evidence_candidates.length) errors.push('output.evidence_candidates must be empty on the first turn');

  const visibleText = String(value.visible_text || '').trim();
  if (!visibleText) errors.push('output.visible_text must be non-empty');
  if (value.action === 'ASK' && (visibleText.match(/[?？]/g) || []).length !== 1) errors.push('output.visible_text must contain exactly one question mark when action=ASK');
  if (value.action === 'CLOSE' && /[?？]/.test(visibleText)) errors.push('output.visible_text must not ask a question when action=CLOSE');
  if (visibleText.length > (context.maxQuestionChars || 140)) errors.push('output.visible_text is too long');
  if (VISIBLE_LEAK_RE.test(visibleText)) errors.push('teacher-visible text exposes protected internal information');
  return { ok: errors.length === 0, errors };
}

module.exports = { DIALOGUE_RESPONSE_SCHEMA, validateDialogueOutput, collectEvidencePolicyIndex, collectDialoguePolicyIndex, RESPONSE_ORIGINS, EVIDENCE_RELATIONS, EVIDENCE_STATUSES };
