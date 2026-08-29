export const INTERVIEW_UTILITY_SCHEMA = 'dialogue-agent.interview-utility/v1'

function baseCapabilityId(value) {
  const match = String(value || '').match(/^(C\d{2})/)
  return match ? match[1] : ''
}

function policyIndex(runtimeCard = {}) {
  return new Map((runtimeCard.evidencePolicies || []).map((policy) => [
    `${policy.evidenceClaimId}::${policy.understandingId}`,
    policy
  ]))
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

/**
 * SparkMe式“覆盖—新发现—成本”平衡的低延时版。
 * 只从已保存状态派生，不另调模型，不指定下一问。
 */
export function deriveInterviewUtilityState(session = {}) {
  const policies = policyIndex(session.runtimeCard)
  const records = (session.evidenceState?.records || []).filter((record) => (
    record.lifecycle === 'ACTIVE' && ['SUPPORT', 'REVISE'].includes(record.relation)
  ))
  const byOrigin = { independent: [], prompted: [], aiInfluenced: [] }
  for (const record of records) {
    const policy = policies.get(`${record.evidenceClaimId}::${record.understandingId}`)
    const capabilityIds = unique((policy?.capabilityRefs || []).map(baseCapabilityId))
    const row = { evidenceId: record.evidenceId, capabilityIds, turnId: record.sourceTurnId }
    if (['RO0', 'RO1'].includes(record.responseOrigin)) byOrigin.independent.push(row)
    else if (record.responseOrigin === 'RO2') byOrigin.prompted.push(row)
    else if (['RO3', 'RO4'].includes(record.responseOrigin)) byOrigin.aiInfluenced.push(row)
  }
  const progress = session.dialogueProgressState || {}
  const activeThreads = (progress.openThreads || []).filter((thread) => thread.status === 'ACTIVE')
  const mappedPolicyIds = new Set((session.runtimeCard?.dialoguePolicies || []).map((policy) => policy.policyId))
  const emergentThreads = (progress.openThreads || []).filter((thread) => (
    !(thread.consultedPolicyIds || []).some((policyId) => mappedPolicyIds.has(policyId))
  ))
  const independentCapabilityIds = unique(byOrigin.independent.flatMap((row) => row.capabilityIds))
  const stagnationScore = Number(progress.stagnation?.score || 0)
  let advisorySignal = 'OPEN_EXPLORE'
  if (stagnationScore >= 2) advisorySignal = 'SHIFT_OR_SIMPLIFY'
  else if (activeThreads.length && independentCapabilityIds.length) advisorySignal = 'FOLLOW_HIGH_VALUE_THREAD'

  return {
    schemaVersion: INTERVIEW_UTILITY_SCHEMA,
    turns: Number(session.turnSeq || 0),
    coverage: {
      independentCapabilityIds,
      independentEvidenceCount: byOrigin.independent.length,
      promptedEvidenceCount: byOrigin.prompted.length,
      aiInfluencedEvidenceCount: byOrigin.aiInfluenced.length
    },
    emergence: {
      openThreadCount: activeThreads.length,
      emergentThreadCount: emergentThreads.length,
      emergentThreadIds: emergentThreads.slice(-3).map((thread) => thread.openThreadId)
    },
    cost: {
      questionCount: (progress.questionLedger || []).filter((entry) => entry.action === 'ASK').length,
      repeatedQuestionCount: Number(progress.stagnation?.repeatedQuestionCount || 0),
      stagnationScore
    },
    advisorySignal,
    semantics: 'ADVISORY_ONLY_DIALOGUE_AGENT_MAY_DECLINE',
    updatedAt: Date.now()
  }
}

