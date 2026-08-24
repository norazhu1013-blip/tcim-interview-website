'use strict';

/**
 * TCIM V0.2 RAG（04-1）：Planner 驱动的 KnowledgeNeedProposal 验收。
 *
 * - decideKnowledgeNeed：默认克制（R0）；仅在 core slot 大量 level 0 且轮次够、有查询词时 need=true。
 * - validateProposal：need=true 需 gap/expected_use；route_ceiling/phase 合法；非法降级。
 * - RAG 永不写 Evidence/Belief/Action（硬约束）。
 * - R0 默认不调用。
 */

const assert = require('node:assert');
const { decideKnowledgeNeed, validateProposal, ROUTES } = require('../modules/rag/knowledge_need.js');

function mkItem() {
  return { item_id: 'Q8', ontology: { diagnostic_focus: '判断', slots: [{ slot_id: 'Q8-S1', core: true }, { slot_id: 'Q8-S2', core: true }, { slot_id: 'Q8-S3', core: true }, { slot_id: 'Q8-S4', core: true }, { slot_id: 'Q8-S5', core: true }] } };
}
function mkEvidence() {
  // 全部 level 0（V0.2 level=null 也视为 0）
  return { 'Q8-S1': { level: 0, probe_status: 'OPEN' }, 'Q8-S2': { level: 0, probe_status: 'OPEN' }, 'Q8-S3': { level: 0, probe_status: 'OPEN' }, 'Q8-S4': { level: 0, probe_status: 'OPEN' }, 'Q8-S5': { level: 0, probe_status: 'OPEN' } };
}

function main() {
  // ---- 1. 默认克制：低轮次 / 无查询词 → need=false, R0 ----
  {
    const p = decideKnowledgeNeed({ evidence: mkEvidence(), item: mkItem(), turnNo: 0 });
    assert.equal(p.need, false, '低轮次 need=false');
    assert.equal(p.route_ceiling, 'R0');
    assert.equal(p.fallback_without_rag, true);
  }
  // ---- 2. 高缺口 + 轮次够 → need=true, route_ceiling R2 ----
  {
    const p = decideKnowledgeNeed({ evidence: mkEvidence(), item: mkItem(), turnNo: 4 });
    assert.equal(p.need, true, '高缺口+轮次够 need=true');
    assert.equal(p.route_ceiling, 'R2');
    assert.ok(p.gap, 'need=true 需 gap');
    assert.ok(p.expected_use, 'need=true 需 expected_use');
    assert.equal(ROUTES.includes('R2'), true);
  }
  // ---- 3. validateProposal：need=true 无 gap → 非法 ----
  {
    const v = validateProposal({ need: true, gap: '', expected_use: '', route_ceiling: 'R2', phase: 'SUPPORT' });
    assert.equal(v.ok, false, 'need=true 无 gap 应非法');
    assert.ok(v.errors.some((e) => e.includes('gap')));
  }
  // ---- 4. validateProposal：route_ceiling 非法 → 降级 ----
  {
    const v = validateProposal({ need: true, gap: 'x', expected_use: 'y', route_ceiling: 'R9', phase: 'SUPPORT' });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('route_ceiling')));
  }
  // ---- 5. 合法 Proposal 通过 ----
  {
    const v = validateProposal({ need: true, gap: '材料功能不明', expected_use: '支撑下一步', route_ceiling: 'R2', phase: 'SUPPORT' });
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  }
  // ---- 6. ROUTES 冻结（R0 默认不调用，无 R3 意外升级） ----
  assert.deepEqual(ROUTES, ['R0', 'R1', 'R2', 'R3']);

  console.log('TCIM V0.2 rag (KnowledgeNeedProposal) tests passed');
}

try { main(); } catch (e) { console.error(e); process.exit(1); }
