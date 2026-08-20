# TCIM Module Contract

统一接口（01-2 第4节）。不允许出现“把整个 Prompt 塞进一个 string 再让下游自己猜”的接口。

## ModuleInput

```ts
{
  session_id: string,
  turn_id: string,          // 每轮 immutable
  question_id: string,      // Q1..Q10
  turn_context: {
    teacher_turn: string,   // 本轮原始回答
    teacher_ranking: string[], // 前测排序（prior 输入）
    question_id: string,
    item_package: object|null, // Ontology 专业数据包（只读）
    timing: { received_at: number }
  },
  shared_state_snapshot: object,  // 只读快照
  module_config: object
}
```

## ModuleResult

```ts
{
  module_id, module_version,
  observations: [],
  state_updates: { namespace: patch },  // 只允许自己的 namespace
  action_proposals: [{
    action_type: 'PROBE'|'CONFIRM'|'COMPARE'|'REFRAME'|'SHIFT_CANDIDATE'|'STOP_CANDIDATE'|'CLOSE',
    target_slot, professional_objective, probe_strategy,
    priority, expected_evidence, hard_constraints[], supporting_refs[],
    confidence, rationale_code, reason_summary
  }],
  constraints: [],
  confidence: number,
  evidence_refs: [],
  decision_summary: string,   // 简洁可审计
  diagnostics: []
}
```

ModuleResult 禁止直接携带 `teacher_visible_text` —— 模块不得直接生成教师可见文本。

## ProfessionalActionPlan（Orchestrator 唯一产出）

```ts
{
  action_type, target_slot, professional_objective, probe_strategy,
  hard_constraints[],
  action_fingerprint,   // 锁定专业目标（改目标则指纹变）
  source_module_versions[]
}
```

## 校验规则

- `validateModuleInput` / `validateModuleResult(moduleOwner)` / `validateProfessionalActionPlan`
- `state_updates` 非 owner namespace → ContractError
- action_proposals 的 action_type 必须在枚举内
- fingerprint 由 `fingerprintActionPlan` 计算（改 target_slot/objective/probe_strategy 则变）
