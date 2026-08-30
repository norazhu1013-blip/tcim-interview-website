import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  AGENT_RESULT_SCHEMA,
  completeFinalTeacherTurn,
  createDialogueSession,
  createRuntimeCardFromRuntimeData,
  evidenceKey,
  normalizeQuestionId,
  retryDialogue,
  startDialogue,
  submitTeacherTurn,
  validateAgentResult,
  validateDialogueSessionForResume,
  validateHardBoundaries,
  validateRuntimeCard
} from './index.js'
import {
  INTEGRATIVE_QUESTION_TRIGGER_MS,
  WRAP_UP_RESERVE_MS,
  interviewTimePhase,
  mayStartForegroundGeneration,
  shouldRequestIntegrativeQuestion
} from '../interview-timing.js'
import { compactDialogueProgressState, compactRuntimeCard } from '../../services/dialogueAgent.js'
import { resolveLocalModelConfigBaseUrl } from '../../services/modelConfig.js'

const runtimeData = JSON.parse(readFileSync(
  new URL('../../generated/tcim-new-five-tables.runtime.v0.2.json', import.meta.url),
  'utf8'
))

const PLAY = Object.freeze({ evidenceClaimId: 'ECL-Q01-PLAY-FRAME', understandingId: 'UND-Q01-001' })
const RISK = Object.freeze({ evidenceClaimId: 'ECL-Q01-RISK', understandingId: 'UND-Q01-002' })

function runtimeCard(questionId = 'Q1') {
  return createRuntimeCardFromRuntimeData(runtimeData, {
    sessionId: 'session-1',
    questionId,
    runtimeCardId: 'card-Q01-v2',
    teacherContext: {
      finalRanking: ['A', 'C', 'B', 'D'],
      initialRanking: ['A', 'B', 'C', 'D'],
      processTags: ['首位摇摆']
    }
  })
}

let resultSeq = 0
function agentResult(overrides = {}) {
  resultSeq += 1
  return {
    schemaVersion: AGENT_RESULT_SCHEMA,
    resultId: `result-${resultSeq}`,
    action: 'ASK',
    visibleText: '在这个情境里，您最先想判断什么？',
    direction: {
      label: '先理解教师自己的判断起点',
      openThreadId: 'teacher-meaning-entry',
      rationale: '结合情境选择当前最有信息量的方向',
      consultedPolicyIds: ['DP-Q01-OPEN-PLAY']
    },
    evidenceCandidates: [],
    completionRecommendation: { recommended: false, rationale: '尚未听到教师回答', consultedPolicyIds: [] },
    boundary: { kind: 'NONE', rationale: '' },
    trace: { agentId: 'dialogue-agent-test', model: 'fake-model', promptVersion: 'test-v2' },
    ...overrides
  }
}

function claim(session, ids) {
  return session.evidenceState.claims[evidenceKey(ids.evidenceClaimId, ids.understandingId)]
}

const tests = []
function test(name, fn) { tests.push({ name, fn }) }

