const buildEnv = import.meta.env || {}

export const TCIM_RELEASE = Object.freeze({
  releaseSchemaVersion: 'tcim-web-release/v1',
  releaseId: String(buildEnv.VITE_TCIM_RELEASE_ID || 'TCIM-WEB-2026.08.30-R6.1'),
  shortLabel: String(buildEnv.VITE_TCIM_RELEASE_LABEL || 'TCIM Web R6.1 · 五表 V0.2.1'),
  architecture: String(buildEnv.VITE_TCIM_COMPARISON_ARCHITECTURE || 'dialogue_agent_new_five_tables_evidence_state'),
  gitCommit: String(buildEnv.VITE_TCIM_GIT_COMMIT || 'unrecorded'),
  builtAt: String(buildEnv.VITE_TCIM_BUILT_AT || 'unrecorded'),
  runtimeDatasetId: 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.2.1',
  runtimeSchemaVersion: '0.2.1',
  runtimeConfigFingerprint: 'd8eebef72dad95f81045250e6a17c6bfdc78fc6441211e425e3ac9e0e2d7ef07',
  expectedDialoguePromptVersion: 'tcim-dialogue-v3-low-latency-2026-08-30-r6-two-warmth-pressure-rhythm',
  dialogueSessionSchemaVersion: 'dialogue-agent.session/v3',
  evidenceSchemaVersion: 'dialogue-agent.evidence-state/v1',
  feedbackSchemaVersion: 'tcim-interview-feedback/v1'
})

/** 新会话冻结一次版本快照；以后网页升级也不改写旧记录属于哪一版。 */
export function currentReleaseSnapshot(capturedAt = Date.now()) {
  return { ...TCIM_RELEASE, capturedAt }
}
