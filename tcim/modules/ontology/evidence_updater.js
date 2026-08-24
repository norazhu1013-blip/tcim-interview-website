'use strict';

/**
 * EvidenceUpdater —— 依据锚点表（表2）判断教师原话达到哪一级证据（02-1 第7节）。
 *
 * 原则：
 *   - 前测只是 prior，不直接填充等级。
 *   - 允许不升级：回答长、说得好听、术语多、表达流畅不得自动升级。
 *   - 冲突证据保留 supporting + conflicting，并提高冲突处理优先级。
 *   - 每个证据变化必须回指 teacher_quote/span。
 *
 * 匹配策略（V0.1 规则版）：
 *   「规范化 bigram 覆盖率」：把教师原话和锚点描述都切成相邻 2 字 bigram，
 *   用领域同义词表把口语说法归一为专业概念，再算教师 bigram 覆盖锚点 bigram 的比率。
 *   命中率超过阈值才升级；只允许向更高等级升级。
 */

// 领域同义词 → 专业概念（覆盖本题域核心词：幼儿/风险/器械/介入/游戏/规则/场地/用水/观察/转场）
const SYNONYMS = {
  幼儿: '幼儿', 孩子: '幼儿', 小朋友: '幼儿', 宝贝: '幼儿',
  滑: '湿滑', 湿滑: '湿滑', 地面: '地面', 地滑: '湿滑',
  设备: '器械', 器材: '器械', 篮球架: '器械',
  风险: '风险', 危险: '风险', 安全: '风险',
  介入: '介入', 干预: '介入', 制止: '介入', 提醒: '介入',
  游戏: '游戏', 玩法: '游戏', 玩水: '用水', 接水: '用水', 灌水: '用水',
  规则: '规则', 规矩: '规则', 秩序: '规则',
  场地: '场地', 地方: '场地', 区域: '场地',
  他人: '他人', 别人: '他人', 其他: '他人',
  观察: '观察', 关注: '观察',
  转场: '转场', 迁移: '转场',
  自主: '自主', 生成: '生成', 尊重: '尊重'
};

const STOP_BIGRAMS = new Set(['我们', '你们', '他们', '这个', '那个', '可以', '应该', '就是', '还是', '如果', '但是', '因为', '所以', '什么', '怎么', '然后', '以及', '或者', '是否', '还有', '没有', '不是', '不会', '一个', '自己', '觉得', '的话', '时候', '当时', '之后', '之前', '这样', '那样', '事情', '情况', '方面']);

function splitBlocks(text) {
  return String(text || '').replace(/[，。！？；：、""''（）()“”‘’\s]/g, '|').split('|').filter((b) => b.length >= 2);
}

function bigramsOf(text) {
  const blocks = splitBlocks(text);
  const out = new Set();
  for (const block of blocks) {
    for (let i = 0; i < block.length - 1; i += 1) {
      out.add(block.slice(i, i + 2));
    }
  }
  return out;
}

/** 规范化：每个 2 字 bigram 若命中同义词表则替换为专业概念。 */
function normalizeBigrams(bigrams) {
  const out = new Set();
  for (const bg of bigrams) {
    const canon = SYNONYMS[bg];
    if (canon) out.add(canon);
    else if (!STOP_BIGRAMS.has(bg)) out.add(bg);
  }
  return out;
}

function buildKeywords(anchorText) {
  return normalizeBigrams(bigramsOf(anchorText));
}

function overlapCount(text, keywords) {
  const teacherSet = normalizeBigrams(bigramsOf(text));
  const kwCount = keywords && typeof keywords.size === 'number' ? keywords.size : (Array.isArray(keywords) ? keywords.length : 0);
  if (!teacherSet.size || !kwCount) return 0;
  let hit = 0;
  for (const kw of keywords) {
    if (teacherSet.has(kw)) hit += 1;
  }
  return hit;
}

