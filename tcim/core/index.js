'use strict';

/**
 * TCIM Core 统一入口。所有模块与核心组件经此注册。
 *
 * 当前注册（V0.1）：
 *   - ontology_game_support（由 Task 3 实现，接入时注册）
 *   - prdm / rag / utility / teacher_state / metacognition 均为 future 禁用占位
 */

const { ModuleRegistry } = require('./module_registry.js');
const { ModuleRunner } = require('./module_runner.js');
const contracts = require('./contracts.js');
const sharedState = require('./shared_state.js');
const orchestrator = require('./orchestrator.js');
const turnContext = require('./turn_context.js');

const fakeUtility = require('../modules/utility/fake_utility.js');
const ontologyModule = require('../modules/ontology/game_support_ontology.js');
const prdmModule = require('../modules/prdm/prdm.js');
const ragModule = require('../modules/rag/rag.js');

function createCore(opts = {}) {
  const registry = new ModuleRegistry();
  const logger = opts.logger || console;

  // future 占位（disabled）：只登记，不运行
  registry.register('teacher_state', { version: '0.0.0-future', futureOnly: true });
  registry.register('metacognition', { version: '0.0.0-future', futureOnly: true });

  // RAG V0.1：默认禁用（R0 不调用）；仅 Orchestrator knowledge_need=true 时启用。
  // 注入题目数据后 setKnowledge；只写 rag_runtime_state，不改 Evidence。
  registry.register('rag', {
    handler: {
      process: async (input, ctx) => ragModule.process(input, ctx)
    },
    version: ragModule.version,
    ownerNamespace: 'rag_runtime_state',
    enabled: false
  });

  // PRDM V0.1：默认禁用，可启停（不写 Evidence、不改专业目标）
  registry.register('prdm', {
    handler: { process: async (input, ctx) => ({
      module_id: 'prdm',
      module_version: prdmModule.version,
      observations: [],
      state_updates: {},   // PRDM 不写任何 namespace（dialogue_state 未来可写，V0.1 只读）
      action_proposals: [],
      constraints: [],
      confidence: 0.8,
      evidence_refs: [],
      decision_summary: 'prdm: dialogue policy (V0.1, no state mutation)',
      diagnostics: []
    }) },
    version: prdmModule.version,
    ownerNamespace: 'dialogue_state',
    enabled: false
  });

  // FakeUtility：仅测试/演示接入路径，生产不启用
  registry.register('utility', {
    handler: fakeUtility,
    version: fakeUtility.version,
    ownerNamespace: null,   // Utility 不拥有任何 namespace
    enabled: false
  });

  // GameSupportOntologyModule：V0.1 active。数据由调用方 setOntologyData 注入。
  registry.register('ontology_game_support', {
    handler: ontologyModule,
    version: ontologyModule.version,
    ownerNamespace: ontologyModule.ownerNamespace,
    enabled: true
  });

  const shared = sharedState.createEmptyState();
  const runner = new ModuleRunner(registry, shared, logger);

  return {
    registry,
    runner,
    shared,
    contracts,
    sharedState,
    orchestrator,
    turnContext,
    /** 注入 Ontology 专业数据包（Task 2 生成）。 */
    setOntologyData: (items) => ontologyModule.setData(items),
    /** 注入 RAG 知识包（题目数据聚合；RAG 默认 R0 不调用）。 */
    setRagKnowledge: (items) => ragModule.setKnowledge(items),
    /** 运行一批启用的模块 → ModuleResult[] */
    runModules: async (moduleInput, enabledIds) => runner.run(moduleInput, enabledIds),
    /** 启用/注册单个模块（供 Task 3 接入 ontology 用） */
    registerModule: (id, opts) => registry.register(id, opts),
    setModuleEnabled: (id, enabled) => registry.setEnabled(id, enabled),
    flags: () => registry.flagSnapshot(),
    setFlag: (f, v) => registry.setFlag(f, v)
  };
}

module.exports = { createCore, ModuleRegistry, ModuleRunner, contracts, sharedState, orchestrator, turnContext };
