export const INTERVIEW_DURATION_MS = 10 * 60 * 1000
export const WRAP_UP_RESERVE_MS = 90 * 1000
export const FOREGROUND_GENERATION_GUARD_MS = 15 * 1000
// 整体理解问题只能在教师提交一轮回答后自然出现，因此采用约两分钟的
// 触发窗口，而不是依赖某个精确秒点；窗口下沿仍服从前台生成保护线。
export const INTEGRATIVE_QUESTION_TRIGGER_MS = 150 * 1000

export function interviewTimePhase(remainingMs) {
  const value = Math.max(0, Number(remainingMs || 0))
  if (value <= 0) return 'EXPIRED'
  if (value <= WRAP_UP_RESERVE_MS) return 'WRAP_UP'
  return 'DIALOGUE'
}

/**
 * 不在可能侵占收尾窗口时启动一次新的前台模型调用。已有问题允许教师答完，
 * 该回答会作为最后一轮写入并在后台继续完成 Evidence 分析。
 */
export function mayStartForegroundGeneration(remainingMs) {
  return Number(remainingMs || 0) > WRAP_UP_RESERVE_MS + FOREGROUND_GENERATION_GUARD_MS
}

export function shouldRequestIntegrativeQuestion(remainingMs, alreadyAsked = false) {
  const value = Number(remainingMs || 0)
  return !alreadyAsked
    && value <= INTEGRATIVE_QUESTION_TRIGGER_MS
    && mayStartForegroundGeneration(value)
}

export const WRAP_UP_NOTICE = '已进入收尾阶段。请完成当前想法；提交后系统将保存这段回答，不再发起新的专业追问。'
