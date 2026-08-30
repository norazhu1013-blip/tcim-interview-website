import { isFormalComparisonInterviewRecord } from './dialogue-agent/records.js'

const STATUS_ORDER = Object.freeze({
  NOT_DEMONSTRATED: 0,
  PARTIAL: 1,
  SUFFICIENT: 2,
  HIGH_QUALITY: 3
})

const INDEPENDENT_ORIGINS = new Set(['RO0', 'RO1'])
const PROMPTED_ORIGINS = new Set(['RO2'])
const AI_INFLUENCED_ORIGINS = new Set(['RO3', 'RO4'])

export const TCIM_GLOBAL_CAPABILITIES = Object.freeze([
  ['C01', '观察与事实—解释分离', '能把可观察事件、教师解释和价值判断分开，并说明证据来自哪里。'],
  ['C02', '游戏意义与儿童意图理解', '从儿童行动、语言与材料关系理解游戏主题、规则生成和意义变化。'],
  ['C03', '儿童状态与最近发展区判断', '识别兴趣、挫折、情绪、当前策略及可能在适度支持下达到的下一步。'],
  ['C04', '多假设与反事实推理', '同时保留竞争解释，并说明什么新信息会改变当前判断。'],
  ['C05', '介入时机判断', '依据安全、投入、困难持续时间和求助信号决定等待、靠近或介入。'],
  ['C06', '支架强度、撤除与转接', '采用不超过需要的支持，并能随儿童恢复自主而淡出或转接。'],
  ['C07', '材料与环境可供性设计', '通过材料、空间、时间和可见线索扩大儿童可选择的行动。'],
  ['C08', '儿童自主、能动性与共同决定', '保护儿童提出目标、改变玩法、协商规则和承担适度责任的空间。'],
  ['C09', '同伴互动、规则与共同体协调', '理解同伴关系、共同使用、角色分工、冲突与公平参与。'],
  ['C10', '文化、差异与包容性响应', '避免以单一表达、文化或身体方式定义能力，提供多样参与路径。'],
  ['C11', '安全、伦理与现实边界权衡', '依据可观察风险和制度责任设定必要边界，同时尽量保留游戏连续性。'],
  ['C12', '反思、迁移与小步行动', '把情境理解转化为可检验的小调整，并在后续观察中修正认识。']
].map(([capabilityId, name, definition]) => ({
  capabilityId,
  name,
  definition,
  absenceNotInterpretableWhen: '本轮没有自然谈话机会或教师选择了其他高价值线索'
})))