test('模型密钥配置地址在浏览器发请求前强制限定为回环地址', () => {
  assert.equal(resolveLocalModelConfigBaseUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787')
  assert.equal(resolveLocalModelConfigBaseUrl('https://localhost:8787'), 'https://localhost:8787')
  assert.throws(() => resolveLocalModelConfigBaseUrl('https://example.com/tcim'), /只允许连接本机/)
  assert.throws(() => resolveLocalModelConfigBaseUrl('http://localhost.evil.example:8787'), /只允许连接本机/)
})

test('runtime-data adapter 将 Q1 与 Q01 映射到同一新版运行卡', () => {
  assert.equal(normalizeQuestionId('Q1'), 'Q01')
  assert.equal(normalizeQuestionId('Q01'), 'Q01')
  const shortId = runtimeCard('Q1')
  const paddedId = runtimeCard('Q01')
  assert.equal(shortId.itemId, 'Q01')
  assert.equal(shortId.scenarioBrief.questionId, 'Q01')
  assert.equal(shortId.scenarioBrief.content, paddedId.scenarioBrief.content)
  assert.ok(shortId.professionalLenses.length > 0)
  assert.ok(shortId.evidencePolicies.some((policy) => policy.evidenceClaimId === PLAY.evidenceClaimId))
  assert.ok(shortId.dialoguePolicies.some((policy) => policy.type === 'AFFORDANCE'))
  assert.ok(shortId.synthesisPolicies.length > 0)
})

test('发给 Dialogue Agent 的紧凑运行卡保留四个选项的字母与语义', () => {
  const compact = compactRuntimeCard(runtimeCard('Q1'))
  assert.equal(compact.scenarioBrief.pretestOptions.length, 4)
  assert.deepEqual(compact.scenarioBrief.pretestOptions.map((option) => option.optionCode), ['A', 'B', 'C', 'D'])
  assert.ok(compact.scenarioBrief.pretestOptions.every((option) => option.content && option.assessmentRelation === 'PRIOR_ONLY'))
  assert.equal(compact.rankingPrior.finalRanking.join(''), 'ACBD')
})

test('紧凑运行卡保留可替代路径ANY_OF语义，不把多路径误读为全部必需', () => {
  const compact = compactRuntimeCard(runtimeCard('Q08'), { teacherTurn: '我会先看孩子卡在哪里，再决定给多大帮助。' })
  assert.ok(compact.evidencePolicies.length > 0)
  assert.ok(compact.evidencePolicies.every((policy) => policy.pathRelationMode === 'ALTERNATIVE_PATHS'))
  assert.ok(compact.evidencePolicies.every((policy) => policy.pathMatchRule === 'ANY_OF'))
  assert.ok(compact.evidencePolicies.every((policy) => policy.pathRefs.length >= 2))
})

test('发给 Dialogue Agent 的进展状态保留提问账本、开放线索、已覆盖线索和停滞度', async () => {
  const session = createDialogueSession(runtimeCard('Q1'))
  await startDialogue(session, async () => agentResult())
  const compact = compactDialogueProgressState(session.dialogueProgressState)
  assert.equal(compact.phase, 'OPENING')
  assert.equal(compact.questionLedger.length, 1)
  assert.equal(compact.questionLedger[0].questionText, '在这个情境里，您最先想判断什么？')
  assert.equal(compact.openThreads[0].openThreadId, 'teacher-meaning-entry')
  assert.ok(Array.isArray(compact.coveredCues))
  assert.equal(Number(compact.stagnation.score), 0)
})

test('运行卡和 Dialogue Agent 返回契约可验证', () => {
  const card = runtimeCard()
  assert.equal(validateRuntimeCard(card).ok, true)
  assert.equal(validateAgentResult(agentResult(), card).ok, true)
  assert.equal(validateAgentResult({ visibleText: '缺契约' }, card).ok, false)
})

test('恢复会话必须匹配 schema、dataset、fingerprint、session 与 item', () => {
  const card = runtimeCard()
  const session = createDialogueSession(card)
  const expected = {
    sessionId: card.sessionId,
    itemId: card.itemId,
    datasetId: card.dataProvenance.datasetId,
    configFingerprint: card.dataProvenance.configFingerprint,
    runtimeSchemaVersion: card.dataProvenance.schemaVersion
  }
  assert.equal(validateDialogueSessionForResume(session, expected).ok, true)

  for (const [field, mutate, error] of [
    ['schema', (copy) => { copy.schemaVersion = 'dialogue-agent.session/v1' }, 'dialogue_session_schema_mismatch'],
    ['dataset', (copy) => { copy.runtimeCard.dataProvenance.datasetId = 'OLD_DATASET' }, 'runtime_dataset_mismatch'],
    ['fingerprint', (copy) => { copy.runtimeCard.dataProvenance.configFingerprint = 'stale' }, 'runtime_config_fingerprint_mismatch'],
    ['item', (copy) => { copy.itemId = 'Q02' }, 'dialogue_session_item_mismatch']
  ]) {
    const copy = structuredClone(session)
    mutate(copy)
    const checked = validateDialogueSessionForResume(copy, expected)
    assert.equal(checked.ok, false, field)
    assert.ok(checked.errors.includes(error), field)
  }

  const missingProgress = structuredClone(session)
  delete missingProgress.dialogueProgressState
  assert.ok(validateDialogueSessionForResume(missingProgress, expected).errors.includes('dialogue_progress_state_not_object'))
})

test('首问由 Dialogue Agent 生成并保留方向审计', async () => {
  const session = createDialogueSession(runtimeCard())
  const out = await startDialogue(session, async (request) => {
    assert.equal(request.kind, 'FIRST_QUESTION')
    assert.equal(request.policySemantics.affordance, 'SOFT')
    assert.equal(request.runtimeCard.scenarioBrief.questionId, 'Q01')
    return agentResult({ visibleText: '您看到这个情境时，最先在意的是什么？' })
  })
  assert.equal(out.ok, true)
  assert.equal(out.question, '您看到这个情境时，最先在意的是什么？')
  assert.equal(session.status, 'ACTIVE')
  assert.equal(session.evidenceState.records.length, 0)
  assert.equal(session.dialogueProgressState.phase, 'OPENING')
  assert.equal(session.dialogueProgressState.questionLedger.length, 1)
  assert.equal(session.dialogueProgressState.questionLedger[0].goalLabel, '先理解教师自己的判断起点')
  assert.equal(session.dialogueProgressState.openThreads[0].openThreadId, 'teacher-meaning-entry')
})

test('每轮 request 都携带已持久化的 DialogueProgressState', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async (request) => {
    assert.equal(request.dialogueProgressState.schemaVersion, 'dialogue-agent.progress-state/v1')
    assert.equal(request.dialogueProgressState.questionLedger.length, 0)
    return agentResult()
  })
  await submitTeacherTurn(session, '我会先看孩子是不是在形成自己的玩法。', async (request) => {
    assert.equal(request.dialogueProgressState.questionLedger.length, 1)
    assert.equal(request.dialogueProgressState.questionLedger[0].answerStatus, 'RECEIVED')
    assert.equal(request.dialogueProgressState.questionLedger[0].answerTurnId, 'turn-1')
    return agentResult({ visibleText: '这种玩法出现什么变化时，您会调整回应？' })
  })
})