/**
 * 对单个 slot 评估教师回答的证据级别。
 * 只允许向更高等级升级。
 * 门槛：命中率 >= RATE_MIN(0.18) 且绝对命中数 >= HITS_MIN(3)。
 * 这样既识别真实专业证据（Q1-S2 具体风险答 4+ hits），又阻止
 * 「长而无具体证据」（泛泛覆盖 游戏/幼儿/场地/安全 等通用词）与「空话」升级。
 * @returns {{ level, confidence, matched, hitRates }}
 */
const RATE_MIN = 0.15;
const HITS_MIN = 3;

function assessSlot(teacherTurn, anchor, currentLevel = 0) {
  if (!anchor) return { level: currentLevel, confidence: 0, matched: false, hitRates: {} };
  const levels = [
    { level: 0, text: anchor.level_0 },
    { level: 1, text: anchor.level_1 },
    { level: 2, text: anchor.level_2 },
    { level: 3, text: anchor.level_3 }
  ];
  const hitRates = {};
  let best = currentLevel;
  let bestHit = 0;
  for (const lv of levels) {
    if (lv.level === 0) continue; // 0 是基线状态，不作为「升级」候选
    const kws = buildKeywords(lv.text);
    const hits = overlapCount(teacherTurn, kws);
    const kwCount = kws && typeof kws.size === 'number' ? kws.size : 0;
    const rate = kwCount ? hits / kwCount : 0;
    hitRates[lv.level] = rate;
    if (rate >= RATE_MIN && hits >= HITS_MIN && lv.level > best && hits > bestHit) {
      best = lv.level;
      bestHit = hits;
    }
  }
  const matched = best > currentLevel;
  const confidence = matched ? Math.min(1, bestHit / 4 + 0.3) : (currentLevel > 0 ? 0.4 : 0);
  return { level: best, confidence, matched, hitRates };
}

// 状态 helper：避免与 evidence_state 循环依赖
function statusFromLevel(level) {
  if (level <= 0) return 'UNKNOWN';
  if (level === 1) return 'PARTIAL';
  if (level === 2) return 'SUFFICIENT';
  return 'HIGH_QUALITY';
}

/**
 * 完整更新一批 slot。返回新的 evidence_state（Ontology owner 应用后写回）。
 * @param {object} evidenceState 当前状态
 * @param {object} anchorsBySlot { slotId: { level_0..3, conflict_evidence } }
 * @param {string} teacherTurn 教师原话
 * @param {string} turnId
 * @param {string[]} evaluateSlotIds 本轮评估的 slot（通常为核心未剪枝槽）
 * @returns {{ state, updates }}
 */
function updateEvidence(evidenceState, anchorsBySlot, teacherTurn, turnId, evaluateSlotIds) {
  const state = JSON.parse(JSON.stringify(evidenceState));
  const updates = [];
  for (const slotId of evaluateSlotIds || []) {
    const anchor = anchorsBySlot[slotId];
    if (!anchor) continue;
    const current = state[slotId];
    if (!current) continue;
    const before = JSON.parse(JSON.stringify(current));
    const { level, confidence, matched } = assessSlot(teacherTurn, anchor, current.level);

    // 冲突检测：教师原话命中 conflict_evidence 的 bigram（至少 1 个专业概念）
    const conflictKeywords = buildKeywords(anchor.conflict_evidence || '');
    const conflictCount = conflictKeywords && typeof conflictKeywords.size === 'number' ? conflictKeywords.size : 0;
    const hasConflict = conflictCount > 0 && overlapCount(teacherTurn, conflictKeywords) >= 1;

    if (matched) {
      // 升级：加入 supporting span，更新 level/confidence/status
      state[slotId].level = level;
      state[slotId].status = statusFromLevel(level);
      state[slotId].confidence = confidence;
      state[slotId].last_updated_turn = turnId;
      if (!state[slotId].supporting_spans.includes(teacherTurn)) {
        state[slotId].supporting_spans.push(teacherTurn);
      }
    } else if (level < current.level) {
      // 教师新回答落到比当前更低的锚点 → 视为冲突（保留两种解释）：加 conflicting，降置信
      state[slotId].confidence = Math.max(0.2, current.confidence - 0.3);
      if (!state[slotId].conflicting_spans.includes(teacherTurn)) {
        state[slotId].conflicting_spans.push(teacherTurn);
      }
    } else if (hasConflict && current.level > 0) {
      // 命中明确冲突证据：加 conflicting，降置信
      state[slotId].confidence = Math.max(0.2, current.confidence - 0.2);
      if (!state[slotId].conflicting_spans.includes(teacherTurn)) {
        state[slotId].conflicting_spans.push(teacherTurn);
      }
    }

    const after = state[slotId];
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed) {
      updates.push({
        slot_id: slotId,
        before: { level: before.level, confidence: before.confidence },
        after: { level: after.level, confidence: after.confidence, probe_status: after.probe_status },
        quote: teacherTurn,
        reason: matched ? `anchor_level_${level}` : (level < before.level ? 'conflict_downgrade' : (hasConflict ? 'conflict_added' : 'no_change'))
      });
    }
  }
  return { state, updates };
}

