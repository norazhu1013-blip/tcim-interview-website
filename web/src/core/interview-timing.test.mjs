import assert from 'node:assert/strict'
import {
  INTEGRATIVE_QUESTION_TRIGGER_MS,
  WRAP_UP_RESERVE_MS,
  mayStartForegroundGeneration,
  mayStartIntegrativeGeneration,
  shouldRequestIntegrativeQuestion
} from './interview-timing.js'

const checks = []
function check(name, fn) {
  fn()
  checks.push(name)
}

check('整体问题窗口提前到三分半，降低跨窗风险', () => {
  assert.equal(INTEGRATIVE_QUESTION_TRIGGER_MS, 210_000)
  assert.equal(shouldRequestIntegrativeQuestion(205_000, false), true)
  assert.equal(shouldRequestIntegrativeQuestion(211_000, false), false)
})

check('整体问题只触发一次', () => {
  assert.equal(shouldRequestIntegrativeQuestion(150_000, true), false)
})

check('普通追问停止后，仍给最后整体问题保留一个窄生成区间', () => {
  assert.equal(mayStartForegroundGeneration(100_000), false)
  assert.equal(mayStartIntegrativeGeneration(100_000), true)
  assert.equal(shouldRequestIntegrativeQuestion(100_000, false), true)
  assert.equal(mayStartIntegrativeGeneration(WRAP_UP_RESERVE_MS + 5_000), false)
})

console.log(`interview timing checks: ${checks.length}/${checks.length}`)
