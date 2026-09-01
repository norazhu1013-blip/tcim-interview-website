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
import { initTcisSession, processTeacherTurn, tcimData, checkConstraints } from './engine.js'

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

async function run() {
for (const [itemId, answer] of Object.entries(tcimData.items)) {
  total += 1
  const idx = parseInt(itemId.slice(1), 10) - 1
  const teacherAnswer = SAMPLE_ANSWERS[idx] || SAMPLE_ANSWERS[0]
  const session = initTcisSession(itemId, ['A', 'C', 'B', 'D'], [])
  // 首问
  const first = await processTeacherTurn(session, '')
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
    const out = await processTeacherTurn(session, roundAnswers[i] || roundAnswers[roundAnswers.length - 1])
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

  // 1.1：收束时必须把收束语作为 question 返回（防止页面把它当成空消息丢弃，
  // 导致回看/replay/transcripts 缺最后一句收束语）。
  {
    const closingItemId = 'Q1'
    const closingSession = initTcisSession(closingItemId, ['A', 'C', 'B', 'D'], [])
    const closingAnswers = [
      '我会先看看地面湿不滑，篮球架附近有没有别的孩子，水桶会不会弄坏设备。',
      '我还会同时留意孩子是不是投入、会不会互相影响。',
      '如果风险不大我会让他们继续玩，但会提醒他们注意安全。',
      '最后我会再观察一会儿，看处理有没有效果再调整。'
    ]
    let closingQ = ''
    let aiHistoryLast = ''
    let reachedDone = false
    for (let i = 0; i < 40; i += 1) {
      const out = await processTeacherTurn(closingSession, closingAnswers[i % closingAnswers.length])
      if (out.done) {
        reachedDone = true
        closingQ = out.question || ''
        const aiHistory = closingSession.history.filter((h) => h.role === 'ai')
        aiHistoryLast = aiHistory.length ? String(aiHistory[aiHistory.length - 1].text) : ''
        break
      }
    }
    total += 1
    if (!reachedDone) {
      console.error(`✗ 1.1 ${closingItemId} 未能在 40 轮内收束`)
      failures += 1
    } else if (!closingQ.trim() || aiHistoryLast !== closingQ) {
      console.error(`✗ 1.1 收束语未返回页面: question="${closingQ}" aiLast="${aiHistoryLast}"`)
      failures += 1
    } else {
      console.log(`✓ 1.1 ${closingItemId} 收束语返回页面: ${closingQ.slice(0, 12)}…`)
    }
  }

  // 2.5：反事实回答依赖 —— 内容意义不同的回答必须引出不同的下一问（不能只按模板序号轮换）
  {
    async function followupFor(answer) {
      const s = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
      await processTeacherTurn(s, '')
      return processTeacherTurn(s, answer)
    }
    const aRisk = '我会先检查地面湿不滑、篮球架旁边有没有别的孩子、水桶会不会弄坏设备，以及用水范围；然后根据风险大小决定要不要马上处理。'
    const aRule = '我会跟孩子们说明规则是让大家都能安全一起用这个场地，也要保护材料，但不会硬说篮球架只能用来打篮球，还是可以留空间让他们自己想玩法。'
    const rRisk = await followupFor(aRisk)
    const rRule = await followupFor(aRule)
    total += 1
    if (rRisk.actionPlan?.target_slot === rRule.actionPlan?.target_slot) {
      console.error(`✗ 2.5 反事实依赖: 两种回答引出同一槽 ${rRisk.actionPlan?.target_slot}`)
      failures += 1
    } else {
      console.log(`✓ 2.5 反事实依赖: ${rRisk.actionPlan?.target_slot} vs ${rRule.actionPlan?.target_slot}`)
    }
  }

  // 2.5：承接锚点 —— 下一问的 GenerationEvent 必须携带 source_turn_id / anchor_span / followup_reason
  {
    const s = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(s, '')
    await processTeacherTurn(s, '我会先检查地面湿不滑、篮球架旁边有没有别的孩子、根据风险决定怎么处理。')
    const gen = (s.replay || []).reverse().find((e) => e.event === 'GenerationEvent')
    total += 1
    if (!gen || !gen.source_turn_id || !gen.followup_reason || !('anchor_span' in gen)) {
      console.error('✗ 2.5 承接锚点缺失: ' + JSON.stringify(gen && { source_turn_id: gen.source_turn_id, followup_reason: gen.followup_reason, anchor_span: gen.anchor_span }))
      failures += 1
    } else {
      console.log(`✓ 2.5 承接锚点: source_turn_id=${gen.source_turn_id} followup_reason=${gen.followup_reason} anchor=${gen.anchor_span}`)
    }
  }

  // 问句闭环：内容不同的回答必须导致不同的最终问句文本（不只目标槽）
  {
    async function qFor(answer) {
      const s = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
      await processTeacherTurn(s, '')
      return processTeacherTurn(s, answer)
    }
    const aRisk = '我会先检查地面湿不滑、篮球架旁边有没有别的孩子、水桶会不会弄坏设备，根据风险决定怎么处理。'
    const aRule = '我会跟孩子们说明规则是让大家都能安全用场地、也要保护材料，但会留空间让他们自己想玩法。'
    const o1 = await qFor(aRisk)
    const o2 = await qFor(aRule)
    total += 1
    if (o1.question === o2.question || o1.actionPlan?.target_slot === o2.actionPlan?.target_slot) {
      console.error(`✗ 问句闭环: 不同回答未产生不同问句/目标\n   A: ${o1.question}\n   B: ${o2.question}`)
      failures += 1
    } else {
      console.log(`✓ 问句闭环: ${o1.actionPlan?.target_slot} → ${o2.actionPlan?.target_slot}`)
    }
  }

  // 结束一致性：done 时收束语同时进入 history、作为返回 question、并写入 replay GenerationEvent
  {
    const s = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    let done = false
    let closing = ''
    for (let i = 0; i < 40 && !done; i += 1) {
      const out = await processTeacherTurn(s, '我会先观察他们是不是自己发起的游戏，再判断要不要介入。')
      if (out.done) { done = true; closing = out.question || '' }
    }
    const aiHist = s.history.filter((h) => h.role === 'ai').map((h) => h.text)
    const gen = (s.replay || []).filter((e) => e.event === 'GenerationEvent' && e.action_type === 'CLOSE').pop()
    total += 1
    if (!done || !closing || aiHist[aiHist.length - 1] !== closing || !gen || gen.question !== closing) {
      console.error('✗ 结束一致性: done=' + done + ' closing=' + closing + ' genQ=' + (gen && gen.question))
      failures += 1
    } else {
      console.log(`✓ 结束一致性: 收束语=${closing.slice(0, 10)}… 且 history/return/replay 一致`)
    }
  }

  // 修复能力：教师纠正/没听懂 → 下一轮先用修复/重述问句接住，而不是照常进下一模板
  {
    const s = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(s, '')
    const out = await processTeacherTurn(s, '不是，我的意思是我会先看他们是不是自己发起的游戏。')
    const gen = (s.replay || []).reverse().find((e) => e.event === 'GenerationEvent')
    total += 1
    if (gen?.followup_reason !== 'teacher_repair' || !/想说是|没理解/.test(out.question || '')) {
      console.error('✗ 修复能力: reason=' + gen?.followup_reason + ' q=' + out.question)
      failures += 1
    } else {
      console.log(`✓ 修复能力: ${out.question.slice(0, 20)}…`)
    }
    // 对照：正常回答不应误判为修复
    const s2 = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(s2, '')
    const out2 = await processTeacherTurn(s2, '我会先看他们是不是自己发起的游戏。')
    const gen2 = (s2.replay || []).reverse().find((e) => e.event === 'GenerationEvent')
    total += 1
    if (gen2?.followup_reason === 'teacher_repair') {
      console.error('✗ 修复能力误判: 正常回答被判为修复')
      failures += 1
    } else {
      console.log('✓ 修复能力不误判正常回答')
    }
  }

  // 1) multi-question 误判修复：研究团队表4「区分性双问法」是合法措辞，不该被拦截
  {
    const DOUBLE = '这种反复求助可能分别意味着什么？您会怎么区分？' // Q2-S3 typical，2 问号
    const allowed = new Set([DOUBLE.replace(/\s+/g, '')])
    let c = checkConstraints(DOUBLE, {}, [], allowed)
    total += 1
    if (!c.ok || c.issues.includes('multi_question')) {
      console.error('✗ 表4双问法被误判: ' + JSON.stringify(c.issues))
      failures += 1
    } else {
      console.log('✓ 表4双问法放行（Q2-S3 专业措辞）')
    }
    // 普通双问（非预设）仍应拦
    let c2 = checkConstraints('您会先看什么？然后再做什么？', {}, [], allowed)
    total += 1
    if (c2.ok || !c2.issues.includes('multi_question')) {
      console.error('✗ 普通双问未拦截')
      failures += 1
    } else {
      console.log('✓ 普通双问仍拦截')
    }
  }

}

run().then(() => {
  console.log(`\nTCIM smoke: ${total - failures}/${total} 题通过`)
  if (failures) process.exit(1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})
