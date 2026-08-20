'use strict';

/**
 * TCIM Module Runner —— 按 feature flags 顺序运行启用模块（01-2 第11节）。
 *
 * 规则：
 *   - 只运行 registry 中 enabled 且非 future 的模块。
 *   - 每个模块收到 ModuleInput；返回 ModuleResult；Runner 校验所有权与 schema。
 *   - 模块失败：记录 error_event → 丢弃该模块本轮结果 → 按 fallback 继续，不得丢失教师回答。
 *   - 结果按模块顺序返回 ModuleResult[]。
 */

const {
  validateModuleInput,
  validateModuleResult,
  fingerprintActionPlan
} = require('./contracts.js');

class ModuleRunner {
  constructor(registry, sharedState, logger) {
    this.registry = registry;
    this.sharedState = sharedState;
    this.logger = logger || { log() {}, warn() {}, error() {} };
  }

  /**
   * @param {object} moduleInput 由 TurnContext Builder 生成
   * @param {string[]} enabledModuleIds 例如 ['ontology_game_support']
   * @returns { { results: [], errors: [], shared_state: object } }
   */
  async run(moduleInput, enabledModuleIds) {
    const results = [];
    const errors = [];
    for (const moduleId of enabledModuleIds) {
      const entry = this.registry.getModule(moduleId);
      if (!entry || !entry.enabled || entry.futureOnly) continue;
      const v = validateModuleInput(moduleInput);
      if (!v.ok) {
        errors.push({ module_id: moduleId, error: v.errors.join('; '), impact: 'input_invalid' });
        this.logger.error(`[runner] ${moduleId} input invalid: ${v.errors.join('; ')}`);
        continue;
      }
      try {
        const result = await entry.handler.process(moduleInput, {
          sharedState: this.sharedState,
          registry: this.registry,
          snapshot: (ns) => {
            const value = this.sharedState[ns];
            return value ? JSON.parse(JSON.stringify(value)) : {};
          }
        });
        const rv = validateModuleResult(result, entry.ownerNamespace);
        if (!rv.ok) {
          errors.push({ module_id: moduleId, error: rv.errors.join('; '), impact: 'contract_violation' });
          this.logger.error(`[runner] ${moduleId} contract violation: ${rv.errors.join('; ')}`);
          continue; // 丢弃该模块本轮结果
        }
        results.push(Object.assign({ module_id: moduleId, module_version: entry.version }, result));
      } catch (e) {
        errors.push({ module_id: moduleId, error: e && e.message, impact: 'module_crash' });
        this.logger.error(`[runner] ${moduleId} crashed: ${e && e.message}`);
      }
    }
    return { results, errors, shared_state: this.sharedState };
  }
}

module.exports = { ModuleRunner };
