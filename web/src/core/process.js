export function replayStates(firstRanking, moveLog) {
  const cur = Array.isArray(firstRanking) ? firstRanking.slice() : []
  const states = [cur.slice()]
  for (const move of moveLog || []) {
    if (!move || !move.option) continue
    const index = cur.indexOf(move.option)
    if (index >= 0) cur.splice(index, 1)
    const to = Math.max(0, Math.min(cur.length, (Number(move.to_pos) || 1) - 1))
    cur.splice(to, 0, move.option)
    states.push(cur.slice())
  }
  return states
}

export function swingOf(states, pos) {
  const sequence = states.map((state) => state[pos]).filter(Boolean)
  let changes = 0
  for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) changes++
  return { sequence, changes, swing: changes > 0, strong: changes >= 2 }
}

export function hasOscillation(states) {
  const letters = ['A', 'B', 'C', 'D']
  return letters.some((letter) => {
    const positions = states.map((state) => state.indexOf(letter)).filter((n) => n >= 0)
    let previousDirection = 0
    for (let i = 1; i < positions.length; i++) {
      const direction = Math.sign(positions[i] - positions[i - 1])
      if (direction && previousDirection && direction !== previousDirection) return true
      if (direction) previousDirection = direction
    }
    return false
  })
}

export function computeProcess(item = {}) {
  const states = replayStates(item.first_ranking, item.move_log)
  const first = swingOf(states, 0)
  const last = swingOf(states, states[0]?.length - 1)
  return {
    states,
    firstSwing: first,
    lastSwing: last,
    modificationCount: (item.move_log || []).length,
    oscillation: hasOscillation(states),
    durationMs: Number(item.duration_ms) || 0
  }
}
