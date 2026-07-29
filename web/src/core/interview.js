import { KB } from '../generated/data.js'

export function triggerMatches(ranking, cond) {
  if (!ranking?.length || !cond) return false
  const atoms = []
  const top = ranking[0]
  const bottom = ranking[ranking.length - 1]
  const idx = (letter) => ranking.indexOf(letter)
  for (const letter of ['A', 'B', 'C', 'D']) {
    if (new RegExp(`${letter}(?:排)?首位|${letter}首(?![位A-Za-z])`).test(cond)) atoms.push(top === letter)
    if (new RegExp(`${letter}(?:排)?末位|${letter}末(?![位A-Za-z])`).test(cond)) atoms.push(bottom === letter)
    if (new RegExp(`${letter}(?:明显)?靠前|${letter}前置|${letter}不在末位`).test(cond)) atoms.push(idx(letter) >= 0 && idx(letter) <= 1)
    if (new RegExp(`${letter}(?:明显)?靠后|${letter}后置|${letter}被压低|${letter}明显排在`).test(cond)) atoms.push(idx(letter) >= 2)
  }
  return atoms.some(Boolean)
}

export function buildScriptQueue(itemId, ranking) {
  const kb = KB[itemId]
  if (!kb) return []
  const trigger = (kb.triggers || [])
    .filter((item) => triggerMatches(ranking, item.result_cond))
    .sort((a, b) => b.prio - a.prio)[0] || kb.triggers?.[0]
  return ((trigger && trigger.scripts) || ['Q1'])
    .map((code) => ({ code, ...kb.scripts[code] }))
    .filter((item) => item.q)
}

export function stopScript(itemId) {
  return KB[itemId]?.scripts?.['Q-stop']?.q || '感谢您的分享，本情境的访谈先到这里。'
}

export function kbSlice(itemId) {
  const kb = KB[itemId] || {}
  return {
    core_orientation: kb.core_orientation || '',
    triggers: (kb.triggers || []).map(({ code, result_cond, target }) => ({ code, result_cond, target })),
    scripts: Object.entries(kb.scripts || {}).map(([code, item]) => ({ code, q: item.q, E: item.E })),
    evidence: (kb.evidence_points || []).map(({ code, name }) => ({ code, name }))
  }
}
