/** 安全、隐私、明确退出、单问，以及明确标为 HARD_BOUNDARY 的策略是硬边界。 */

import { dialoguePolicyMap } from './contracts.js'

const PRIVACY_REQUEST_RE = /(身份证|身份证号|手机号|电话号码|家庭住址|详细住址|银行卡|支付密码|登录密码|短信验证码|微信号)/i
const UNSAFE_RE = /(忽略安全风险|不用管安全|明知危险.{0,8}(继续|尝试)|伤害自己|伤害他人)/i
const EXIT_RE = /(停止访谈|结束访谈|退出访谈|不想继续|不再回答|先到这里|别再问了)/i

function questionCount(text) {
  return (String(text || '').match(/[？?]/g) || []).length
}

export function isExplicitExit(text) {
  return EXIT_RE.test(String(text || ''))
}

export function validateHardBoundaries({ visibleText, action, boundary, teacherTurn = '', runtimeCard }) {
  const issues = []
  const text = String(visibleText || '').trim()
  const count = questionCount(text)

  if (count > 1) issues.push('multiple_questions')
  if (action === 'CLOSE' && count > 0) issues.push('closing_must_not_ask')
  if (PRIVACY_REQUEST_RE.test(text)) issues.push('privacy_request')
  if (UNSAFE_RE.test(text)) issues.push('unsafe_instruction')
  if (isExplicitExit(teacherTurn) && action !== 'CLOSE') issues.push('exit_not_honored')
  if (boundary?.kind === 'EXIT' && action !== 'CLOSE') issues.push('exit_boundary_must_close')
  if (['SAFETY', 'PRIVACY'].includes(boundary?.kind) && action === 'ASK') issues.push('risk_boundary_must_not_ask')

  if (boundary?.policyId) {
    const policy = dialoguePolicyMap(runtimeCard).get(boundary.policyId)
    if (!policy) issues.push('unknown_boundary_policy')
    else if (boundary.kind !== 'NONE' && policy.type !== 'HARD_BOUNDARY') {
      issues.push('non_hard_policy_cannot_enforce_boundary')
    }
  }

  return { ok: issues.length === 0, issues, questionCount: count }
}

export function safeExitResult(turnId = 'exit') {
  return {
    ok: true,
    hardBoundaryHandled: true,
    turnId,
    action: 'CLOSE',
    visibleText: '好的，本次访谈先到这里。',
    status: 'completed'
  }
}
