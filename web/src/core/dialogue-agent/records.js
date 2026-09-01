export const COMPARISON_INTERVIEW_MODE = 'dialogue_agent_new_five_tables_evidence_state'

export function isSimulationInterviewRecord(record) {
  if (!record || typeof record !== 'object') return false
  const provider = String(record.llmProfile || record.provider || '').trim().toLowerCase()
  const model = String(record.llmModel || record.model || '').trim().toLowerCase()
  return record.simulationOnly === true || provider === 'mock' || model.startsWith('mock-')
}

export function isFormalComparisonInterviewRecord(record) {
  return Boolean(
    record
    && record.mode === COMPARISON_INTERVIEW_MODE
    && !isSimulationInterviewRecord(record)
  )
}
