import { createRuntimeCard } from './contracts.js'

function clone(value) {
  // Vue 的响应式 Proxy 不能直接 structuredClone；运行卡只含 JSON 数据，序列化复制最稳妥。
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function combined(globalData, questionData, field) {
  return [
    ...(Array.isArray(globalData?.[field]) ? globalData[field] : []),
    ...(Array.isArray(questionData?.[field]) ? questionData[field] : [])
  ]
}

/** 把 Q1、q1、01、1 等入口统一映射为生成数据使用的 Q01。 */
export function normalizeQuestionId(value) {
  const match = String(value || '').trim().match(/^Q?0*(\d{1,2})$/i)
  if (!match) throw new Error(`invalid_question_id:${String(value || '')}`)
  const number = Number(match[1])
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new Error(`invalid_question_id:${String(value || '')}`)
  }
  return `Q${String(number).padStart(2, '0')}`
}

/** 从生成的新版 runtime JSON 中构造单题运行卡。 */
export function createRuntimeCardFromRuntimeData(runtimeData, input = {}) {
  if (!runtimeData || typeof runtimeData !== 'object') throw new Error('runtime_data_missing')
  const requestedQuestionId = input.questionId || input.itemId
  const questionId = normalizeQuestionId(requestedQuestionId)
  const question = runtimeData.questions?.[questionId]
  if (!question) throw new Error(`runtime_question_missing:${questionId}`)

  const scenarioBrief = {
    questionId,
    requestedQuestionId: String(requestedQuestionId),
    scenarioId: question.scenarioId,
    content: question.scenario?.content || '',
    scenario: clone(question.scenario || {}),
    professionalFocus: clone(question.professionalFocus || {}),
    pretestOptions: clone(question.pretestOptions || []),
    pretestPrior: clone(question.pretestPrior || {}),
    contextFacts: clone(question.contextFacts || []),
    importantUnknowns: clone(question.importantUnknowns || []),
    workingHypotheses: clone(question.workingHypotheses || []),
    contextVariants: clone(question.contextVariants || []),
    teacherContext: clone(input.teacherContext || {})
  }

  return createRuntimeCard({
    runtimeCardId: input.runtimeCardId || `${input.sessionId || 'session'}:${questionId}:${runtimeData.configFingerprint || runtimeData.schemaVersion || 'runtime'}`,
    sessionId: input.sessionId || '',
    itemId: questionId,
    scenarioBrief,
    professionalLenses: combined(runtimeData.global, question, 'professionalLenses'),
    evidencePolicies: combined(runtimeData.global, question, 'evidencePolicies'),
    dialoguePolicies: combined(runtimeData.global, question, 'dialoguePolicies'),
    synthesisPolicies: combined(runtimeData.global, question, 'synthesisPolicies'),
    dataProvenance: {
      datasetId: runtimeData.datasetId || '',
      schemaVersion: runtimeData.schemaVersion || '',
      configFingerprint: runtimeData.configFingerprint || '',
      releaseScope: clone(runtimeData.releaseScope || {}),
      sourceNote: runtimeData.sourceNote || ''
    }
  })
}