test('教师原话理解、工作假设和方向切换会进入进展账本但不改 Evidence', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  await submitTeacherTurn(session, '我会先看地面是否湿滑，再看孩子有没有协商。', async () => agentResult({
    visibleText: '如果风险很低，孩子的协商会怎样影响您的介入时机？',
    direction: {
      label: '比较风险条件与儿童协商',
      openThreadId: 'risk-and-negotiation',
      rationale: '沿教师提出的两个条件继续深化',
      consultedPolicyIds: ['DP-Q01-CONDITION-COMPARE']
    },
    understanding: {
      teacher_quote: '地面是否湿滑',
      meaning: '教师先检查可观察的安全条件',
      confidence: 'HIGH'
    },
    workingHypotheses: [{
      hypothesis_id: 'hyp-risk-priority',
      statement: '教师可能把风险阈值作为介入前提',
      status: 'ACTIVE',
      confidence: 0.72,
      source_refs: ['turn-1']
    }]
  }))

  const progress = session.dialogueProgressState
  assert.equal(progress.phase, 'DEEPENING')
  assert.equal(progress.coveredCues.length, 1)
  assert.equal(progress.coveredCues[0].span, '地面是否湿滑')
  assert.equal(progress.coveredCues[0].formalEvidenceIds.length, 0)
  assert.equal(progress.openThreads.find((thread) => thread.openThreadId === 'teacher-meaning-entry').status, 'DEFERRED')
  assert.equal(progress.openThreads.find((thread) => thread.openThreadId === 'risk-and-negotiation').status, 'ACTIVE')
  assert.equal(progress.questionLedger.at(-1).workingHypotheses[0].hypothesisId, 'hyp-risk-priority')
  assert.equal(session.evidenceState.records.length, 0)
})

