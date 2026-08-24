# gsyg_planner —— TCIM V0.2 A03 AI Agent Planner + A04 Decision/Risk Gate

## 做什么

- 基于教师情境快照（Teacher Model）+ 当前 Evidence + Belief，让 **AI 比较候选并选出一个绿色（低风险）下一专业行动**（A03 Planner），输出 `AgentDecisionProposal`。
- 云函数内置确定性 **Risk Gate（A04）** 裁决：APPROVE / CLARIFY / REJECT + adjudicated risk/table_alignment；Gate 只验证/升级/降级，**不重做选择**。
- AI 只出 Proposal（selected_action）；不写 `core.action_plan`、不写 Evidence、不改 Production 五表。

## 与 gsyg_semanticProbe 的关系

- `gsyg_semanticProbe` = A00/A01（情境理解/语义分析，出 `slot_evidence_proposals`）。
- `gsyg_planner` = A03/A04（行动选择 + 风险裁决，出 `AgentDecisionProposal` + `DecisionGateResult`）。
- 两端都走同一个网关白名单；都只出 Proposal，不做状态写入。

## 部署

1. **微信开发者工具** → 云开发 → 云函数 → `gsyg_planner` → 右键「上传并部署（云端安装依赖）」。
   上传前确认文件列表：`index.js` / `package.json` / `planner_core.js`。
2. **运行时必须 Nodejs 18+**(`wx-server-sdk` 的 `cloud.ai` 需要)。若锁了 Node16，删了重建。
3. **云函数配置 → 环境变量**（按所选 LLM provider，无一套通吃默认）：

| 变量 | 说明 | 默认 | 何时必配 |
|---|---|---|---|
| `PLANNER_PROFILE` | 内置配置组 | `wxai` | 换 deepseek / 通用第三方才改 |
| `LLM_TIMEOUT_MS` | 单次 LLM 超时 ms | `18000` | 建议 ≥20s |
| `SEC_CHECK` | `1` 开 `security.msgSecCheck` 机审 | 不开 | 上线建议开(可选) |

**wxai 路径（默认）**：`WXAI_PROVIDER=cloudbase` / `WXAI_MODEL=hy3-preview`(需在云开发控制台「AI+」开通)。

**deepseek 路径**：`DEEPSEEK_API_KEY`(必填) / `DEEPSEEK_MODEL=deepseek-chat` / `DEEPSEEK_TEMPERATURE=0.1` / `DEEPSEEK_MAX_TOKENS=900`。

**通用第三方**：`OPENAI_COMPATIBLE_ENDPOINT/API_KEY/MODEL`(三选一都必填) / `OPENAI_COMPATIBLE_TEMPERATURE=0.1` / `OPENAI_COMPATIBLE_MAX_TOKENS=900`。

4. **执行超时 ≥ 30s**（推荐 60s），否则平台先杀函数。
5. 若开 `SEC_CHECK=1`，需在 openapi 权限勾选 `security.msgSecCheck`。

## 本机验证（无需云端 / API Key）

```bash
node cloudfunctions/gsyg_planner/planner_core.test.js
```
纯 Node，用伪造 LLM JSON 驱动决策链（合法 / G05 / 泄露 / 结构 / Gate 裁决），任何环境可跑。

## 要让网页端真正调用，还需（不在本函数内部）

1. **重传 `gsyg_webGateway`**：让 `planner: 'gsyg_planner'` 白名单生效（网关自身环境变量复用现有）。
2. **重建并发布网页**：`VITE_WEB_API_BASE_URL` 指向网关、`VITE_CLOUDBASE_ENV_ID` 正确。
   缺网关/缺 key 时 `web/src/services/plannerLLM.js` 自动回退本地确定性 Planner——TCIM 能用、不泄露、不写状态。

## 红线（实现已守住）

- planner 只出 `AgentDecisionProposal`，不写 `core.action_plan` / Evidence / Production 五表。
- G05：不因短答/犹豫/礼貌/流畅推断能力/人格/动机（服务端拦截）。
- 泄露：得分/标准答案/专家排序/评分/R-P/G 一律不出现。
- Gate 只裁决、不重做选择。

## canonical 源文件

- `index.js`：云函数入口（LLM I/O + secCheck + 包装）。
- `planner_core.js`：纯逻辑层（normalize / validate / adjudicate），无 SDK / 无网络，可本地测试。
- `planner_core.test.js`：本地测试（纯 Node）。
