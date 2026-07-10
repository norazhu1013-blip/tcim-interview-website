/**
 * 任务卡构建器 —— 共享模块,由 gsyg_selectFinal(遴选时预生成 3 张卡)
 * 和 gsyg_interviewChat(降级路径,session 无卡时现场拼)复用。
 *
 * 通过 tools/sync_cf.js 物理拷贝到两个云函数目录,不通过 require 相对路径引用
 * (云函数上传只打包自身目录)。
 *
 * 数据源:cloudfunctions/<cf>/knowledge.json(由 tools/build_knowledge_v16.js 生成)。
 * 调用方在 require 本文件前需先 require 好 knowledge.json,并通过 setKnowledge(kb) 注入。
 */
'use strict';

const STAGES = ['S1_CONTEXT', 'S2_COMPARE', 'S3_STRATEGY', 'S4_SUMMARY'];
const STAGE_LABEL = {
  S1_CONTEXT: '情境理解(教师如何解读儿童行为与情境冲突)',
  S2_COMPARE: '选项比较与判断依据(教师如何权衡不同做法)',
  S3_STRATEGY: '现场策略生成(教师能否给出具体话术/行动)',
  S4_SUMMARY: '中性小结与确认(收束访谈)'
};

// 默认全局禁止披露(与 002 doc 一致);15 表 forbidden 规则会覆盖/补充
const DEFAULT_FORBIDDEN_DISCLOSURE = [
  '不得透露得分。',
  '不得透露排序是否正确。',
  '不得透露入选原因。',
  '不得透露 R/P/G、IIV 或任何内部指标。',
  '不得评价教师能力等级。',
  '不得直接告诉教师标准答案。'
];

let _KB = { items: {} };
function setKnowledge(kb) { if (kb && kb.items) _KB = kb; }
function getKnowledge() { return _KB; }

/**
 * 触发条件匹配。支持 all / A_first / B_first / A_last / priorityOption_C /
 * priorityPair_BC / order_changed / process_complex / process_stable 等原子;
 * 通过 OR/或、AND/且/与 组合。粗匹配,未识别原子视作 true。
 */
function matchTrigger(cond, ctx) {
  if (!cond) return true;
  const c = String(cond).trim();
  if (!c || c === 'all' || c === '默认') return true;
  const finalOrder = ctx.teacherFinalOrder || '';
  const first = finalOrder[0] || '';
  const last = finalOrder[finalOrder.length - 1] || '';
  const pOpt = ctx.priorityOption || '';
  const pPair = ctx.priorityPair || '';
  const orderChanged = !!ctx.orderChanged;
  const tags = ctx.processTags || [];

  const orParts = c.split(/\bOR\b|或/i).map((s) => s.trim()).filter(Boolean);
  return orParts.some((part) => {
    const andParts = part.split(/\bAND\b|且|与/i).map((s) => s.trim()).filter(Boolean);
    return andParts.every((p) => matchAtom(p, { first, last, pOpt, pPair, orderChanged, tags, finalOrder }));
  });
}

function matchAtom(p, ctx) {
  const s = String(p);
  if (/首位.*[A-D]|[A-D].*首位|[A-D]_first/i.test(s)) {
    const m = s.match(/[A-D]/); return m ? ctx.first === m[0] : false;
  }
  if (/末位.*[A-D]|[A-D].*末位|[A-D]_last/i.test(s)) {
    const m = s.match(/[A-D]/); return m ? ctx.last === m[0] : false;
  }
  if (/priorityOption[非_]*空|priorityOption[_= ]*[A-D]|重点选项/i.test(s)) {
    const m = s.match(/[A-D]/); if (m) return ctx.pOpt === m[0]; return !!ctx.pOpt;
  }
  if (/priorityPair[非_]*空|priorityPair[_= ]*[A-D]\/?[A-D]|重点比较/i.test(s)) {
    const mm = s.match(/[A-D]\/[A-D]|[A-D][A-D]/);
    if (mm) return ctx.pPair === mm[0] || ctx.pPair === mm[0].split('').join('/');
    return !!ctx.pPair;
  }
  if (/order_?changed|排序.*变化|发生调整/i.test(s)) return ctx.orderChanged;
  if (/process_?complex|过程复杂|摇摆|振荡|高修正/i.test(s)) return ctx.tags.some((t) => /摇摆|振荡|高修正|多次调整/.test(t));
  if (/process_?stable|过程稳定|极快/i.test(s)) return ctx.tags.some((t) => /稳定|极快/.test(t));
  return true;
}