/*
 * ========================================================================
 * TCIM_SEMANTIC_MODE 语义主路径（Milestone 2）：Validator + Committer + bigramFallback
 * ========================================================================
 * 目标：LLM 和规则 fallback 都产出「同一 Proposal Schema（slot_evidence_proposals）」，
 *       经过同一个 Validator（只查合法性，不重新裁决）→ 同一个 Committer（唯一写 evidence_state）。
 *       `updateEvidence` 保留用于 `disabled` 模式（规则基线）或 RULE_FALLBACK 兜底。
 */

// A01 Proposal 形状（与 cloudfs/gsyg_semanticProbe/semantic_core.js 一致）
const clampLevel = (n) => (Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0);
const clamp01 = (n) => Math.max(0, Math.min(1, typeof n === 'number' ? n : 0));

/**
 * Validator：只验证 Proposal 的合法性，绝不再用 bigram 做语义裁决。
 * @param {object} proposal 已 normalize 的 Proposal（含 slot_evidence_proposals）
 * @param {object} ctx { itemId, validSlotIds, teacherTurn, anchorsBySlot, forbiddenLevel? }
 * @returns {{ acceptedUpdates: Array<{slot_id, proposed_level, confidence, supporting_spans}>, rejected: Array<{slot_id, reason}>, errors }}
 */
function validateProposal(proposal, ctx) {
  const teacherTurn = (ctx && ctx.teacherTurn) || '';
  const validSlotIds = (ctx && ctx.validSlotIds) || null;
  const anchorsBySlot = (ctx && ctx.anchorsBySlot) || {};
  const acceptedUpdates = [];
  const rejected = [];
  const errors = [];

  const sps = Array.isArray(proposal && proposal.slot_evidence_proposals) ? proposal.slot_evidence_proposals : [];
  for (const sp of sps) {
    const slotId = sp && sp.slot_id;
    if (!slotId) { errors.push('slot_evidence_proposal 缺 slot_id'); continue; }
    // Slot 必须属于当前题
    if (validSlotIds && !validSlotIds.has(slotId)) { rejected.push({ slot_id: slotId, reason: 'not_in_item' }); continue; }
    // 有锚点表时必须存在该 slot 的锚点
    if (Object.keys(anchorsBySlot).length && !anchorsBySlot[slotId]) { rejected.push({ slot_id: slotId, reason: 'no_anchor' }); continue; }
    // proposed_level 0-3
    const proposed = clampLevel(sp.proposed_level);
    if (proposed < 0 || proposed > 3 || !Number.isInteger(sp.proposed_level)) { rejected.push({ slot_id: slotId, reason: 'illegal_level' }); continue; }
    // supporting_spans 必须逐字回指教师原话
    const supporting = (Array.isArray(sp.supporting_spans) ? sp.supporting_spans : []).filter((t) => t && teacherTurn.includes(t));
    if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length && supporting.length === 0) {
      rejected.push({ slot_id: slotId, reason: 'no_backref', detail: sp.supporting_spans }); continue;
    }
    acceptedUpdates.push({
      slot_id: slotId,
      proposed_level: proposed,
      confidence: clamp01(sp.confidence),
      supporting_spans: supporting
    });
  }

  // G05：能力/人格/动机判定词 → 整条 Proposal 拒绝（专业红线）
  const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
  if (judgeRe.test(JSON.stringify(proposal || {}))) {
    errors.push('G05: 出现能力/人格/动机直接判定词');
  }

  return { acceptedUpdates, rejected, errors };
}

