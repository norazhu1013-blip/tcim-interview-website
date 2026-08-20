# TCIM Roadmap（V0.1 分阶段）

| 阶段 | 组成 | 状态 |
|---|---|---|
| Task 0 | Modular Kernel（Contracts/SharedState/Registry/Orchestrator 骨架/ADR/contract tests） | ✅ 完成 |
| Task 1 | 只读代码审计（现有网页、LLM、DB、日志、接入点） | ⏳ 下一步 |
| Task 2 | 10题五类专业数据数据化 + 跨表校验 | ✅ 完成 |
| Task 3 | Evidence State Engine / GameSupportOntologyModule | ⏳ 进行中 |
| Task 4 | ReRank + Orchestrator + protected action | ⏳ |
| Task 5 | Module Runner 接网页 + Replay + feature flags | ⏳ |
| Task 6 | 模拟/压力/回归 + baseline metrics | 待前序 Gate |

## 完成标准（01-1 第16节，选录）

- Ontology 关闭后系统仍能运行 legacy 路径；它不是硬编码中心。
- 10 题作为一个能力域模块的数据包工作，核心代码没有大规模题号特例。
- Evidence State 只有 Ontology 可写；PRDM/RAG/Generator 无写权限。
- Orchestrator 拥有唯一 ProfessionalActionPlan；PRDM 只能输出 DialoguePlan。
- PRDM ON/OFF 对同一教师回答的 Evidence Update 一致。
- 教师端不显示评分、Evidence 等级、Top3、诊断标签或内部理由。
- 新增 FakeUtilityModule 不需修改 Ontology 内部代码即可接入 Orchestrator。
