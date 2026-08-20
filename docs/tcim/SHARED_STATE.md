# TCIM Shared State 所有权

每个 state namespace 只有一个 owner；其他模块只能读取或提出 proposal/constraint。

| namespace | owner | 内容 |
|---|---|---|
| `session_state` | Core | session 状态、question_id、turn_id |
| `ontology_state` | Ontology | `evidence_state`：每个 EvidenceSlotState |
| `dialogue_state` | PRDM | 对话策略局部状态 |
| `rag_runtime_state` | RAG | cache/route 摘要 |
| `teacher_state` | Future Teacher State | 未启用 |
| `evaluation_state` | Logger | append-only |

## EvidenceSlotState

```ts
{
  slot_id,
  status: 'UNKNOWN'|'PARTIAL'|'SUFFICIENT'|'HIGH_QUALITY',
  level: 0..3,
  confidence: 0..1,
  supporting_spans: [],   // teacher_quote 回指
  conflicting_spans: [],
  false_evidence_flags: [],
  uncertainty: 0..1,       // 前测先验不确定度
  probe_status: 'OPEN'|'PRUNED'|'REOPEN_CANDIDATE'|'SATURATED',
  probe_count: number,
  last_updated_turn: string,
  state_version: string
}
```

## 写入规则

- 模块只能通过 `applyStateUpdates(shared, moduleOwner, patch)` 更新自己的 namespace。
- 跨模块影响只能以 observation / action_proposal / constraint / signal 提交给 Core。
- 测试必须构造「模块试图修改他人 namespace」的非法 ModuleResult 并确认 Core 拒绝（contracts.test.js 已覆盖）。