function baseCapabilityId(value) {
  const match = String(value || '').match(/^(C\d{2})/)
  return match ? match[1] : ''
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function profileCapabilityRefs(policy) {
  const primary = baseCapabilityId(policy?.primaryProfileCapabilityId)
  if (primary) return [primary]
  // 兼容旧会话时只取首个可解析维度，避免同一条教师表达被重复计入多个画像维度。
  const fallback = unique((policy?.capabilityRefs || []).map(baseCapabilityId))[0]
  return fallback ? [fallback] : []
}

function formalRecords(session) {
  const merged = { ...(session?.interview || {}), ...(session?.comparisonInterview || {}) }
  return Object.entries(merged).filter(([, record]) => isFormalComparisonInterviewRecord(record))
}

function evidencePolicyMap(runtimeCard) {
  return new Map((runtimeCard?.evidencePolicies || []).map((policy) => (
    [`${policy.evidenceClaimId}::${policy.understandingId}`, policy]
  )))
}

function activeRecords(record) {
  return (record?.dialogueSession?.evidenceState?.records || []).filter((evidence) => (
    evidence?.lifecycle === 'ACTIVE'
    && ['SUPPORT', 'REVISE'].includes(evidence?.relation)
    && typeof evidence?.span === 'string'
    && evidence.span.trim()
  ))
}

function originClass(origin) {
  if (INDEPENDENT_ORIGINS.has(origin)) return 'INDEPENDENT'
  if (PROMPTED_ORIGINS.has(origin)) return 'PROMPTED'
  if (AI_INFLUENCED_ORIGINS.has(origin)) return 'AI_INFLUENCED'
  return 'UNCLASSIFIED'
}

function profileBand(observations, conflictCount) {
  const independent = observations.filter((row) => row.originClass === 'INDEPENDENT')
  const prompted = observations.filter((row) => row.originClass === 'PROMPTED')
  const influenced = observations.filter((row) => row.originClass === 'AI_INFLUENCED')
  if (!independent.length) {
    if (prompted.length) return { code: 'PROMPTED_ONLY', label: '仅有提示后证据', confidence: 'LOW' }
    if (influenced.length) return { code: 'AI_INFLUENCED_ONLY', label: '仅观察到AI影响后的回应', confidence: 'LOW' }
    return { code: 'NOT_OBSERVED', label: '尚无独立证据', confidence: 'NONE' }
  }
  const contexts = new Set(independent.map((row) => row.itemId))
  const strongest = Math.max(...independent.map((row) => STATUS_ORDER[row.effectiveStatus] ?? 0))
  if (conflictCount > 0) return { code: 'CONFLICTED', label: '证据存在矛盾，待核验', confidence: 'TENTATIVE' }
  if (contexts.size >= 2 && strongest >= STATUS_ORDER.SUFFICIENT) {
    return { code: 'CROSS_CONTEXT_SUPPORTED', label: '跨情境得到支持', confidence: 'MEDIUM' }
  }
  if (strongest >= STATUS_ORDER.SUFFICIENT) {
    return { code: 'EPISODE_SUPPORTED', label: '本情境得到支持', confidence: 'LOW' }
  }
  return { code: 'EMERGING', label: '本情境出现初步迹象', confidence: 'LOW' }
}

/**
 * 把 canonical Evidence 确定性地整理为“有边界的能力画像候选”。
 * 它不重新评分，也不让 LLM 把认同自己建议解释为教师原有能力。
 */
export function buildCanonicalCapabilityProfile(session, runtimeData = {}) {
  const globalLenses = runtimeData?.global?.professionalLenses?.length
    ? runtimeData.global.professionalLenses
    : TCIM_GLOBAL_CAPABILITIES
  const dimensions = new Map(globalLenses.map((lens) => [lens.capabilityId, {
    capabilityId: lens.capabilityId,
    name: lens.name,
    definition: lens.definition,
    observations: [],
    conflicts: [],
    missingDoesNotMeanLow: lens.absenceNotInterpretableWhen || '未自然谈及不等于缺乏该能力。'
  }]))

  for (const [itemId, interview] of formalRecords(session)) {
    const runtimeCard = interview?.dialogueSession?.runtimeCard || {}
    const policies = evidencePolicyMap(runtimeCard)
    const state = interview?.dialogueSession?.evidenceState || {}
    for (const evidence of activeRecords(interview)) {
      const policy = policies.get(`${evidence.evidenceClaimId}::${evidence.understandingId}`)
      for (const capabilityRef of profileCapabilityRefs(policy)) {
        const capabilityId = baseCapabilityId(capabilityRef)
        if (!dimensions.has(capabilityId)) continue
        dimensions.get(capabilityId).observations.push({
          evidenceId: evidence.evidenceId,
          itemId,
          turnId: evidence.sourceTurnId || '',
          quote: evidence.span.trim(),
          evidenceClaimId: evidence.evidenceClaimId,
          understandingId: evidence.understandingId,
          capabilityRef,
          associatedCapabilityRefs: unique(policy?.capabilityRefs || []),
          responseOrigin: evidence.responseOrigin,
          originClass: originClass(evidence.responseOrigin),
          effectiveStatus: evidence.effectiveStatus || 'PARTIAL',
          confidence: evidence.confidence ?? null,
          maxSupportedConclusion: policy?.maxSupportedConclusion || 'EPISODE_DESCRIPTION',
          contextBoundary: policy?.contextBoundary || '仅当前情境',
          policyRecordId: policy?.recordId || evidence.policyRecordId || ''
        })
      }
    }
    for (const claim of Object.values(state.claims || {})) {
      if (!claim?.hasConflict) continue
      const policy = policies.get(`${claim.evidenceClaimId}::${claim.understandingId}`)
      for (const capabilityRef of profileCapabilityRefs(policy)) {
        const capabilityId = baseCapabilityId(capabilityRef)
        if (!dimensions.has(capabilityId)) continue
        dimensions.get(capabilityId).conflicts.push({
          itemId,
          evidenceClaimId: claim.evidenceClaimId,
          understandingId: claim.understandingId,
          evidenceIds: unique(claim.activeConflictIds || [])
        })
      }
    }
  }

  const rows = [...dimensions.values()].map((dimension) => {
    const independent = dimension.observations.filter((row) => row.originClass === 'INDEPENDENT')
    const prompted = dimension.observations.filter((row) => row.originClass === 'PROMPTED')
    const aiInfluenced = dimension.observations.filter((row) => row.originClass === 'AI_INFLUENCED')
    const unclassified = dimension.observations.filter((row) => row.originClass === 'UNCLASSIFIED')
    const band = profileBand(dimension.observations, dimension.conflicts.length)
    return {
      capabilityId: dimension.capabilityId,
      name: dimension.name,
      definition: dimension.definition,
      band,
      independent,
      prompted,
      aiInfluenced,
      unclassified,
      conflicts: dimension.conflicts,
      independentContexts: unique(independent.map((row) => row.itemId)),
      evidenceCount: independent.length,
      missingDoesNotMeanLow: dimension.missingDoesNotMeanLow,
      maximumClaim: band.code === 'CROSS_CONTEXT_SUPPORTED'
        ? '仅表明在已访谈的多个情境中得到支持，不代表稳定特质或真实课堂必然表现。'
        : '仅表明当前访谈情境中的表达，不推断稳定特质或真实实践质量。'
    }
  })

  return {
    schemaVersion: 'tcim.canonical-capability-profile/v1',
    generatedBy: 'DETERMINISTIC_EVIDENCE_TRANSFORMER',
    dimensions: rows,
    summary: {
      independentSupportedDimensions: rows.filter((row) => row.evidenceCount > 0).length,
      crossContextSupportedDimensions: rows.filter((row) => row.band.code === 'CROSS_CONTEXT_SUPPORTED').length,
      promptedOnlyDimensions: rows.filter((row) => row.band.code === 'PROMPTED_ONLY').length,
      aiInfluencedOnlyDimensions: rows.filter((row) => row.band.code === 'AI_INFLUENCED_ONLY').length,
      conflictedDimensions: rows.filter((row) => row.band.code === 'CONFLICTED').length,
      excludedAiInfluencedEvidence: rows.reduce((sum, row) => sum + row.aiInfluenced.length, 0)
    },
    interpretationBoundary: '只有RO0/RO1进入原有能力画像；RO2单列为提示后澄清；RO3/RO4只记录反思或学习响应，不回写为教师原有能力。'
  }
}