test('同一问题或同一线程目标无新增线索时累积 stagnation', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  await submitTeacherTurn(session, '我还没想好。', async () => agentResult())
  await submitTeacherTurn(session, '还是没想好。', async () => agentResult())

  const stagnation = session.dialogueProgressState.stagnation
  assert.equal(stagnation.repeatedQuestionCount, 2)
  assert.equal(stagnation.consecutiveSimilarGoals, 2)
  assert.equal(stagnation.score, 2)
  assert.ok(stagnation.reasonCodes.includes('exact_question_repeat'))
})

test('Evidence 只提交映射合法且精确回指教师原话的 span', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const teacher = '我会先看地面是否湿滑，也看是否影响其他孩子。'
  const out = await submitTeacherTurn(session, teacher, async () => agentResult({
    visibleText: '这些情况出现到什么程度时，您会决定介入？',
    direction: {
      label: '理解介入阈值', openThreadId: 'risk-threshold',
      rationale: '教师主动提到具体风险', consultedPolicyIds: ['DP-Q01-CONDITION-COMPARE']
    },
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['地面是否湿滑', '是否影响其他孩子'],
      proposedStatus: 'SUFFICIENT', responseOrigin: 'RO1', confidence: 0.86, rationale: '教师给出了两类具体检查项'
    }]
  }))
  assert.equal(out.evidence.accepted.length, 1)
  assert.equal(claim(session, RISK).status, 'SUFFICIENT')
  assert.deepEqual(session.evidenceState.records.map((record) => record.span), ['地面是否湿滑', '是否影响其他孩子'])
  assert.ok(session.evidenceState.auditLog.some((event) => event.type === 'EvidenceCommitted' && event.exactTeacherSpans[0] === '地面是否湿滑'))
  assert.ok(session.interviewUtilityState.coverage.independentCapabilityIds.includes('C11'))
  assert.equal(session.interviewUtilityState.semantics, 'ADVISORY_ONLY_DIALOGUE_AGENT_MAY_DECLINE')
})

test('单轮 HIGH_QUALITY 提议被确定性降级，跨轮确认后才可升级', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const first = await submitTeacherTurn(session, '我会先看地面是否湿滑。', async () => agentResult({
    visibleText: '还有什么独立线索会支持您的判断？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['地面是否湿滑'], proposedStatus: 'HIGH_QUALITY',
      responseOrigin: 'RO1', confidence: 0.92, rationale: '模型提出高等级候选'
    }]
  }))
  assert.equal(first.evidence.accepted[0].proposedStatus, 'HIGH_QUALITY')
  assert.equal(first.evidence.accepted[0].effectiveStatus, 'SUFFICIENT')
  assert.equal(claim(session, RISK).status, 'SUFFICIENT')
  const firstRecord = session.evidenceState.records[0]
  assert.equal(firstRecord.responseOrigin, 'RO1')
  assert.equal(firstRecord.effectiveStatus, 'SUFFICIENT')
  assert.equal(firstRecord.policySchemaVersion, runtimeData.schemaVersion)
  assert.equal(firstRecord.policyConfigFingerprint, runtimeData.configFingerprint)
  assert.ok(firstRecord.determinationReasons.some((reason) => reason.includes('teacher_confirmation')))

  const second = await submitTeacherTurn(session, '再确认一次，我还会看是否影响其他孩子。', async () => agentResult({
    visibleText: '这种判断在哪些情况下会改变？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['是否影响其他孩子'], proposedStatus: 'HIGH_QUALITY',
      responseOrigin: 'RO1', confidence: 0.94, rationale: '不同轮次再次独立确认'
    }]
  }))
  assert.equal(second.evidence.accepted[0].effectiveStatus, 'HIGH_QUALITY')
  assert.equal(claim(session, RISK).status, 'HIGH_QUALITY')
  const expected = {
    sessionId: session.sessionId,
    itemId: session.itemId,
    datasetId: session.runtimeCard.dataProvenance.datasetId,
    configFingerprint: session.runtimeCard.dataProvenance.configFingerprint,
    runtimeSchemaVersion: session.runtimeCard.dataProvenance.schemaVersion
  }
  assert.equal(validateDialogueSessionForResume(session, expected).ok, true)
  const staleEvidence = structuredClone(session)
  delete staleEvidence.evidenceState.records[0].effectiveStatus
  assert.ok(validateDialogueSessionForResume(staleEvidence, expected).errors.includes('evidence_record_effective_status_missing'))
})

