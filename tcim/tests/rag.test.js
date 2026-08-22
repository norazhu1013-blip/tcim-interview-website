'use strict';

/**
 * TCIM RAG V0.1 测试（04-1 RAG总体架构）。
 *
 * 验收：
 *   1. knowledge_need=false → R0，完全不调用检索。
 *   2. knowledge_need=true → R1/R2 检索，返回可追溯来源。
 *   3. 权限门：DIAGNOSE_INTERNAL 知识默认不 teacher-facing；REFLECT/SUPPORT 可展示。
 *   4. RAG 不产生 Evidence 写权限；不包含 EvidenceStateMutation。
 */

const assert = require('node:assert');
const path = require('node:path');
const { createCore } = require('../core/index.js');
const { loadGameSupportData } = require('../professional_data/game_support/loader.js');
const ragModule = require('../modules/rag/rag.js');

const data = loadGameSupportData(path.join(__dirname, '..', 'professional_data', 'game_support'));

async function main() {
  // ---- 1) knowledge_need=false → R0 ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    core.setRagKnowledge(data.items);
    core.setModuleEnabled('rag', true);
    const input = {
      session_id: 's', turn_id: 't1', question_id: 'Q1',
      turn_context: { teacher_turn: '我会先看地面湿不滑。', teacher_ranking: ['A', 'C', 'B', 'D'], question_id: 'Q1', item_package: data.items.Q1, turn_no: 0, process_tags: [] },
      module_config: {}
    };
    // ctx.opts.knowledgeNeed 默认 false
    const result = await ragModule.process(input, {});
    assert.equal(result.observations[0], 'R0 no retrieval');
    assert.equal(result.state_updates.rag_runtime_state.last_route, 'R0');
  }

  // ---- 2) knowledge_need=true → R2 关键词检索，来源可追溯 ----
  {
    ragModule.setKnowledge(data.items);
    const { refs, route } = ragModule.retrieve('场地 风险 判断', 'Q1');
    assert.equal(route, 'R2', `应走 R2 检索，实际 ${route}`);
    assert.ok(refs.length >= 1, '应返回知识条目');
    assert.ok(refs[0].source.startsWith('Q1-capsule-'), `来源应可追溯: ${refs[0].source}`);
    assert.ok(refs[0].text.includes('风险') || refs[0].text.includes('场地'), '条目内容应相关');
  }

  // ---- 3) 权限门 ----
  {
    ragModule.setKnowledge(data.items);
    const diag = ragModule.retrieve('介入 时机', 'Q1');
    const gated = ragModule.permissionFor('DIAGNOSE_INTERNAL', diag.refs);
    assert.equal(gated.teacher_facing, false, 'diagnose 阶段知识不可教师可见');
    const support = ragModule.permissionFor('SUPPORT', diag.refs);
    assert.equal(support.teacher_facing, true, 'support 阶段知识可展示');
  }

  // ---- 4) RAG 不写 Evidence ----
  {
    const core = createCore();
    core.setOntologyData(data.items);
    core.setRagKnowledge(data.items);
    core.setModuleEnabled('rag', true);
    const input = {
      session_id: 's', turn_id: 't1', question_id: 'Q1',
      turn_context: { teacher_turn: '我会先看地面湿不滑。', teacher_ranking: ['A', 'C', 'B', 'D'], question_id: 'Q1', item_package: data.items.Q1, turn_no: 0, process_tags: [] },
      module_config: {}
    };
    const result = await core.runModules(input, ['rag']);
    assert.equal(result.errors.length, 0);
    const ragResult = result.results[0];
    assert.ok(ragResult.state_updates.rag_runtime_state, 'RAG 只写 rag_runtime_state');
    assert.ok(!ragResult.state_updates.ontology_state, 'RAG 不得写 ontology_state');
  }

  console.log('TCIM RAG V0.1 tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
