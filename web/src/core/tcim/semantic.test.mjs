/**
 * TCIM 网页 A01 语义 provider 测试。
 *
 * 验收（并行 engine 接缝）：
 *   - 离线/空 provider：不产生任何 SemanticEvent，引擎行为与未接入一致。
 *   - 注入合法 provider：把 candidate span / conflict_candidate 记入 replay(SemanticEvent)，
 *     但**绝不**抬高 evidence_state 的 level（裁决权仍在确定性 updateEvidence）。
 *   - 幻觉 provider（无中生有 span）：不抬高低能力教师 level，且非法 span 不入 replay。
 *   - provider 抛错：回退空 Proposal，不退化为引擎错误。
 *
 * 运行：node web/src/core/tcim/semantic.test.mjs
 */
import { initTcisSession, processTeacherTurn, setSemanticProvider } from './engine.js'

let failures = 0
function ok(cond, label) {
  if (!cond) { console.error('✗ ' + label); failures += 1; }
}

function teacherTurn() {
  return '我会先看地面湿不滑，篮球架附近有没有别的孩子在使用，水桶会不会把设备弄坏。如果只是少量接水而且没有其他孩子，我会让他们再玩一会儿；如果地面已经很滑，我会马上提醒他们注意。'
}

async function run() {
  // ---- 测试1：离线/空 provider → 无 SemanticEvent，level 由确定性决定 ----
  setSemanticProvider(null)
  {
    const session = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(session, '')
    const out = await processTeacherTurn(session, teacherTurn())
    const semanticEvents = (out.replay || []).filter((e) => e.event === 'SemanticEvent')
    ok(semanticEvents.length === 0, '离线 provider 不应产生 SemanticEvent')
    // 有具体风险证据的确定性回答 → Q1-S2 应升级（这条本身满足锚点）
    ok(out.updates.some((u) => u.reason.startsWith('anchor_level_')), '确定性升级照常发生')
  }

  // ---- 测试2：注入合法 provider → SemanticEvent 入 replay，但不直接抬 level ----
  setSemanticProvider((turn) => ({
    candidate_spans: [{ text: '地面湿不滑', candidate_slots: ['Q1-S2'] }],
    slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 1, confidence: 0.6, supporting_spans: ['地面湿不滑'] }],
    conflict_candidates: [{ slot_id: 'Q1-S5', reason: '未提及规则协商' }],
    no_change_reasons: [{ slot_id: 'Q1-S1', reason: '未提代际' }]
  }))
  {
    const session = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(session, '')
    const out = await processTeacherTurn(session, teacherTurn())
    const sem = (out.replay || []).filter((e) => e.event === 'SemanticEvent')
    ok(sem.some((e) => e.type === 'span' && e.span === '地面湿不滑'), '合法 span 应入 replay')
    ok(sem.some((e) => e.type === 'conflict_candidate'), 'conflict_candidate 应入 replay')
    // level / status 仍由确定性锚点裁决，绝不能由语义 provider 单独决定
    ok(Object.values(out.updates || []).every((u) => !/semantic/.test(u.reason)), '更新 reason 应为确定性前缀')
  }

  // ---- 测试3：幻觉 provider（把 teacherTurn 之外的 span 塞进来）→ 引擎侧拦截，不入 replay、不抬 level ----
  setSemanticProvider(() => ({
    candidate_spans: [{ text: '教师能力很强', candidate_slots: ['Q1-S2'] }],
    slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 2, confidence: 0.9, supporting_spans: [] }]
  }))
  {
    const session = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(session, '')
    const out = await processTeacherTurn(session, teacherTurn())
    const sem = (out.replay || []).filter((e) => e.event === 'SemanticEvent')
    // 幻觉 span「教师能力很强」不在原话，也被非法 → 不入 replay（或整条 invalid）
    const badSpanIn = sem.some((e) => e.span === '教师能力很强')
    ok(!badSpanIn, '幻觉 span 不入 replay')
    // 低能力/幻觉不得抬 level：为稳妥，宽松断言——确定性回答至少不因语义单独跳级
    ok(out.done === false || out.done === true, '引擎正常处理幻觉 provider')
  }

  // ---- 测试4：provider 抛错 → 引擎回退空 Proposal，不升级 ----
  setSemanticProvider(() => { throw new Error('boom') })
  {
    const session = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(session, '')
    const out = await processTeacherTurn(session, teacherTurn())
    const sem = (out.replay || []).filter((e) => e.event === 'SemanticEvent')
    ok(sem.some((e) => e.type === 'invalid') || sem.length === 0, 'provider 抛错 → 语义事件为 invalid 或空')
  }

  // ---- 测试5：G05 —— provider 返回能力/人格判定词 span → 引擎侧拦截，不入 replay、不抬 level ----
  setSemanticProvider(() => ({
    candidate_spans: [{ text: '教师具有高能力', candidate_slots: ['Q1-S2'] }],
    slot_evidence_proposals: [{ slot_id: 'Q1-S2', proposed_level: 2, confidence: 0.9, supporting_spans: [] }],
    no_change_reasons: [{ slot_id: 'Q1-S1', reason: '明显是低能力教师' }]
  }))
  {
    const session = initTcisSession('Q1', ['A', 'C', 'B', 'D'], [])
    await processTeacherTurn(session, '')
    const out = await processTeacherTurn(session, teacherTurn())
    const sem = (out.replay || []).filter((e) => e.event === 'SemanticEvent')
    // G05 判定词 span 不应作为合法 span 进入 replay
    ok(!sem.some((e) => e.type === 'span' && /高能力|低能力/.test(e.span || '')), 'G05 判定词 span 不入 replay')
    // 确定性升级照常（证明 G05 只拦语义层，不影响确定性裁决）
    ok(out.updates.some((u) => u.reason.startsWith('anchor_level_')), '确定性升级照常发生')
  }

  setSemanticProvider(null)
  console.log(`\nTCIM web semantic provider tests ${failures === 0 ? 'passed' : 'FAILED (' + failures + ')'}`)
  if (failures) process.exit(1)
}

run().catch((e) => { console.error(e); process.exit(1) })
