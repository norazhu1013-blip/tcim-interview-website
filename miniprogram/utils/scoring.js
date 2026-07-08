/**
 * 确定性评分（查表）+ 派生统计 + R/P/G 自动筛选 3 题。
 * 严禁任何“智能判断”：分数只来自赋分表查表 + 算术（CLAUDE.md 红线 1）。
 * selectThree 实现 R/P/G 三路筛选（口径见 CLAUDE.md §5.1/5.2 与 4_selection_rules）。
 */
const { SCORES } = require('../data/scoreTable.js');
const { MAP } = require('../data/indicatorMap.js');
const { SELECTION_RULES } = require('../data/knowledge.js');
const { computeProcess } = require('./process.js');

/** 单题查表：排序数组 → 排列串 → 0-4 分。查不到返回 null（口径不一致时应显式暴露）。 */
function scoreOne(itemId, ranking) {
  const table = SCORES[itemId];
  if (!table) return null;
  const key = (ranking || []).join('>');
  const v = table[key];
  return v == null ? null : v;
}

/** 总体水平文案（依个人均分，非常模；仅供展示） */
function levelOf(mean) {
  if (mean >= 3.5) return '优秀';
  if (mean >= 3) return '中上';
  if (mean >= 2) return '中等';
  if (mean >= 1) return '偏低';
  return '待提升';
}

/**
 * 计算整场评分。
 * @param {object} answers itemId -> { final_ranking }
 * @param {string[]} itemIds 参与计分的题号顺序
 */
function computeScores(answers, itemIds) {
  const perItem = {};
  const vals = [];
  itemIds.forEach((id) => {
    const a = answers[id];
    const sc = a ? scoreOne(id, a.final_ranking) : null;
    perItem[id] = sc;
    if (sc != null) vals.push(sc);
  });
  const total = vals.reduce((a, b) => a + b, 0);
  const mean = vals.length ? total / vals.length : 0;
  const rd = {};
  itemIds.forEach((id) => {
    if (perItem[id] != null) rd[id] = perItem[id] - mean;
  });
  return {
    perItem,
    total,
    max: vals.length * 4,
    mean: Number(mean.toFixed(2)),
    rd,
    level: levelOf(mean)
  };
}

/**
 * R/P/G 自动筛选(最终 3 题,非最低分题)。
 *
 * @deprecated 从 2026-07-08 起,遴选改由云函数 gsyg_selectFinal(advisor_port + 常模)完成。
 * 本函数已不在提交流程中使用(exam.js doSubmit 已移除调用),保留仅供:
 *   ①单元测试参考;②未来极端离线场景兜底(尚未启用)。
 * 端上单教师用此简化版:P 只按阈值触发计数(非跨教师百分位),口径与研究版不一致。
 *
 * @param {object} scores computeScores 结果
 * @param {object} answers itemId -> 过程埋点
 * @param {string[]} itemIds 候选题号
 */
function selectThree(scores, answers, itemIds) {
  const rules = SELECTION_RULES;
  const finalCount = Math.min(rules.merge.final_count, itemIds.length);

  const items = itemIds.map((id) => {
    const proc = computeProcess(answers[id]);
    const m = MAP[id] || { primary: { secondary: '?', tertiary: '?' } };
    return {
      id,
      score: scores.perItem[id] != null ? scores.perItem[id] : 0,
      sec: m.primary.secondary,
      ter: m.primary.tertiary,
      pivi: proc.pivi,
      tags: proc.tags,
      rd: scores.rd[id] != null ? scores.rd[id] : 0
    };
  });

  const abs = (x) => Math.abs(x);
  const R = items.slice().sort((a, b) => abs(b.rd) - abs(a.rd)).slice(0, rules.R.pick);
  const P = items.slice().sort((a, b) => b.pivi - a.pivi).slice(0, rules.P.pick);
  const G = items
    .filter((it) => abs(it.rd) >= 1 && it.pivi >= 1)
    .sort((a, b) => (abs(b.rd) + b.pivi) - (abs(a.rd) + a.pivi))
    .slice(0, rules.G.pick);

  // 合并去重
  const poolIds = Array.from(new Set([].concat(R, P, G).map((x) => x.id)));
  const pool = poolIds.map((id) => items.find((i) => i.id === id));

  // 覆盖校验：尽量不选 3 道同主二级指标
  pool.sort((a, b) => abs(b.rd) - abs(a.rd));
  const distinctSec = new Set(pool.map((p) => p.sec)).size;
  const final = [];
  const usedSec = {};
  for (const it of pool) {
    if (final.length >= finalCount) break;
    if ((usedSec[it.sec] || 0) >= 2 && distinctSec > 1) continue; // 保覆盖，跳过同质
    final.push(it);
    usedSec[it.sec] = (usedSec[it.sec] || 0) + 1;
  }
  // 不足则从全部题补齐
  while (final.length < finalCount) {
    const add = items.find((it) => !final.includes(it));
    if (!add) break;
    final.push(add);
  }

  const inRoute = (route, id) => route.some((x) => x.id === id);
  const finalWithSrc = final.slice(0, finalCount).map((it) => {
    const sources = [];
    if (inRoute(R, it.id)) sources.push('R分·结果偏离');
    if (inRoute(P, it.id)) sources.push('P分·过程异常');
    if (inRoute(G, it.id)) sources.push('G分·结果×过程');
    return Object.assign({}, it, { sources: sources.length ? sources : ['覆盖增补'] });
  });

  return {
    final: finalWithSrc,
    routes: {
      R: R.map((x) => x.id),
      P: P.map((x) => x.id),
      G: G.map((x) => x.id)
    }
  };
}

module.exports = { scoreOne, computeScores, selectThree, levelOf };
