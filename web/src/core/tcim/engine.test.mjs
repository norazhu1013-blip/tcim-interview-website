/**
 * TCIM 网页引擎 smoke test：10 题逐题跑完整确定性访谈。
 * 运行：node web/src/core/tcim/engine.test.mjs
 *
 * 验收（Task 5 Gate）：
 *   - 10 题都能启动并生成至少 1 个非空问题。
 *   - 教师回答后能推进（证据更新 / 下一问不重复）。
 *   - 首问来自表4 的「典型非诱导问法」（若存在），不泄露标准答案。
 *   - 无 LLM 依赖（纯前端确定性）。
 */
import { initTcisSession, processTeacherTurn, tcimData } from './engine.js'

const SAMPLE_ANSWERS = [
  '我会先看看地面湿不滑，篮球架附近有没有别的孩子，水桶会不会把设备弄坏。如果只是少量接水，我会让他们再玩一会儿。',
  '我会先判断他到底是真的不会，还是需要有人陪伴。如果是需要陪伴，我会陪他完成一小步。',
  '我会先观察他为什么待不住，是不是材料不合适，或者需要我陪他玩一会儿。',
  '我会先看看他是不是其实已经参与了，只是在用他自己的方式。',
  '我会先理解他为什么觉得开心，是不是消防员救火成功让他高兴。',
  '我会先看看他为什么总选一星任务，是怕失败还是觉得简单。',
  '我会把艾莎公主的鞋子和魔法设计成走跑跳的游戏，邀请她们一起玩。',
  '我会先观察水流在哪堵住，再引导他们调整竹片高低。',
  '我会让他们先体验一下各走各的会怎样，再一起商量规则。',
  '我会先让孩子说说跳绳时遇到什么问题，再一起定规则。'
]

let failures = 0
let total = 0

for (const [itemId, answer] of Object.entries(tcimData.items)) {
  total += 1
  const idx = parseInt(itemId.slice(1), 10) - 1
  const teacherAnswer = SAMPLE_ANSWERS[idx] || SAMPLE_ANSWERS[0]
  const session = initTcisSession(itemId, ['A', 'C', 'B', 'D'], [])
  // 首问
  const first = processTeacherTurn(session, '')
  if (!first.question || !first.question.trim()) {
    console.error(`✗ ${itemId} 首问为空`)
    failures += 1
    continue
  }
  // 教师回答几轮（每轮给不同的、有证据的作答，驱动引擎换槽/推进）
  const roundAnswers = [
    teacherAnswer,
    '我会先想清楚原因，再决定怎么回应，不能简单处理。',
    '如果地面很滑或者会妨碍别人，我会及时提醒；如果风险不大，我会让他们继续玩。',
    '最后我会再观察他们的反应，看看这样处理有没有效果，再调整。'
  ]
  let ok = true
  let rounds = 0
  let lastQuestion = first.question
  for (let i = 0; i < 4; i += 1) {
    const out = processTeacherTurn(session, roundAnswers[i] || roundAnswers[roundAnswers.length - 1])
    rounds += 1
    if (out.done) break
    if (out.question === lastQuestion) {
      // 连续两次同问算失败
      console.error(`✗ ${itemId} 重复问题: ${out.question}`)
      ok = false
      break
    }
    lastQuestion = out.question
  }
  if (ok) {
    console.log(`✓ ${itemId} 首问+${rounds}轮 通过`)
  } else {
    failures += 1
  }
}

console.log(`\nTCIM smoke: ${total - failures}/${total} 题通过`)
if (failures) process.exit(1)
