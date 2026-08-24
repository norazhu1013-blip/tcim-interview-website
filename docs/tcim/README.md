# TCIM 文档索引（docs/tcim/）

> 本目录是 TCIM（专业谈话智能系统）的**文档索引 + 权威来源说明**。
> 所有文件按「实现记录 / 定性结论 / 权威参考(V0.1+V0.2) / 部署手册」四类归档，避免后续 agent 重复挖掘。

---

## 一、权威参考（研究团队 docx 的可读归档,按 V0.2 为准）

| 文件 | 来源 | 用途 |
|---|---|---|
| `V0.2_SECOND_BATCH_REFERENCE.txt` | 研究团队《第二批.zip》(2026-08-24, 5 份 V0.2: 01-3 开发操作手册 / 03-1 PRDM 架构 / 03-2 PRDM 工程规范 / 04-1 RAG 总架构 / 第一阶段工程总说明) | PRDM A06/A07、RAG KnowledgeNeedProposal、开发 Runbook、AI 作用说明的**权威 V0.2 口径** |
| `Q8_AI_EXAMPLE_REFERENCE.txt` | 研究团队 docx(TCIM-Q8-AI-EXAMPLE-01, V0.3) | Q8 首问 + 三步 Evidence 循环的权威行为示例(调用序/Proposal/验收) |
| `AI_INTERVENTION_VERDICT.txt` | 研究团队「AI 作用」「AI 介入」定性 × 多轮 | 「AI 是否真正介入 Evidence 判断」的结论(第六~九节是下一步方向) |

> **优先级**：V0.2 材料(第一批总方案/01-1/01-2/02-x/责任表 V0.2 + 第二批)是**当前编码基线**；与 V0.1 或旧版冲突时以 V0.2 为准。V0.1 docx 仅历史追溯。

## 二、实现记录（迁移/重构）

| 文件 | 内容 | 关联 commit |
|---|---|---|
| `V0.2_MIGRATION_AND_DEPLOYMENT.md` | V0.2 全量迁移归档：新增能力/Belief/Planner/Gate/Challenge + 部署配置 + 分层验收 | V2-A→F / W / P / R |
| `EVIDENCE_LLM_ASSESSMENT.md` | Step 1(LLM 语义预筛 + 确定性裁决)落地记录 | M1 / M2 |
| `CURRENT_FLOW.md` | 网页+小程序完整调用链 | Task1 |
| `TCIM_INTEGRATION_MAP.md` | TCIM 接入点映射(前测/Evidence/下一问/RAG/责任边界) | Task1 |
| `MODULAR_ARCHITECTURE.md` | 模块化内核架构 | Task0 |
| `MODULE_CONTRACT.md` | 模块统一接口 + 所有权规则 | Task0 |
| `SHARED_STATE.md` | SharedState 命名空间 owner + 只读快照 | Task0 |
| `ORCHESTRATION_POLICY.md` | Orchestrator 决策策略(StageA/B + ReRank) | Task4 |
| `ROADMAP.md` | 模块化后续路线 | Task0 |

## 三、部署与验收（操作者）

| 文件 | 内容 |
|---|---|
| `DEPLOYMENT_RUNBOOK.md` | **操作者执行清单**：环境变量/部署命令/本地验证/云函数冒烟/网关检查/失败排查/回滚 |

---

## 来源说明(全局)

- **研究团队原始材料**：`DOC/`(题库/赋分/映射/10 题知识库 13 表/流程手册) + 各 `*.zip`(研究团队按批次交付，如 AI应用质疑及说明.zip、第一批.zip、第二批.zip)。
- **本目录为二次归档**：docx 经 `tools/dump_docs.py` 转成可读纯文本(保留调度序、Schema、验收项)；`*.txt` 存档正文，`*.md` 为总结/指北。
- 涉及**指标名称/赋分/访谈规则**时，以 `DOC/` 原始文件为准，勿凭记忆改写(见 `CLAUDE.md` §11)。

## 导航速查

- 问「AI 在哪介入 / 权属」→ `AI_INTERVENTION_VERDICT.txt`
- 问「V0.2 怎么改」→ `V0.2_MIGRATION_AND_DEPLOYMENT.md` + `Q8_AI_EXAMPLE_REFERENCE.txt`
- 问「PRDM/RAG V0.2」→ `V0.2_SECOND_BATCH_REFERENCE.txt`(03-x / 04-x 章节)
- 问「怎么部署验收」→ `DEPLOYMENT_RUNBOOK.md`
