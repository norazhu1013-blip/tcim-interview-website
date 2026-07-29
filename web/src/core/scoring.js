import { SCORE_TABLE } from '../generated/data.js'

export function scoreOne(itemId, ranking) {
  const key = (ranking || []).join('>')
  const table = SCORE_TABLE[itemId]
  return table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null
}

export function levelOf(mean) {
  if (mean >= 3.5) return '高水平'
  if (mean >= 2.5) return '中高水平'
  if (mean >= 1.5) return '中等水平'
  if (mean >= 0.5) return '偏低水平'
  return '低水平'
}

export function computeScores(answers, itemIds) {
  const perItem = {}
  let total = 0
  for (const itemId of itemIds) {
    const answer = answers[itemId]
    const score = scoreOne(itemId, answer && answer.final_ranking)
    perItem[itemId] = score
    total += Number(score) || 0
  }
  const mean = itemIds.length ? total / itemIds.length : 0
  const rd = {}
  for (const itemId of itemIds) rd[itemId] = (Number(perItem[itemId]) || 0) - mean
  return { perItem, total, mean, level: levelOf(mean), rd }
}
