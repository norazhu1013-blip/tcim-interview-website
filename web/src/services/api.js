import { callGateway } from './web-gateway.js'

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

export function reportInterview(session) {
  return callGateway('reportInterview', {
    sessionId: session.sessionId,
    studyMode: session.studyMode || 'full_assessment',
    targetItemId: session.targetItemId || null,
    transcripts: session.interview || null,
    feedback: session.interviewFeedback || null
  })
}
