import { callGateway } from './web-gateway.js'
import { isFormalComparisonInterviewRecord } from '../core/dialogue-agent/records.js'

export const whoami = () => callGateway('whoami')

export const exportData = (format = 'xlsx') => callGateway('exportData', { format })

export const reportProfile = (profile) => callGateway('reportTeacher', { profile })

export function reportExam(session, profile) {
  const answers = session.answers || {}
  return callGateway('reportSession', {
    sessionId: session.sessionId,
    profile,
    answers,
    scores: session.scores || null,
    total: session.scores?.total ?? null,
    selection: session.selection || null,
    studyMode: session.studyMode || 'full_assessment',
    targetItemId: session.targetItemId || null,
    submitStatus: session.submitStatus || null,
    items: Object.entries(answers).map(([itemId, answer]) => ({
      itemId,
      durationMs: answer.duration_ms || 0,
      enterTs: answer.enter_ts || null,
      submitTs: answer.submit_ts || null
    })),
    examStartTs: session.examStartTs || null,
    examSubmitTs: session.examSubmitTs || null,
    totalDurationMs: session.totalExamMs || 0
  })
}

export const selectFinal = (sessionId) => callGateway('selectFinal', { sessionId })

export const interviewNext = (context) => callGateway('interviewChat', context)

// 1.4：上传时剔除重复数据，避免载荷膨胀触发网关 1MB 上限。
//  - tcimSession 内已含完整 replay；去掉单独再存的 tcimReplay。
//  - tcimSession.history 与 teacher-visible messages 重复，去掉。
//  - 保留 tcimSession.replay（研究审计用）与 messages（对话逐字稿）。
function stripTranscriptForUpload(t) {
  if (!t || typeof t !== 'object') return t
  const { tcimReplay, tcimSession, ...rest } = t
  const lean = { ...rest }
  if (tcimSession && typeof tcimSession === 'object') {
    const { history, replay, ...sessionRest } = tcimSession
    lean.tcimSession = { ...sessionRest, ...(replay ? { replay } : {}) }
  }
  return lean
}

function byteLength(str) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str).length : str.length
}

const DISCARD_LIMIT_BYTES = 950 * 1024 // 网关 1MB，前端在 0.95MB 就告警，避免硬 413
export function formalComparisonTranscripts(session) {
  const records = { ...(session.interview || {}), ...(session.comparisonInterview || {}) }
  return Object.fromEntries(
    Object.entries(records)
      .filter(([, record]) => isFormalComparisonInterviewRecord(record))
      .map(([key, value]) => [key, stripTranscriptForUpload(value)])
  )
}

export function reportInterview(session) {
  const transcripts = formalComparisonTranscripts(session)
  const payload = {
    sessionId: session.sessionId,
    studyMode: session.studyMode || 'full_assessment',
    targetItemId: session.targetItemId || null,
    transcripts,
    feedback: session.interviewFeedback || null,
    revision: Number(session.reportRevision || 0)
  }
  const payloadBytes = byteLength(JSON.stringify(payload))
  if (payloadBytes > DISCARD_LIMIT_BYTES) {
    console.warn('[reportInterview] payload near/over gateway limit', { sessionId: session.sessionId, payloadBytes })
  }
  // 回执 meta 附带 requestPayloadBytes，供前端记录/排查载荷大小
  return callGateway('reportInterview', payload).then((r) => ({ ...r, requestPayloadBytes: payloadBytes }))
}

export const reportDraft = (draft) => callGateway('reportDraft', draft)
