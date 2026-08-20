'use strict';

/**
 * TCIM Module Registry + Feature Flags（01-2 第11、15节）。
 *
 * - 模块注册表：module_id → { handler, version, ownerNamespace, enabled }。
 * - 每个 session 固化 feature flag snapshot；实验中途不得静默切换。
 * - 未来模块在未实现前只允许 README_FUTURE 与 disabled registry entry，不允许返回伪结果。
 */

const { STATE_OWNERS } = require('./contracts.js');

class ModuleRegistry {
  constructor() {
    this._modules = new Map(); // module_id -> { handler, version, ownerNamespace, enabled }
    this._flagDefaults = {
      legacy_interview: true,
      tcim_modular_core: true,
      ontology_game_support: true,
      prdm_v01: false,
      rag_v01: false,
      utility_future: false,
      teacher_state_future: false,
      metacognition_future: false
    };
  }

  register(moduleId, opts = {}) {
    const {
      handler = null,
      version = '0.0.0',
      ownerNamespace = null,
      enabled = false,
      futureOnly = false
    } = opts;
    if (this._modules.has(moduleId)) {
      throw new Error(`[Registry] 模块已注册: ${moduleId}`);
    }
    if (futureOnly) {
      // 未来模块：只登记占位，不允许运行时被调用。
      this._modules.set(moduleId, { handler: null, version, ownerNamespace: null, enabled: false, futureOnly: true });
      return;
    }
    if (!handler || typeof handler.process !== 'function') {
      throw new Error(`[Registry] 模块 ${moduleId} 必须提供 handler.process()`);
    }
    if (ownerNamespace && !STATE_OWNERS[ownerNamespace]) {
      throw new Error(`[Registry] 模块 ${moduleId} ownerNamespace 未定义: ${ownerNamespace}`);
    }
    this._modules.set(moduleId, { handler, version, ownerNamespace, enabled, futureOnly: false });
  }

  setEnabled(moduleId, enabled) {
    const entry = this._modules.get(moduleId);
    if (!entry) throw new Error(`[Registry] 模块未注册: ${moduleId}`);
    if (entry.futureOnly) throw new Error(`[Registry] future 模块不可启用: ${moduleId}`);
    entry.enabled = !!enabled;
    return this;
  }

  isEnabled(moduleId) {
    const entry = this._modules.get(moduleId);
    return !!(entry && entry.enabled && !entry.futureOnly);
  }

  setFlag(flag, value) {
    if (!(flag in this._flagDefaults)) throw new Error(`[Registry] 未知 feature flag: ${flag}`);
    this._flagDefaults[flag] = !!value;
    return this;
  }

  /** 固化当前 flags 快照，供 session 使用。 */
  flagSnapshot() {
    return Object.assign({}, this._flagDefaults);
  }

  getModule(moduleId) {
    return this._modules.get(moduleId) || null;
  }

  list() {
    return Array.from(this._modules.entries()).map(([id, e]) => ({
      id,
      version: e.version,
      ownerNamespace: e.ownerNamespace,
      enabled: e.enabled,
      futureOnly: e.futureOnly
    }));
  }
}

module.exports = { ModuleRegistry };
