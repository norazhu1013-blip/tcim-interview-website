/**
 * 过程指标计算：replayStates / swingOf / hasOscillation / computeProcess（口径见 CLAUDE.md §5）。
 *
 * 关键口径（CLAUDE.md 第 5 节，勿退回简化版）：
 *  - 必须回放 move_log：从 first_ranking 起，逐步“移除该选项→插入到 to_pos”，重建每一步完整排序。
 *    为对埋点误差鲁棒，忽略 from_pos，只用 option + to_pos 定位。
 *  - 首/末位摇摆：取各步首/末位序列数变更次数，≥1=摇摆、≥2=强摇摆，输出路径如 D→A→C；
 *    不可用“首≠尾”简化（会漏 D→A→D 这类变回原样的摇摆）。
 *  - 路径振荡：任一选项的位次序列出现方向反转（先上后下/先下后上）即判定。
 *  - 评分不依赖以上任何过程指标；它们只用于 P 分筛选、访谈过程增强、限时控制。
 */
const { SELECTION_RULES } = require('../data/knowledge.js');
const TH = SELECTION_RULES.process_thresholds;

/**
 * 回放 move_log，返回每一步的完整排序数组。
 * @param {string[]} firstRanking 初始排序，如 ['D','A','B','C']
 * @param {Array} moveLog [{ option, to_pos }...]（to_pos 为 1 基位次）
 */
function replayStates(firstRanking, moveLog) {
  let cur = (firstRanking || []).slice();
  const states = [cur.slice()];
  (moveLog || []).forEach((m) => {
    const opt = m.option != null ? m.option : m.o;
    const toPos = m.to_pos != null ? m.to_pos : m.t;
    const from = cur.indexOf(opt);
    if (from > -1) cur.splice(from, 1);
    const to = Math.max(0, Math.min(cur.length, (toPos || 1) - 1));
    cur.splice(to, 0, opt);
    states.push(cur.slice());
  });
  return states;
}

/** 首/末位摇摆：pos = 'top' | 'bottom' */
function swingOf(states, pos) {
  const seq = states.map((s) => (pos === 'top' ? s[0] : s[s.length - 1]));
  const path = seq.filter((v, i) => i === 0 || v !== seq[i - 1]);
  const changes = path.length - 1;
  return { changes, path: path.join('→'), swing: changes >= 1, strong: changes >= 2 };
}

/** 路径振荡：任一选项位次序列出现方向反转 */
function hasOscillation(states) {
  if (!states.length) return false;
  for (const o of states[0]) {
    const p = states.map((s) => s.indexOf(o));
    for (let i = 1; i < p.length - 1; i++) {
      const d1 = p[i] - p[i - 1];
      const d2 = p[i + 1] - p[i];
      if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) return true;
    }
  }
  return false;
}

/**
 * 依据一道题的过程埋点，计算过程标签 + P-IVI（异常项数，≥2 为强访谈线索）。
 * @param {object} item answers[itemId]：{ first_ranking, final_ranking, move_log, revise_count, duration_ms, focus_dwell }
 */
function computeProcess(item) {
  if (!item) return { pivi: 0, tags: [], topPath: '', botPath: '', osc: false };
  const tags = [];
  let anom = 0;

  const states = replayStates(item.first_ranking, item.move_log);

  const top = swingOf(states, 'top');
  if (top.strong) { tags.push('首位强摇摆(' + top.path + ')'); anom++; }
  else if (top.swing) { tags.push('首位摇摆(' + top.path + ')'); anom++; }

  const bot = swingOf(states, 'bottom');
  if (bot.swing) { tags.push('末位摇摆(' + bot.path + ')'); anom++; }

  const osc = hasOscillation(states);
  if (osc) { tags.push('路径振荡'); anom++; }

  const revise = item.revise_count || 0;
  if (revise >= TH.revise_strong) { tags.push('高修正投入'); anom++; }
  else if (revise >= TH.revise_enhance) { tags.push('多次修改'); anom++; }

  const dur = item.duration_ms || 0;
  if (dur >= TH.dur_p90_ms) { tags.push('长时权衡'); anom++; }
  else if (dur >= TH.dur_p75_ms) { tags.push('偏长'); anom++; }
  if (dur > 0 && dur < TH.dur_p25_ms && revise === 0) { tags.push('极快作答'); anom++; }

  // 关键停顿点：某选项聚焦远超其他（不计入 P-IVI，仅作线索标签）
  const dwell = item.focus_dwell;
  if (dwell) {
    const dw = Object.keys(dwell).map((k) => [k, dwell[k]]).sort((a, b) => b[1] - a[1]);
    if (dw.length >= 2 && dw[0][1] >= dw[1][1] * 1.6) tags.push(dw[0][0] + '停顿长');
  }

  return { pivi: anom, tags, topPath: top.path, botPath: bot.path, osc };
}

module.exports = { replayStates, swingOf, hasOscillation, computeProcess };
