import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreOne as webScoreOne } from '../src/core/scoring.js'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const mini = require(resolve(here, '../../miniprogram/utils/scoring.js'))
const scoreData = require(resolve(here, '../../miniprogram/data/scoreTable.js'))

let checked = 0
for (const [itemId, table] of Object.entries(scoreData.SCORES)) {
  for (const key of Object.keys(table)) {
    const ranking = key.split('>')
    const a = mini.scoreOne(itemId, ranking)
    const b = webScoreOne(itemId, ranking)
    if (a !== b) throw new Error(`${itemId} ${key}: mini=${a}, web=${b}`)
    checked++
  }
}
console.log(`评分一致性通过：${checked} 个“题目×排列”结果完全一致。`)