test('RO2 受独立性要求限制，RO3 不在允许来源时被拒绝', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const prompted = await submitTeacherTurn(session, '在您的追问后，我会检查地面。', async () => agentResult({
    visibleText: '这是您原本就会关注的，还是刚才讨论后想到的？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['我会检查地面'], proposedStatus: 'HIGH_QUALITY',
      responseOrigin: 'RO2', confidence: 0.8, rationale: '澄清追问后的补充'
    }]
  }))
  assert.equal(prompted.evidence.accepted[0].effectiveStatus, 'PARTIAL')
  assert.ok(prompted.evidence.accepted[0].determination.reasons.includes('independence_requirement_caps_prompted_origin'))

  const supplied = await submitTeacherTurn(session, '我选择您刚才提供的做法。', async () => agentResult({
    visibleText: '您选择它的具体理由是什么？',
    evidenceCandidates: [{
      ...PLAY, relation: 'SUPPORT', spans: ['我选择您刚才提供的做法'], proposedStatus: 'SUFFICIENT',
      responseOrigin: 'RO3', confidence: 0.7, rationale: '选择 AI 提供的内容'
    }]
  }))
  assert.equal(supplied.evidence.accepted.length, 0)
  assert.match(supplied.evidence.rejected[0].errors.join(','), /response_origin_not_allowed/)
})

test('较弱的后续 SUPPORT 不会静默降低既有 Evidence 状态', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  await submitTeacherTurn(session, '我会检查湿滑和他人使用情况。', async () => agentResult({
    visibleText: '什么条件会改变您的介入强度？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['检查湿滑和他人使用情况'],
      proposedStatus: 'SUFFICIENT', responseOrigin: 'RO1', confidence: 0.88, rationale: '具体风险线索'
    }]
  }))
  await submitTeacherTurn(session, '我还会再看一下。', async () => agentResult({
    visibleText: '您说的“看一下”最具体会看什么？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['再看一下'],
      proposedStatus: 'PARTIAL', responseOrigin: 'RO1', confidence: 0.55, rationale: '较弱的补充'
    }]
  }))
  assert.equal(claim(session, RISK).status, 'SUFFICIENT')
  assert.equal(claim(session, RISK).confidence, 0.88)
})

test('无原话 span 的候选被拒绝且不污染 canonical evidence', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const out = await submitTeacherTurn(session, '我会先看看情况。', async () => agentResult({
    visibleText: '您所说的“情况”具体包括哪些现场线索？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['教师已经充分识别风险'],
      proposedStatus: 'HIGH_QUALITY', responseOrigin: 'RO1', confidence: 0.99, rationale: '模型概括，非原话'
    }]
  }))
  assert.equal(out.ok, true)
  assert.equal(out.evidence.accepted.length, 0)
  assert.match(out.evidence.rejected[0].errors.join(','), /span_not_in_teacher_turn/)
  assert.equal(session.evidenceState.records.length, 0)
  assert.equal(claim(session, RISK).status, 'UNKNOWN')
})

