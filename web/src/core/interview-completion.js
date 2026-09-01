const OPENING_RETRYABLE_ERRORS = new Set([
  'dialogue_agent_failed',
  'content_safety_unavailable',
  'generation_interrupted',
  'invalid_provider_output',
  'output_content_rejected',
  'rate_limited',
  'upstream_http_error'
])

export function teacherTurnCount(messages = []) {
  return messages.filter((message) => (
    message?.role === 'teacher'
    && String(message?.text || '').trim()
  )).length
}

export function canCompleteInterview(messages = []) {
  return teacherTurnCount(messages) > 0
}

export function persistedInterviewStatus(requestedDone, messages = []) {
  return requestedDone && canCompleteInterview(messages) ? 'done' : 'in_progress'
}

export function shouldAutoRetryOpening(error, retryCount = 0, messages = []) {
  return retryCount < 1
    && teacherTurnCount(messages) === 0
    && OPENING_RETRYABLE_ERRORS.has(String(error || ''))
}
