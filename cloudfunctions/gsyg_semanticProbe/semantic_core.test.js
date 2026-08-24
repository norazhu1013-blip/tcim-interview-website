'use strict';

/**
 * semantic_core.test.js —— gsyg_semanticProbe 纯逻辑层测试（无 wx-server-sdk / 无网络）。
 *
 * 用伪造 LLM JSON 驱动整条决策链：
 *   - 合法 Proposal（slot_evidence_proposals）通过校验；
 *   - candidate_spans 形状为 {text, candidate_slots[]}；
 *   - G04：span 不在教师原话 → 剔除/报错；
 *   - G05：能力/人格判定词 → invalid；
 *   - proposed_level 越界 → 归 0；confidence 越界 → 夹到 0-1；
 *   - slot_id 不属于当前题 → 拒绝。
 */

const assert = require('node:assert');
const {
  buildSystemPrompt, buildUserPrompt, parseModelJSON,
  normalizeProposal, validateProposal, emptyProposal
} = require('./semantic_core.js');

const TEACHER_TURN = '我一般不会马上示范，会先看看水是在哪里断掉的，再让孩子换换坡度或者管子试试。试了几次还不行，我才会给一点提示。';
const VALID_SLOTS = new Set(['Q8-S1', 'Q8-S2', 'Q8-S3', 'Q8-S4', 'Q8-S5', 'Q8-S6']);