/**
 * Committer：唯一能写 evidence_state 的入口。把验证通过的建议应用到状态。
 * @param {object} evidenceState 当前状态（原对象拷贝后用）
 * @param {Array<{slot_id, proposed_level, confidence, supporting_spans}>} acceptedUpdates
 * @param {string} teacherTurn
 * @param {string} turnId
 * @returns {{ state, updates }}
 */
function commitProposal(evidenceState, acceptedUpdates, teacherTurn, turnId) {
  const state = JSON.parse(JSON.stringify(evidenceState));
  const updates = [];
  for (const u of acceptedUpdates || []) {
    const st = state[u.slot_id];
    if (!st) continue;
    const before = { level: st.level, confidence: st.confidence };
    // 只允许向更高等级升级（与以前一致，避免 LLM 单轮降级造成振荡）
    if (u.proposed_level > st.level) {
      st.level = u.proposed_level;
      st.status = statusFromLevel(u.proposed_level);
      st.confidence = Math.max(st.confidence, u.confidence);
      st.last_updated_turn = turnId;
      for (const s of (u.supporting_spans || [])) {
        if (!st.supporting_spans.includes(s)) st.supporting_spans.push(s);
      }
    }
    const after = { level: st.level, confidence: st.confidence };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      updates.push({ slot_id: u.slot_id, before, after, quote: teacherTurn, reason: u.proposed_level > before.level ? `anchor_level_${u.proposed_level}` : 'no_change' });
    }
  }
  return { state, updates };
}

/**
 * bigramFallback：LLM 失败/超时/disabled 时，用 bigram 匹配产出**同一 Proposal 形状**，
 * 使 LLM 与规则走同一条 Validator→Committer 路径（不各自维护一套 Evidence 逻辑）。
 * @param {string} teacherTurn
 * @param {object} anchorsBySlot { slotId: {level_0..3} }
 * @param {string[]} evaluateSlotIds
 * @returns {object} Proposal（含 slot_evidence_proposals）
 */
function bigramFallback(teacherTurn, anchorsBySlot, evaluateSlotIds) {
  const slotEvidence = [];
  const candidateSpans = [];
  for (const slotId of (evaluateSlotIds || [])) {
    const anchor = anchorsBySlot[slotId];
    if (!anchor) continue;
    const { level, confidence, matched } = assessSlot(teacherTurn, anchor, 0);
    if (level > 0) {
      slotEvidence.push({
        slot_id: slotId,
        proposed_level: level,
        confidence,
        supporting_spans: teacherTurn ? [teacherTurn] : []
      });
      candidateSpans.push({ text: teacherTurn, candidate_slots: [slotId] });
    }
  }
  return {
    proposal_type: 'EvidenceAnalysisProposal',
    candidate_spans: candidateSpans,
    slot_evidence_proposals: slotEvidence,
    conflict_candidates: [],
    false_evidence_flags: [],
    uncertainty: [],
    no_change_reasons: [],
    source_turn: teacherTurn || null,
    provider_version: 'bigram-fallback-v1'
  };
}

module.exports = { assessSlot, updateEvidence, buildKeywords, overlapCount, statusFromLevel, extractKeywords: (t) => Array.from(normalizeBigrams(bigramsOf(t))), validateProposal, commitProposal, bigramFallback };
