# TCIM 模块化架构（MODULAR_ARCHITECTURE）

依据《01-1 TCIM总体架构》《01-2 TCIM工程执行规范》2026.08 统一架构版。

## 定位

TCIM 目标不是“更会聊天的通用大模型”，而是把教师专业谈话中关键的判断过程显式化：

```
教师回答 → TurnContext Builder → [Ontology 模块] → [Decision Orchestrator] → [PRDM] → [Generator] → 教师可见回复
```

- Ontology 维护 Evidence State 并提出专业候选行动。
- Orchestrator 决定本轮最终 ProfessionalAction（WHAT TO DO）。
- PRDM 决定怎样接话、挑战多强、问题多重、AI 说多少（HOW TO CONTINUE）。
- Generator 负责自然语言实现（HOW TO SAY）。
- RAG 只在确有知识需求时按需提供知识，不替代 Ontology，也不修改 Evidence State。

## 目录

```
tcim/
├── core/
│   ├── contracts.js        # ModuleInput/ModuleResult/ProfessionalActionPlan schema + 校验
│   ├── shared_state.js     # namespace 所有权
│   ├── module_registry.js  # feature flags + 模块注册
│   ├── module_runner.js    # 按 flags 运行模块，校验越权/崩溃 fallback
│   ├── orchestrator.js     # Stage A/B + ReRank + protected action fingerprint
│   ├── turn_context.js     # 组装模块标准输入
│   └── index.js            # 统一入口
├── modules/
│   ├── ontology/           # V0.1 active（Task 3 实现）
│   ├── prdm/ rag/ utility/ teacher_state/ metacognition/  # future disabled
├── professional_data/game_support/   # 5张专业表 × 10 题数据化（Task 2）
└── tests/
```

## 模块边界（不可违反）

| 组件 | 拥有 | 不得承担 |
|---|---|---|
| TurnContext Builder | 整合输入 | 专业判断 |
| GameSupportOntologyModule | Evidence Slot/Anchor/State、优先级、候选行动、Prune/Reopen 建议 | 生成教师可见文本；改其他模块状态 |
| Decision Orchestrator | 唯一 ProfessionalActionPlan | 重新解释专业证据 |
| PRDM | dialogue_state、对话策略 | 改 target_slot/objective/probe_strategy/STOP |
| RAG | 按需知识、权限 | 改 Evidence，不定义 Slot |
| Generator | 语言实现 | 重新选择目标 |
| Constraint Checker | 硬约束检查 | 改变专业行动 |

## 状态所有权

| namespace | owner | 其他模块 |
|---|---|---|
| session_state | Core | 只读 |
| ontology_state/evidence_state | Ontology | 只读；可 proposal |
| dialogue_state | PRDM | 只读最近值 |
| rag_runtime_state | RAG | 只读 |
| teacher_state | Future Teacher State | 未启用 |
| evaluation_state | Logger | append-only |