function main() {
  // ---- 测试1：提示词构造包含原话与锚点 ----
  {
    const sys = buildSystemPrompt();
    assert.ok(sys.includes('语义分析'), 'system prompt 应声明角色');
    assert.ok(sys.includes('slot_evidence_proposals'), 'system prompt 应含 slot_evidence_proposals');
    const user = buildUserPrompt({ teacherTurn: TEACHER_TURN, questionTitle: '引水难题' }, [{ slot_id: 'Q8-S3', level_2: '先指向受阻位置/高低比较' }], { 'Q8-S3': { level: 0, status: 'UNKNOWN', confidence: 0 } });
    assert.ok(user.includes(TEACHER_TURN), 'user prompt 应包含教师原话');
    assert.ok(user.includes('Q8-S3'), 'user prompt 应包含锚点');
  }

  // ---- 测试2：合法 Proposal 通过（来自 docx 权威示例） ----
  {
    const raw = {
      candidate_spans: [
        { text: '会先看看水是在哪里断掉的', candidate_slots: ['Q8-S1'] },
        { text: '让孩子换换坡度或者管子试试', candidate_slots: ['Q8-S4', 'Q8-S5'] }
      ],
      slot_evidence_proposals: [
        { slot_id: 'Q8-S1', proposed_level: 2, confidence: 0.84, supporting_spans: ['会先看看水是在哪里断掉的'] },
        { slot_id: 'Q8-S3', proposed_level: 2, confidence: 0.86, supporting_spans: ['不会马上示范', '才会给一点提示'] },
        { slot_id: 'Q8-S4', proposed_level: 1, confidence: 0.70, supporting_spans: ['换换坡度或者管子试试'] }
      ],
      uncertainty: ['尚不清楚教师依据什么现象决定改变坡度还是更换管子'],
      conflict_candidates: []
    };
    const norm = normalizeProposal(raw);
    const { ok, errors, proposal } = validateProposal(norm, TEACHER_TURN, VALID_SLOTS);
    assert.equal(ok, true, '合法 Proposal 应通过, errors=' + JSON.stringify(errors));
    assert.equal(proposal.candidate_spans.length, 2);
    assert.deepEqual(proposal.candidate_spans[1].candidate_slots, ['Q8-S4', 'Q8-S5']);
    assert.equal(proposal.slot_evidence_proposals.length, 3);
    assert.equal(proposal.slot_evidence_proposals[1].proposed_level, 2);
    assert.deepEqual(proposal.slot_evidence_proposals[1].supporting_spans, ['不会马上示范', '才会给一点提示']);
  }

  // ---- 测试3：```json 包裹 + 前后闲话 → parseModelJSON 鲁棒 ----
  {
    const wrapped = '好的：\n```json\n{"candidate_spans":[{"text":"会先看看水是在哪里断掉的","candidate_slots":["Q8-S1"]}],"slot_evidence_proposals":[]}\n```\n请参考。';
    const obj = parseModelJSON(wrapped);
    assert.ok(obj && obj.candidate_spans.length === 1, '```json 包裹应被解析');
    assert.equal(obj.candidate_spans[0].text, '会先看看水是在哪里断掉的');
  }

  // ---- 测试4：缺失数组字段 → normalizeProposal 补空 ----
  {
    const partial = { candidate_spans: [{ text: '换换坡度或者管子', candidate_slots: ['Q8-S5'] }] };
    const norm = normalizeProposal(partial);
    assert.ok(Array.isArray(norm.slot_evidence_proposals) && norm.slot_evidence_proposals.length === 0, '缺 slot_evidence_proposals 应补空');
    assert.ok(Array.isArray(norm.uncertainty), 'uncertainty 应补空数组');
  }

  // ---- 测试5：G04 —— span 不在原话 → 剔除 + 报错 ----
  {
    const raw = { candidate_spans: [{ text: '教师能力很强', candidate_slots: ['Q8-S2'] }], slot_evidence_proposals: [] };
    const norm = normalizeProposal(raw);
    const { ok, errors, proposal } = validateProposal(norm, TEACHER_TURN, VALID_SLOTS);
    assert.equal(proposal.candidate_spans.length, 0, '不在原话的 span 应被剔除');
    assert.ok(errors.some((e) => e.includes('未回指')), '应报未回指错误');
    assert.equal(ok, false);
  }

  // ---- 测试6：G05 —— 出现能力/人格判定词 → invalid ----
  {
    const raw = { candidate_spans: [], slot_evidence_proposals: [{ slot_id: 'Q8-S3', proposed_level: 2, confidence: 0.9, supporting_spans: [] }], no_change_reasons: [{ slot_id: 'Q8-S1', reason: '明显是低能力教师' }] };
    const norm = normalizeProposal(raw);
    const { ok, errors } = validateProposal(norm, TEACHER_TURN, VALID_SLOTS);
    assert.equal(errors.some((e) => e.includes('G05')), true, 'G05 应被标记');
    assert.equal(ok, false);
  }

  // ---- 测试7：proposed_level 越界归 0；confidence 越界夹 0-1 ----
  {
    const raw = { candidate_spans: [], slot_evidence_proposals: [{ slot_id: 'Q8-S3', proposed_level: 99, confidence: 5, supporting_spans: ['不会马上示范'] }] };
    const norm = normalizeProposal(raw);
    const { proposal } = validateProposal(norm, TEACHER_TURN, VALID_SLOTS);
    assert.equal(proposal.slot_evidence_proposals[0].proposed_level, 0, 'proposed_level 越界归 0');
    assert.equal(proposal.slot_evidence_proposals[0].confidence, 1, 'confidence 越界夹到 1');
  }

  // ---- 测试8：slot_id 不属于当前题 → 拒绝 ----
  {
    const raw = { candidate_spans: [], slot_evidence_proposals: [{ slot_id: 'Q1-S1', proposed_level: 2, confidence: 0.8, supporting_spans: [] }] };
    const norm = normalizeProposal(raw);
    const { ok, errors, proposal } = validateProposal(norm, TEACHER_TURN, VALID_SLOTS);
    assert.equal(ok, false, '不属于本题的 slot 应被拒');
    assert.equal(proposal.slot_evidence_proposals.length, 0);
    assert.ok(errors.some((e) => e.includes('不存在于本题')));
  }

  // ---- 测试9：空 Proposal 仍为合格形状 ----
  {
    const p = emptyProposal(TEACHER_TURN, 'semantic-v0.2');
    assert.deepEqual(p.candidate_spans, []);
    assert.deepEqual(p.slot_evidence_proposals, []);
    assert.deepEqual(p.uncertainty, []);
    assert.equal(p.source_turn, TEACHER_TURN);
  }

  console.log('gsyg_semanticProbe semantic_core tests passed');
}

main();