test('表外 openThreadId 合法，但不能把表外 claim 写入 canonical evidence', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const out = await submitTeacherTurn(session, '我还会留意孩子们怎样分工。', async () => agentResult({
    visibleText: '这种分工会怎样影响您的回应？',
    direction: {
      label: '追随教师新提出的协作线索',
      openThreadId: 'teacher-open:peer-coordination',
      rationale: '这是教师刚刚提出且值得理解的新方向',
      consultedPolicyIds: ['T4G-AFF-005']
    },
    evidenceCandidates: [{
      evidenceClaimId: 'ECL-OPEN-PEER', understandingId: 'UND-OPEN-PEER',
      relation: 'SUPPORT', spans: ['孩子们怎样分工'], proposedStatus: 'PARTIAL', responseOrigin: 'RO1', confidence: 0.6,
      rationale: '方向有价值，但尚未映射到合法 claim'
    }]
  }))
  assert.equal(out.ok, true)
  assert.equal(out.direction.openThreadId, 'teacher-open:peer-coordination')
  assert.equal(out.evidence.accepted.length, 0)
  assert.match(out.evidence.rejected[0].errors.join(','), /unknown_evidence_claim_mapping/)
  assert.equal(session.evidenceState.records.length, 0)
  const log = session.auditLog.find((event) => event.type === 'AgentResultAccepted' && event.turnId === 'turn-1')
  assert.equal(log.guidance.openThreadMappedToDialoguePolicy, false)
})

test('教师纠正会修订旧证据并保留新旧可追溯关系', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  await submitTeacherTurn(session, '我会马上制止，因为篮球架只能打球。', async () => agentResult({
    visibleText: '如果现场风险很低，您的做法还会一样吗？',
    evidenceCandidates: [{
      ...PLAY, relation: 'SUPPORT', spans: ['篮球架只能打球'],
      proposedStatus: 'NOT_DEMONSTRATED', responseOrigin: 'RO1', confidence: 0.78, rationale: '以原用途作为主要理由'
    }]
  }))
  const oldId = claim(session, PLAY).activeEvidenceIds[0]

  await submitTeacherTurn(session, '不是，我的意思是先确认地面湿不湿滑，再决定是否介入。', async () => agentResult({
    visibleText: '除了地面情况，还有什么会改变您的介入强度？',
    direction: {
      label: '承接教师纠正后的条件判断', openThreadId: 'teacher-correction',
      rationale: '先修复旧理解', consultedPolicyIds: []
    },
    evidenceCandidates: [{
      ...PLAY, relation: 'REVISE', spans: ['先确认地面湿不湿滑，再决定是否介入'],
      proposedStatus: 'SUFFICIENT', responseOrigin: 'RO1', confidence: 0.84, rationale: 'teacher_correction'
    }]
  }))

  const oldRecord = session.evidenceState.records.find((record) => record.evidenceId === oldId)
  assert.equal(oldRecord.lifecycle, 'SUPERSEDED')
  assert.equal(claim(session, PLAY).status, 'SUFFICIENT')
  assert.equal(session.evidenceState.revisions.length, 1)
  assert.ok(session.evidenceState.revisions[0].supersededEvidenceIds.includes(oldId))
})

test('矛盾证据并存记录且不会静默覆盖既有判断', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  await submitTeacherTurn(session, '我会先检查地面是否湿滑。', async () => agentResult({
    visibleText: '如果没有明显风险，您还会马上介入吗？',
    evidenceCandidates: [{
      ...RISK, relation: 'SUPPORT', spans: ['检查地面是否湿滑'],
      proposedStatus: 'SUFFICIENT', responseOrigin: 'RO1', confidence: 0.82, rationale: '提出具体风险检查'
    }]
  }))
  const supportId = claim(session, RISK).activeEvidenceIds[0]

  await submitTeacherTurn(session, '不过就算地面已经很滑，我也不会介入。', async () => agentResult({
    visibleText: '什么情况会让您改变这个决定？',
    evidenceCandidates: [{
      ...RISK, relation: 'CONTRADICT', responseOrigin: 'RO1', spans: ['地面已经很滑，我也不会介入'],
      confidence: 0.9, rationale: '新说法与已表达的风险判断存在张力'
    }]
  }))

  const state = claim(session, RISK)
  assert.equal(state.status, 'SUFFICIENT')
  assert.equal(state.hasConflict, true)
  assert.ok(state.activeEvidenceIds.includes(supportId))
  assert.equal(state.activeConflictIds.length, 1)
  assert.equal(session.evidenceState.records.find((record) => record.evidenceId === supportId).lifecycle, 'ACTIVE')
})

