const buildEnv = import.meta.env || {}
const injectedGitCommit = typeof __TCIM_GIT_COMMIT__ === 'undefined' ? '' : __TCIM_GIT_COMMIT__
const injectedBuiltAt = typeof __TCIM_BUILT_AT__ === 'undefined' ? '' : __TCIM_BUILT_AT__

export const TCIM_RELEASE = Object.freeze({
  releaseSchemaVersion: 'tcim-web-release/v1',
  releaseId: String(buildEnv.VITE_TCIM_RELEASE_ID || 'TCIM-WEB-2026.09.01-R6.2.2'),
  shortLabel: String(buildEnv.VITE_TCIM_RELEASE_LABEL || 'TCIM Web R6.2.2 · 临时测试入口'),
  accessMode: String(buildEnv.VITE_TEMPORARY_TEST_ENTRY || '') === '1' ? 'temporary_test_entry' : 'cloudbase_account',
  architecture: String(buildEnv.VITE_TCIM_COMPARISON_ARCHITECTURE || 'dialogue_agent_new_five_tables_evidence_state'),
  gitCommit: String(buildEnv.VITE_TCIM_GIT_COMMIT || injectedGitCommit || 'unrecorded'),
  builtAt: String(buildEnv.VITE_TCIM_BUILT_AT || injectedBuiltAt || 'unrecorded'),
  runtimeDatasetId: 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.2.1',
  runtimeSchemaVersion: '0.2.1',
  runtimeConfigFingerprint: 'd8eebef72dad95f81045250e6a17c6bfdc78fc6441211e425e3ac9e0e2d7ef07',
  expectedDialoguePromptVersion: 'tcim-dialogue-v3-low-latency-2026-09-01-r8-premise-aware-natural-close',
  dialogueSessionSchemaVersion: 'dialogue-agent.session/v3',
  evidenceSchemaVersion: 'dialogue-agent.evidence-state/v1',
  feedbackSchemaVersion: 'tcim-interview-feedback/v1'
})

/** 新会话冻结一次版本快照；以后网页升级也不改写旧记录属于哪一版。 */
export function currentReleaseSnapshot(capturedAt = Date.now()) {
  return { ...TCIM_RELEASE, capturedAt }
}