/**
 * 从 15 表 ai_rules 里筛出对当前教师+题目适用的规则,按 rule_type 分组,拼装成完整任务卡。
 *
 * @param {string} itemId  mp Q1..Q10
 * @param {object} seed    { teacherFinalOrder, teacherInitialOrder, orderChanged,
 *                           orderChangeSummary, priorityOption, priorityPair, sources,
 *                           primary_ability_type, secondary_ability_type, processTags }
 * @param {string} [stage] 可选;调用方设(遴选时通常留空,访谈时按当前阶段填)
 */
function buildTaskCard(itemId, seed, stage) {
  const item = _KB.items && _KB.items[itemId];
  if (!item) return null;
  const rules = item.ai_rules || [];
  const ctx = {
    teacherFinalOrder: seed.teacherFinalOrder || '',
    priorityOption: seed.priorityOption || '',
    priorityPair: seed.priorityPair || '',
    orderChanged: !!seed.orderChanged,
    processTags: seed.processTags || []
  };
  const matched = rules.filter((r) => (r.usable_by_ai !== 'no') && matchTrigger(r.trigger_condition, ctx));
  const byType = {};
  for (const r of matched) {
    const t = r.rule_type || 'other';
    (byType[t] = byType[t] || []).push(r);
  }
  const first = (arr) => (arr && arr[0] && arr[0].rule_content) || '';
  const contents = (arr, n) => (arr || []).slice(0, n || 6).map((r) => r.rule_content).filter(Boolean);
  const forbiddenFromKB = contents(byType.forbidden, 8);
  return {
    task_card_version: 'v1.0',
    item_id: itemId,
    item_title: item.title,
    knowledge_base_id: itemId,
    scenario: (item.basic && item.basic['01 基本信息与指标体系定位']) || (item.context_structure && item.context_structure['02 情境结构与访谈入口']) || '',
    ability_focus: {
      primary_ability_type: seed.primary_ability_type || '',
      secondary_ability_type: seed.secondary_ability_type || '',
      interview_main_focus: first(byType.main_focus),
      interview_secondary_focus: first(byType.secondary_focus)
    },
    teacher_answer_profile: {
      teacherFinalOrder: seed.teacherFinalOrder || '',
      teacherInitialOrder: seed.teacherInitialOrder || '',
      orderChanged: !!seed.orderChanged,
      orderChangeSummary: seed.orderChangeSummary || '',
      priorityOption: seed.priorityOption || '',
      priorityPair: seed.priorityPair || '',
      sources: seed.sources || [],
      processTags: seed.processTags || []
    },
    interview_hypotheses: contents(byType.hypothesis, 5),
    must_obtain_evidence: contents(byType.evidence, 6),
    recommended_probes: contents(byType.probe, 8),
    interview_flow: contents(byType.flow, 6),
    process_hints: contents(byType.process_hint, 4),
    forbidden_disclosure: forbiddenFromKB.length ? forbiddenFromKB : DEFAULT_FORBIDDEN_DISCLOSURE.slice(),
    current_stage: stage || 'S1_CONTEXT',
    current_stage_focus: STAGE_LABEL[stage || 'S1_CONTEXT']
  };
}

/** 根据教师最后一轮回答里覆盖的证据点数,决定下一阶段。 */
function decideNextStage(currentStage, coveredEvidence, turnCount) {
  const covered = new Set(coveredEvidence || []);
  const idx = STAGES.indexOf(currentStage);
  if (idx < 0) return 'S1_CONTEXT';
  if (currentStage === 'S4_SUMMARY') return 'S4_SUMMARY';
  const advance = (covered.size >= 1 && turnCount >= 2) || turnCount >= 3;
  if (!advance) return currentStage;
  return STAGES[Math.min(idx + 1, STAGES.length - 1)];
}

module.exports = {
  STAGES, STAGE_LABEL,
  setKnowledge, getKnowledge,
  matchTrigger, matchAtom,
  buildTaskCard, decideNextStage,
  DEFAULT_FORBIDDEN_DISCLOSURE
};