test('模型可自由选择与 AFFORDANCE 不同的对话方向', async () => {
  const session = createDialogueSession(runtimeCard())
  const out = await startDialogue(session, async () => agentResult({
    visibleText: '您觉得这里的规则主要是在保护什么？',
    direction: {
      label: '先谈规则与自主性的关系',
      openThreadId: 'teacher-open:rules-and-autonomy',
      rationale: '模型判断这一方向更能打开教师思路',
      consultedPolicyIds: ['DP-Q01-OPEN-PLAY']
    }
  }))
  assert.equal(out.ok, true)
  assert.equal(out.direction.openThreadId, 'teacher-open:rules-and-autonomy')
  const log = session.auditLog.find((event) => event.type === 'AgentResultAccepted')
  assert.equal(log.guidance.openThreadMappedToDialoguePolicy, false)
  assert.equal(log.guidance.affordanceSemantics, 'SOFT')
})

test('AFFORDANCE 不能冒充硬边界，HARD_BOUNDARY 可以被识别', () => {
  const card = runtimeCard()
  const softAttempt = validateHardBoundaries({
    visibleText: '本轮到这里。', action: 'CLOSE',
    boundary: { kind: 'SAFETY', policyId: 'DP-Q01-OPEN-PLAY' }, runtimeCard: card
  })
  assert.equal(softAttempt.ok, false)
  assert.ok(softAttempt.issues.includes('non_hard_policy_cannot_enforce_boundary'))

  const hardPolicy = validateHardBoundaries({
    visibleText: '本轮到这里。', action: 'CLOSE',
    boundary: { kind: 'SAFETY', policyId: 'DP-Q01-HARD-BOUNDARY' }, runtimeCard: card
  })
  assert.equal(hardPolicy.ok, true)
})

test('synthesis 完成建议不等于强制结束', async () => {
  const session = createDialogueSession(runtimeCard())
  const out = await startDialogue(session, async () => agentResult({
    visibleText: '如果幼儿提出另一种安全玩法，您会怎样回应？',
    completionRecommendation: {
      recommended: true,
      rationale: '当前已可形成有限综合，但模型仍选择理解一个高价值方向',
      consultedPolicyIds: ['END-Q01-MARGINAL-GAIN']
    }
  }))
  assert.equal(out.ok, true)
  assert.equal(session.status, 'ACTIVE')
  assert.equal(out.action, 'ASK')
  assert.equal(out.completionRecommendation.recommended, true)
})

test('Agent 失败时暂停并允许重试，不生成本地专业问句', async () => {
  const session = createDialogueSession(runtimeCard())
  const failed = await startDialogue(session, async () => {
    throw Object.assign(
      new Error('provider output failed validation: duplicate_question'),
      { code: 'invalid_provider_output' }
    )
  })
  assert.equal(failed.status, 'paused')
  assert.equal(failed.retryable, true)
  assert.equal(failed.question, null)
  assert.equal(failed.error, 'invalid_provider_output')
  assert.match(failed.errorDetails, /duplicate_question/)
  assert.ok(session.auditLog.some((event) => event.type === 'DialoguePaused' && /duplicate_question/.test(event.details)))
  assert.equal(session.history.length, 0)

  const retried = await retryDialogue(session, async () => agentResult({ visibleText: '您会从哪些现场线索开始判断？' }))
  assert.equal(retried.ok, true)
  assert.equal(retried.question, '您会从哪些现场线索开始判断？')
  assert.equal(session.status, 'ACTIVE')
})

test('完成后迟到的 abort 不得把会话改回 PAUSED', async () => {
  const session = createDialogueSession(runtimeCard())
  let rejectProvider
  const pending = startDialogue(session, () => new Promise((resolve, reject) => { rejectProvider = reject }))
  assert.equal(session.status, 'GENERATING')
  assert.ok(session.pendingRequest)
  session.status = 'COMPLETED'
  session.pendingRequest = null
  rejectProvider(Object.assign(new Error('dialogue_agent_aborted'), { code: 'dialogue_agent_aborted' }))
  const out = await pending
  assert.equal(out.status, 'completed')
  assert.equal(out.retryable, false)
  assert.equal(session.status, 'COMPLETED')
  assert.equal(session.pendingRequest, null)
})

