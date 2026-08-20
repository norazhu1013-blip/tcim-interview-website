# TCIM Orchestration Policy

## 二阶段决策

```
ModuleResult[] → Stage A → ProfessionalActionDraft + knowledge_need
                     │
                     ├── knowledge_need=true → RAGModule（按需，V0.1 不启用）
                     │
                     └── Stage B → ProfessionalActionPlan + action_fingerprint
```

- Stage A/Stage B 都不得直接生成教师可见文本。
- 单一模块不得拥有全局 STOP；只能返回 STOP_CANDIDATE / local_complete 信号。
- Orchestrator 记录“选了哪个 proposal、拒绝哪些、为何需要/不需要 RAG”的简短理由。

## ReRank 分数（V0.1 可解释规则）

```
score = w_professional * professional_priority
      + w_gap * evidence_gap
      + w_uncertainty * pretest_uncertainty
      + w_conflict * conflict_bonus
      - w_cost * probe_cost
```

默认权重：`{ professional_priority: 1.0, evidence_gap: 1.0, pretest_uncertainty: 0.5, conflict_bonus: 1.2, probe_cost: 0.3 }`。

## RAG 条件调用

- RAG 默认 R0 不调用；仅 `knowledge_need=true` 才创建 RAGRequest。
- V0.1 `decideKnowledgeNeed` 恒 false（RAG 未启用）。
- RAGResult 只能作为 support evidence/constraint，不得包含 EvidenceStateMutation。

## protected action

- `fingerprintActionPlan(plan)` 锁定 `action_type/target_slot/professional_objective/probe_strategy`。
- PRDM/Generator 输出必须通过一致性校验；改目标即指纹不匹配。
