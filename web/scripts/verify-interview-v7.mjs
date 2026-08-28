import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const repoRoot = path.resolve(webRoot, '..')
const view = fs.readFileSync(path.join(webRoot, 'src/views/InterviewView.vue'), 'utf8')
const cloud = fs.readFileSync(
  path.join(repoRoot, 'cloudfunctions/gsyg_interviewChat/index.js'),
  'utf8'
)

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`访谈 V7.4 检查失败：缺少 ${label}`)
}

function forbidText(source, text, label) {
  if (source.includes(text)) throw new Error(`访谈 V7.4 检查失败：仍包含 ${label}`)
}

requireText(cloud, 'const MIN_NORMAL_QUESTIONS = 8', '至少 8 个问题的规则')
requireText(cloud, '不存在固定最高问数', '不设固定最高问数的规则')
requireText(cloud, '情境理解图', '访谈前情境理解机制')
requireText(cloud, 'LLM_PROFILES', '网页模型配置组')
requireText(cloud, 'callOpenAICompatible', '第三方模型调用能力')
forbidText(cloud, 'MAX_ANSWERABLE_AI_QUESTIONS', '固定最高问题数')

requireText(view, 'generationPaused', '调用失败后的暂停状态')
requireText(view, 'generationFailures', '生成失败审计记录')
requireText(view, 'retryQuestion', '重新生成入口')
requireText(view, 'endAfterError', '教师主动结束入口')
requireText(view, 'teacherName:', '教师信息传入')
requireText(view, 'remainingMs:', '剩余时间传入')
requireText(view, 'stage:', '访谈状态传入')
requireText(view, 'llmProfile:', '模型配置组传入')
forbidText(view, 'fallbackNext', '固定脚本降级')
forbidText(view, 'buildScriptQueue', '固定脚本队列')
forbidText(view, 'answered.value >= 6', '网页端六问硬截止')

console.log('访谈 V7.4 检查通过：网页与云函数的关键决策机制一致。')