test('单问硬边界拒绝多问并进入可重试暂停', async () => {
  const session = createDialogueSession(runtimeCard())
  const out = await startDialogue(session, async () => agentResult({ visibleText: '您先看什么？然后会怎么做？' }))
  assert.equal(out.status, 'paused')
  assert.match(out.error, /multiple_questions/)
  assert.equal(session.history.length, 0)
})

test('隐私硬边界拒绝索取敏感身份信息', async () => {
  const session = createDialogueSession(runtimeCard())
  const out = await startDialogue(session, async () => agentResult({ visibleText: '请先告诉我您的身份证号？' }))
  assert.equal(out.status, 'paused')
  assert.match(out.error, /privacy_request/)
  assert.equal(session.history.length, 0)
})

test('教师明确退出由硬边界本地收束且不再调用模型', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  let called = false
  const out = await submitTeacherTurn(session, '我不想继续，先到这里。', async () => {
    called = true
    return agentResult()
  })
  assert.equal(called, false)
  assert.equal(out.hardBoundaryHandled, true)
  assert.equal(session.status, 'COMPLETED')
  assert.ok(session.auditLog.some((event) => event.type === 'HardBoundaryHandled' && event.kind === 'EXIT'))
})

test('最后90秒进入收尾且不再启动新的前台追问', () => {
  assert.equal(interviewTimePhase(WRAP_UP_RESERVE_MS + 1), 'DIALOGUE')
  assert.equal(interviewTimePhase(WRAP_UP_RESERVE_MS), 'WRAP_UP')
  assert.equal(interviewTimePhase(0), 'EXPIRED')
  assert.equal(mayStartForegroundGeneration(WRAP_UP_RESERVE_MS), false)
  assert.equal(mayStartForegroundGeneration(WRAP_UP_RESERVE_MS + 15_000), false)
})

test('整体理解问题只在约两分钟窗口触发一次且不侵占收尾保护线', () => {
  assert.equal(shouldRequestIntegrativeQuestion(INTEGRATIVE_QUESTION_TRIGGER_MS + 1, false), false)
  assert.equal(shouldRequestIntegrativeQuestion(INTEGRATIVE_QUESTION_TRIGGER_MS, false), true)
  assert.equal(shouldRequestIntegrativeQuestion(WRAP_UP_RESERVE_MS + 15_001, false), true)
  assert.equal(shouldRequestIntegrativeQuestion(WRAP_UP_RESERVE_MS + 15_000, false), false)
  assert.equal(shouldRequestIntegrativeQuestion(INTEGRATIVE_QUESTION_TRIGGER_MS, true), false)
  // 真实回放中一次提交发生在剩余153秒；旧150秒上沿会错过，本版应触发。
  assert.equal(shouldRequestIntegrativeQuestion(153_000, false), true)
})

test('收尾轮保存教师原话并直接完成，不需要模型再提问', async () => {
  const session = createDialogueSession(runtimeCard())
  await startDialogue(session, async () => agentResult())
  const out = completeFinalTeacherTurn(session, '我还会看孩子是否愿意继续。', { reservedMs: WRAP_UP_RESERVE_MS })
  assert.equal(out.action, 'CLOSE')
  assert.equal(session.status, 'COMPLETED')
  assert.equal(session.history.at(-2).role, 'teacher')
  assert.equal(session.history.at(-2).text, '我还会看孩子是否愿意继续。')
  assert.ok(session.auditLog.some((event) => event.type === 'DialogueClosedByTimeController'))
})

for (const { name, fn } of tests) {
  await fn()
  console.log(`✓ ${name}`)
}
console.log(`Dialogue Agent 领域层测试通过：${tests.length}/${tests.length}`)
