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

function createCore(opts = {}) {
  const registry = new ModuleRegistry();
  const logger = opts.logger || console;

  // future 占位（disabled）：只登记，不运行
  registry.register('prdm', { version: '0.0.0-future', futureOnly: true });
  registry.register('rag', { version: '0.0.0-future', futureOnly: true });
  registry.register('teacher_state', { version: '0.0.0-future', futureOnly: true });
  registry.register('metacognition', { version: '0.0.0-future', futureOnly: true });

  // FakeUtility：仅测试/演示接入路径，生产不启用
  registry.register('utility', {
    handler: fakeUtility,
    version: fakeUtility.version,
    ownerNamespace: null,   // Utility 不拥有任何 namespace
    enabled: false
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
