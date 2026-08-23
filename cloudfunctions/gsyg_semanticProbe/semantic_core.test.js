'use strict';

/**
 * semantic_core.test.js —— gsyg_semanticProbe 纯逻辑层测试（无 wx-server-sdk / 无网络）。
 *
 * 目标：用「伪造 LLM JSON」驱动整条决策链，证明 Step 1b 的语义端点在本地可验证：
 *   - 合法 Proposal：spans 回指原话、G04/G05 过滤。
 *   - ```json 包裹 + 前后闲话 → parseModelJSON 鲁棒抽取。
 *   - 缺失数组字段 → normalizeProposal 补空数组。
 *   - G04：span 不在原话 → 丢弃。
 *   - G05：出现能力/人格判定词 → 整条打 invalid 标记。
 *   - 低置信 span 剔除。
 */

const assert = require('node:assert');
const {
  buildSystemPrompt, buildUserPrompt, parseModelJSON,
  normalizeProposal, validateProposal, emptyProposal
} = require('./semantic_core.js');

const TEACHER_TURN = '我会先看地面湿不滑，篮球架附近有没有别的孩子在使用，再决定要不要提醒。';

function main() {
  // ---- 测试1：提示词构造包含原话与锚点 ----
  {
    const sys = buildSystemPrompt();
    assert.ok(sys.includes('语义预筛'), 'system prompt 应声明角色');
    const user = buildUserPrompt({ teacherTurn: TEACHER_TURN, questionTitle: '篮球架玩水' }, [{ slot_id: 'Q1-S2', level_2: '能具体检查湿滑' }], { 'Q1-S2': { level: 1, status: 'PARTIAL', confidence: 0.4 } });
    assert.ok(user.includes(TEACHER_TURN), 'user prompt 应包含教师原话');
    assert.ok(user.includes('Q1-S2'), 'user prompt 应包含锚点');
  }

  // ---- 测试2：合法 Proposal 通过校验，span 回指原话 ----
  {
    const raw = {
      candidate_spans: [{ text: '地面湿不滑', slot_id: 'Q1-S2', span_type: 'supporting', confidence: 0.8 }],
      candidate_slots: [{ slot_id: 'Q1-S2', relevance: 'high' }],
      conflict_candidates: [{ slot_id: 'Q1-S5', reason: '未提规则协商' }],
      no_change_reasons: [{ slot_id: 'Q1-S1', reason: '未提代际关系' }],
      uncertainty: 0.3
    };
    const norm = normalizeProposal(raw);
    const { ok, errors, proposal } = validateProposal(norm, TEACHER_TURN);
    assert.equal(ok, true, '合法 Proposal 应通过, errors=' + JSON.stringify(errors));
    assert.equal(proposal.candidate_spans.length, 1);
    assert.equal(proposal.candidate_spans[0].text, '地面湿不滑');
    assert.equal(proposal.conflict_candidates[0].slot_id, 'Q1-S5');
  }

  // ---- 测试3：```json 包裹 + 前后闲话 → parseModelJSON 鲁棒 ----
  {
    const wrapped = '好的，分析如下：\n```json\n{"candidate_spans":[{"text":"地面湿不滑","slot_id":"Q1-S2","span_type":"supporting","confidence":0.7}]}\n```\n希望有帮助。';
    const obj = parseModelJSON(wrapped);
    assert.ok(obj && Array.isArray(obj.candidate_spans) && obj.candidate_spans.length === 1, '```json 包裹应被解析');
    assert.equal(obj.candidate_spans[0].text, '地面湿不滑');
  }

  // ---- 测试4：缺失数组字段 → normalizeProposal 补空 ----
  {
    const partial = { candidate_spans: [{ text: '地面湿不滑', slot_id: 'Q1-S2' }] };
    const norm = normalizeProposal(partial);
    assert.ok(Array.isArray(norm.candidate_slots) && norm.candidate_slots.length === 0, '缺失数组应补空');
    assert.ok(Array.isArray(norm.no_change_reasons), 'no_change_reasons 应补空');
    assert.equal(typeof norm.uncertainty, 'number');
  }

  // ---- 测试5：G04 —— span 不在原话 → 丢弃 ----
  {
    const raw = { candidate_spans: [{ text: '教师能力很强', slot_id: 'Q1-S2', span_type: 'supporting', confidence: 0.9 }] };
    const norm = normalizeProposal(raw);
    const { proposal } = validateProposal(norm, TEACHER_TURN);
    assert.equal(proposal.candidate_spans.length, 0, '不在原话的 span 应被丢弃');
  }

  // ---- 测试6：G05 —— 出现能力/人格判定词 → 整条 invalid 标记 ----
  {
    const raw = { candidate_spans: [{ text: '教师能力很强', slot_id: 'Q1-S2', span_type: 'supporting', confidence: 0.9 }], no_change_reasons: [{ slot_id: 'Q1-S1', reason: '明显是低能力教师' }] };
    const norm = normalizeProposal(raw);
    const { ok, errors, proposal } = validateProposal(norm, TEACHER_TURN);
    // span 不在原话被丢弃 → 空 spans；但 no_change_reasons 里的「低能力教师」触发 G05
    assert.equal(errors.some((e) => e.includes('G05')), true, 'G05 判定词应被标记');
    assert.equal(ok, false, '含 G05 的 Proposal 应为 invalid');
    assert.ok(proposal.no_change_reasons.length >= 1, 'no_change_reasons 保留供审计');
  }

  // ---- 测试7：低置信 span 剔除 ----
  {
    const raw = { candidate_spans: [
      { text: '地面湿不滑', slot_id: 'Q1-S2', span_type: 'supporting', confidence: 0.5 },
      { text: '篮球架附近', slot_id: 'Q1-S1', span_type: 'supporting', confidence: 0.1 }
    ] };
    const norm = normalizeProposal(raw);
    const { proposal } = validateProposal(norm, TEACHER_TURN);
    assert.equal(proposal.candidate_spans.length, 1, '低置信 span 应剔除');
    assert.equal(proposal.candidate_spans[0].text, '地面湿不滑');
  }

  // ---- 测试8：空 Proposal（无证据）仍为合格形状 ----
  {
    const p = emptyProposal(TEACHER_TURN, 'semantic-v0.1');
    assert.deepEqual(p.candidate_spans, []);
    assert.deepEqual(p.no_change_reasons, []);
    assert.equal(p.source_turn, TEACHER_TURN);
  }

  console.log('gsyg_semanticProbe semantic_core tests passed');
}

main();
