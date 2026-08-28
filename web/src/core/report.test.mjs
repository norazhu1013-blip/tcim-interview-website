// report.js 测试：确定性能力画像报告
import { buildReport, compareReports, buildReportText, TERTIARY_INDICATORS, SECONDARY_INDICATORS } from './report.js'

function mockSession() {
  const perItem = { Q1: 4, Q2: 3, Q3: 2, Q4: 4, Q5: 4, Q6: 3, Q7: 3, Q8: 2, Q9: 3, Q10: 3 }
  return {
    sessionId: 's1',
    scores: {
      perItem,
      total: Object.values(perItem).reduce((a, b) => a + b, 0),
      mean: 3.1,
      level: '中高水平'
    },
    answers: {
      Q1: { final_ranking: ['A', 'B', 'C', 'D'], duration_ms: 120000, move_log: [{ option: 'B', to_pos: 2 }] },
      Q2: { final_ranking: ['C', 'B', 'A', 'D'], duration_ms: 90000, move_log: [] }
    },
    selection: {
      final: [
        { id: 'Q1', task_card: { ability_focus: { interview_main_focus: '教师能否顺应幼儿自主生成的玩水游戏' } } },
        { id: 'Q5', task_card: { ability_focus: { interview_main_focus: '教师能否理解幼儿游戏中的价值' } } },
        { id: 'Q4', task_card: { ability_focus: { interview_main_focus: '教师能否把个人发现转化为共同资源' } } }
      ]
    },
    interview: {
      Q1: { status: 'done', messages: [{ role: 'ai', text: '您会先看什么？' }, { role: 'teacher', text: '我会先看他们玩得开不开心，游戏是不是他们自己想出来的' }] },
      Q5: { status: 'done', messages: [{ role: 'ai', text: '您怎么看？' }, { role: 'teacher', text: '我觉得游戏是孩子自己的活动，我主要是支持' }] }
    }
  }
}

let failures = 0
function check(name, fn) {
  try { fn(); console.log('PASS', name) }
  catch (e) { console.error('FAIL', name, '—', e.message); failures++ }
}

const r = buildReport(mockSession())

check('三级指标有 7 项且都带分数', () => {
  if (r.tertiary.length !== 7) throw new Error('tertiary 长度=' + r.tertiary.length)
  if (!r.tertiary.every((t) => typeof t.score === 'number' && t.code)) throw new Error('tertiary 字段缺失')
})
check('二级指标为 A/B/C 且分数在 0-4', () => {
  if (r.secondary.length !== 3) throw new Error('secondary 长度=' + r.secondary.length)
  if (!r.secondary.every((s) => s.score >= 0 && s.score <= 4)) throw new Error('secondary 分数越界: ' + JSON.stringify(r.secondary.map((x) => x.score)))
})
check('过程解释含作答题数与用时', () => {
  if (!/完成/.test(r.process.text) || !/分钟/.test(r.process.text)) throw new Error('过程文本: ' + r.process.text)
})
check('访谈证据回填引用已访谈情境(含教师原话)', () => {
  if (!r.evidence.length) throw new Error('无证据')
  if (!r.evidence.some((e) => e.itemId === 'Q1' && e.quote.includes('开不开心'))) throw new Error('缺少 Q1 教师原话证据')
})
check('学习建议非空且非评判', () => {
  if (!r.suggestions.length) throw new Error('建议为空')
  if (r.suggestions.some((s) => /(很差|不好|不合格)/.test(s.direction))) throw new Error('出现评判词')
})
check('三级指标水平分层正确(高指标较充分)', () => {
  const a1 = r.tertiary.find((t) => t.code === 'A1')
  const c2 = r.tertiary.find((t) => t.code === 'C2')
  if (!a1 || !c2) throw new Error('缺少 A1/C2')
  if (a1.score <= c2.score) throw new Error('A1 不应低于 C2(主/次得分占比不同)')
})

check('三源来源标签: 有访谈证据的指标标注"测评+访谈",无的为"测评为主"', () => {
  const c2 = r.tertiary.find((t) => t.code === 'C2')  // mock 访谈含 Q1/Q4(C2) → 应为 both
  const b1 = r.tertiary.find((t) => t.code === 'B1')  // mock 访谈未含 B1 → score
  if (!c2 || c2.source !== '测评 + 访谈') throw new Error('C2 source=' + (c2 && c2.source))
  if (!b1 || b1.source !== '测评定位为主') throw new Error('B1 source=' + (b1 && b1.source))
})

// 跨次成长对比 + 导出
const rA = r
const rB = buildReport({ ...mockSession(), scores: { ...mockSession().scores, perItem: { ...mockSession().scores.perItem, Q1: 2, Q5: 2 } } })
const cmp = compareReports(rA, rB)
check('跨次对比：能算出三指标差异且给出提升/变化摘要', () => {
  if (cmp.rows.length !== 7) throw new Error('cmp.rows 长度=' + cmp.rows.length)
  if (cmp.rows.every((x) => x.diff === null)) throw new Error('无 diff')
  if (!/提升/.test(cmp.summary)) throw new Error('summary: ' + cmp.summary)
})

const text = buildReportText(rA, {})
check('导出文本：含概览/二级/三级/建议且不泄露评分规则', () => {
  if (!text.includes('# 能力画像报告')) throw new Error('缺标题')
  if (!text.includes('## 三个二级指标')) throw new Error('缺二级')
  if (!text.includes('## 七个三级指标')) throw new Error('缺三级')
  if (!text.includes('不暴露标准排序')) throw new Error('缺不泄露声明')
})

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1) }
console.log('\nreport 检查全部通过。')
