import assert from 'node:assert/strict'
import {
  canCompleteInterview,
  persistedInterviewStatus,
  shouldAutoRetryOpening,
  teacherTurnCount
} from './interview-completion.js'

const openingOnly = [{ role: 'ai', text: '您当时会先关注什么？' }]
const answered = [...openingOnly, { role: 'teacher', text: '我会先观察孩子。' }]

assert.equal(teacherTurnCount(openingOnly), 0)
assert.equal(canCompleteInterview(openingOnly), false)
assert.equal(persistedInterviewStatus(true, openingOnly), 'in_progress')
assert.equal(persistedInterviewStatus(true, answered), 'done')
assert.equal(shouldAutoRetryOpening('upstream_http_error', 0, openingOnly), true)
assert.equal(shouldAutoRetryOpening('invalid_provider_output', 1, openingOnly), false)
assert.equal(shouldAutoRetryOpening('model_mismatch', 0, openingOnly), false)
assert.equal(shouldAutoRetryOpening('upstream_http_error', 0, answered), false)

console.log('interview completion checks: 8/8')
