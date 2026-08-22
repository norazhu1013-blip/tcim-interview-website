# TCIM_INTEGRATION_MAP —— TCIM 接入点映射（Task 1 只读审计）

> 目标：明确 TCIM 各模块接入现有平台的最小改动点，避免重写已可用的测评功能。

## 一、TCIM 现有实现（`tcim/` + `web/src/core/tcim/`）

| TCIM 组件 | 位置 | 状态 |
|---|---|---|
| Contracts / SharedState / Registry / Runner | `tcim/core/` | ✅ |
| Orchestrator（Stage A/B + ReRank + fingerprint） | `tcim/core/orchestrator.js` | ✅ |
| Evidence State + Ontology 模块 | `tcim/modules/ontology/` | ✅ |
| PRDM / RAG / Utility / TeacherState / Metacognition | `tcim/modules/` | ⚠️ future disabled |
| 5 表数据化 | `tcim/professional_data/game_support/` | ✅ |
| 网页确定性引擎 | `web/src/core/tcim/engine.js` | ✅（默认 ont） |
| 模式开关 | `web/src/core/tcim/mode.js` | ✅ `VITE_TCIM_MODE=ont\|legacy` |

## 二、接入点清单（最小改动）

### 1. 前测资料 / 过程数据 → TurnContext（**当前缺口**）
- **现状**：`engine.js` 只用 `final_ranking` + 3 个过程标签做 prior。
- **应接**：
  - 教师资料（姓名/园所/教龄）—— `web/src/services/storage.js getProfile()`
  - 过程数据完整 8 项 —— `web/src/core/process.js`（现只传了 首位强摇摆/末位强摇摆/振荡 三个标签）
  - 前测分数/常模位 —— `session.scores`（`computeScores` 输出）
- **落点**：`web/src/core/tcim/engine.js` 的 `initTcisSession(itemId, ranking, tags)` → 扩展为接收完整 `pretest` 对象。
- **不重写**：评分/过程指标计算仍用现有 `scoring.js` / `process.js`。

### 2. 教师回答 → Evidence（已有）
- `engine.js updateEvidence()` 已用表2 锚点更新 Evidence Slot。
- 证据 spans 存 `supporting_spans` / `conflicting_spans`（回指原话）。

### 3. 下一问生成（已有，TCIM/legacy 分叉）
- `InterviewView.requestNext()`：
  - TCIM → `engine.js processTeacherTurn()`
  - legacy → `api.interviewNext()` → `gsyg_interviewChat`
- **PRDM 接入点**：TCIM 分支内，`processTeacherTurn()` 产出 `actionPlan` 之后、`generateQuestion()` 之前 —— 插入 PRDM 决定 stance/move/load/dose，再交给 Generator。

### 4. 模块化内核接入（Node 侧已有，网页侧未用）
- `tcim/core/index.js` `createCore()`：注册模块、运行 Runner、注入数据。
- 网页 `engine.js` 是**独立实现**（未复用 `tcim/core`）。两处逻辑应保持对齐，避免分叉：
  - `evidence_updater.js`（Node）与 `engine.js`（Web）的 bigram 匹配**参数需一致**（RATE_MIN/HITS_MIN/同义词表）。
- **建议**：网页引擎作为 `tcim/core` 的 ESM 薄封装（本轮先保证参数一致，不强制重构）。

### 5. Replay / 日志（**当前缺口**）
- `tcim/tests/*.test.js` 验证逻辑；网页只在 localStorage 存 `tcimSession`。
- **应加**：每轮结构化日志（ModuleResult / Evidence before-after / Orchestrator 选择 / PRDM DialoguePlan / Generator 输出 / 版本 / 时间戳）。
- 落点：`engine.js` 的 `processTeacherTurn()` 返回里附带 `replay` 事件；网页持久化到 `session.interview[itemId].tcimReplay`。

### 6. 特征开关
- 网页：`web/src/core/tcim/mode.js`（`VITE_TCIM_MODE`）。
- 内核：`tcim/core/module_registry.js`（`prdm_v01` / `rag_v01` 等 flag）。
- 关闭 `tcim_modular` 即完全回 legacy —— 已由 `mode.js` 保证。

## 三、TCIM 各模块与现有平台的责任边界

| 数据/能力 | 属主 | 现状 | TCIM 接入 |
|---|---|---|---|
| 评分（查表） | 确定性 | `scoring.js` | **不接**，AI 不参与 |
| 过程指标 | 确定性 | `process.js` | 作为 prior 线索（**不直接判能力**） |
| 前测分数/排序 | 前测 | session.scores | prior 初始化 |
| 访谈问题生成 | TCIM（ont）/ LLM（legacy） | `engine.js` / `gsyg_interviewChat` | 模式开关 |
| 访谈记录上报 | 现有 | `reportInterview` | 访谈完成后照常上报 |
| R/P/G 遴选 | 现有 | `gsyg_selectFinal` | **不接**，保持服务端 |

## 四、最小接入结论

1. **本轮立即做**：Replay 日志（接入点 5）、Generator/Constraint 完整层、PRDM（接入点 3）。
2. **待做**：前测完整资料进 TurnContext（接入点 1）—— 需确认研究团队期望哪些字段参与 prior。
3. **不做**：评分/遴选改造（红线）。
