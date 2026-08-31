// 对齐一致性校验：同一输入，web 引擎(ESM) vs 小程序 bundle(CJS) → 逐问一致。
// 证明 miniprogram/utils/tcim/engine.js 是从 web 引擎忠实打包的。
import * as webEngine from '../web/src/core/tcim/engine.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const mpEngine = require('../miniprogram/utils/tcim/engine.js')

const ANSWERS = [
  '',
  '我会先检查地面湿不滑、篮球架旁边有没有别的孩子、水桶会不会弄坏设备，根据风险决定怎么处理。',
  '我会先看他们是不是自己发起的游戏，再判断要不要介入。',
  '我会跟孩子们说明规则是让大家都能安全用场地、保护材料，但会留空间让他们自己想玩法。'
]

async function drive(engine) {
  const s = engine.initTcisSession('Q1', ['A', 'C', 'B', 'D'], [], { mean: 3, total: 30 })
  const out = []
  for (const a of ANSWERS) {
    const r = await engine.processTeacherTurn(s, a)
    out.push({ question: r.question, slot: (r.actionPlan && r.actionPlan.target_slot) || '', done: !!r.done })
    if (r.done) break
  }
  return out
}

const web = await drive(webEngine)
const mp = await drive(mpEngine)
console.log('web:', JSON.stringify(web))
console.log('mp :', JSON.stringify(mp))
let ok = JSON.stringify(web) === JSON.stringify(mp)
if (!ok) { console.error('✗ TCIM web/miniprogram 不一致'); process.exit(1) }
console.log(`✓ TCIM 对齐一致（${web.length} 轮逐问相同）`)
