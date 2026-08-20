# TCIM Future Modules（禁用占位）

以下模块按 01-1 架构属于未来阶段，**当前只允许占位注册，不允许返回伪结果**。
只有当稳定失效模式证明需要时，才按「MODULE_PROPOSAL → Contract/ADR → 独立实现 → 消融」流程启用。

| 模块 id | 拥有 namespace | 计划阶段 | 进入条件 |
|---|---|---|---|
| `prdm` | `dialogue_state` | V0.1 Dialogue | Ontology-only 基线稳定后，Gold Set 通过 |
| `rag` | `rag_runtime_state` | V0.1 Knowledge | 出现稳定知识 grounding/支持需求且权限可控 |
| `utility` | — | V0.2 | 真实数据证明行动选择效率是瓶颈 |
| `teacher_state` | `teacher_state` | V0.3+ | Interaction Read 不足以处理跨轮稳定状态 |
| `metacognition` | — | V0.3+ | 需要独立判断何时促反思 |

**占位规则**：future 模块注册后 `enabled=false`，Registry 拒绝启用；ModuleRunner 跳过。
若任何代码尝试调用 future 模块并返回假结果，属于 contract violation。
