# TCIM V0.2 部署与真实验收 · 操作者执行清单（Runbook）

> 面向**执行者**（非设计者）的一步步可照做清单。包含：前置环境变量、部署命令、本地验证命令、
> 每个云函数冒烟（看哪个字段）、网关检查、失败排查表。
> 前置阅读：`V0.2_MIGRATION_AND_DEPLOYMENT.md`（架构/模块/验收分层）。红线和边界不变。

---

## 0. 目标

把 V0.2 的 **AI 语义层 + Planner/Gate** 从"本地确定性回退"切到"真实 LLM 路径"，
并**证明**：网关可达、云函数返回合法 Proposal/Decision、Replay 的 source 显示 `cloud`（而非 offline/local）、
打分红线与 G05/泄露未破坏。

**关键心智**：整条链是**失败静默降级**——缺 key/网关/LLM 超时都回退，不报错。所以：
- 不能只看"没报错"；要同时看**云函数返回的 `fallback` 字段** + **Replay 的 provider/source 是否非 offline/local**。
- 真实验收必须**先部署 + 配 key**，本地 canned provider 只能证明机制，不能证明真实 AI 精度。

---

## 1. 前置：确认三个云函数可部署

在微信开发者工具仓库根打开（`project.config.json` 已指向 `miniprogramRoot/` + `cloudfunctionRoot/`）。
新建/确认这三个函数目录存在：`cloudfunctions/gsyg_semanticProbe/`、`gsyg_planner/`、`gsyg_webGateway/`。

> ⚠️ 运行时**必须 Nodejs 18+**（`wx-server-sdk` 的 `cloud.ai` 需要）。若建的是 Node16 → 右键删函数重建（不能就地改版本）。

---

## 2. 配置环境变量（按所选 LLM provider）

### 2.1 `gsyg_semanticProbe`（A00/A01 语义，Profile=`SEMANTIC_PROFILE`）
云函数配置 → 环境变量：

| 变量 | 值 | 何时 |
|---|---|---|
| `SEMANTIC_PROFILE` | `wxai`（默认）｜`deepseek`｜`openai-compatible` | 一直 |
| `LLM_TIMEOUT_MS` | `20000` 或更高 | 建议 |
| `SEC_CHECK` | `1`（可选，开 msgSecCheck v2 scene:4） | 上线建议 |

**wxai 路径**：`WXAI_PROVIDER=cloudbase`、`WXAI_MODEL=hy3-preview`（需控制台「AI+」开通该模型）。
**deepseek**：`DEEPSEEK_API_KEY=<key>`、`DEEPSEEK_MODEL=deepseek-chat`、`DEEPSEEK_TEMPERATURE=0.1`、`DEEPSEEK_MAX_TOKENS=900`。
**通用第三方**：`OPENAI_COMPATIBLE_ENDPOINT`、`OPENAI_COMPATIBLE_API_KEY`、`OPENAI_COMPATIBLE_MODEL`（三选一都必填）；`OPENAI_COMPATIBLE_TEMPERATURE=0.1`、`OPENAI_COMPATIBLE_MAX_TOKENS=900`。

### 2.2 `gsyg_planner`（A03/A04 规划 + Gate，Profile=`PLANNER_PROFILE`）
同上，但用 `PLANNER_PROFILE`（默认 `wxai`）+ 相同的 `DEEPSEEK_*` / `OPENAI_COMPATIBLE_*` / `WXAI_*` 配置。

### 2.3 `gsyg_webGateway`（网关，复用现有）
| 变量 | 值 |
|---|---|
| `GSYG_WEB_GATEWAY_TOKEN` | ≥32 字节随机值（三函数同配） |
| `GSYG_WEB_SESSION_SECRET` | 网关独立强随机 |
| `WEB_CLOUDBASE_ENV_ID` | CloudBase 环境 ID（= `VITE_CLOUDBASE_ENV_ID`） |
| `WEB_ALLOWED_ORIGIN` | 精确前端来源（CORS） |

> 每个下游函数（`gsyg_semanticProbe`/`gsyg_planner`）也要配同一 `GSYG_WEB_GATEWAY_TOKEN`，网关调用时校验。

---

## 3. 部署（上传云函数）

微信开发者工具 → 云开发 → 云函数 → 逐个右键 **「上传并部署：云端安装依赖」**：
1. `gsyg_semanticProbe`（确认列表含 `index.js/package.json/semantic_core.js`）
2. `gsyg_planner`（确认列表含 `index.js/package.json/planner_core.js`）
3. `gsyg_webGateway`（重传，白名单生效）

> 完成后，`ACTIONS` 里应有 `semanticProbe: 'gsyg_semanticProbe'` 和 `planner: 'gsyg_planner'`。

---

## 4. 网页构建配置（`web/.env`）

编辑 `web/.env`（从 `.env.example` 复制）：

| 变量 | 值 |
|---|---|
| `VITE_WEB_API_BASE_URL` | 网关地址，如 `https://gsyg.age08.cn/gsyg-web` |
| `VITE_CLOUDBASE_ENV_ID` | CloudBase 环境 ID |
| `VITE_TCIM_MODE` | `ont`（TCIM 确定性访谈；V0.2 语法在此模式生效） |
| `VITE_TCIM_V2` | `1`（开启 V0.2 双状态链 + Planner/Gate） |
| `VITE_TCIM_SEMANTIC_MODE` | `fallback_allowed`（语义/规划走云端，缺则本地回退）；`disabled`=纯规则基线 |

> `VITE_TCIM_RAG` / `VITE_INTERVIEW_LLM_PROFILE` 仅 legacy 模式相关，V0.2 不需要。

### 4.1 ⚠️ 网页 V0.2 构建必须处理 CJS 导入（`module is not defined` 坑）

网页 `web/src/core/tcim/engine.js` 以 **ESM 命名空间导入仓库 `tcim/modules/*.js`（CJS 源码）**（如 `belief_state`/`teacher_model`/`agent_planner`/`decision_gate`/`challenge_queue`/`prdm_v2`/`knowledge_need`/`evidence_updater`）。
这些是 **纯逻辑 CJS**，Vite 的 `@rollup/plugin-commonjs` 默认**不转换 node_modules 之外的源码**，会把 `module.exports` 原样带进浏览器包 → 运行时 `module is not defined` 崩溃。

两个必须同时满足，缺一不可：
1. **`web/vite.config.js`** 必须含 `build.commonjsOptions.include: [/tcim\/[a-z]+\//, /node_modules/]`，让插件确定性把**整个 `tcim/` 树**(`core/` + `modules/`)的 CJS 转成 ESM。⚠️ 仅覆盖 `/tcim\/modules\//` 不够——`tcim/modules/*` 会 require `tcim/core/contracts.js`(STATE_OWNERS/TABLE_ALIGNMENT 等)，若 `core/` 没被转换，`contracts.js` 的 `module.exports` 会泄漏。
2. **导入回退**用 `ns.default || ns`，**不要**用 `ns['module.exports']`——后者可能被 minifier 改写成裸 `module` 引用。

**验证方法**：`cd web && npm run build` 后，确认 `dist/assets/index-*.js` 里 `module.exports` 出现次数为 **0**。若 >0，说明构建未走 CJS 转换，需检查 `commonjsOptions.include` 是否覆盖整个 `tcim/`。
> 旧缓存/旧包（文件名如 `index-CC5HCUkb.js`）若有残留会继续报错；务必用**新构建产物**发布。

---

## 5. 本地验证命令（无需云端/网络，先确保机制无回归）

在仓库根（`bash`，Git Bash）跑：

```bash
# 云函数纯逻辑
node cloudfunctions/gsyg_semanticProbe/semantic_core.test.js
node cloudfunctions/gsyg_planner/planner_core.test.js

# Node 内核 V0.2 + 既有回归
node tcim/tests/v2_belief.test.js
node tcim/tests/v2_teacher_model.test.js
node tcim/tests/v2_planner_gate.test.js
node tcim/tests/v2_double_state.test.js
node tcim/tests/v2_challenge_policy.test.js
node tcim/tests/stress_regression.test.js   # 期望 Evidence 升级=6 / 冲突=0 / low=0（disabled 基线）

# 网页（Vite 编译 CJS 导入 + TCIM smoke + V2 用例）
cd web
node src/core/tcim/engine.test.mjs   # 期望 10/10
node src/core/tcim/semantic.test.mjs # 期望 passed
npm run verify && npm run build      # 期望 exit 0（含 parity + V7.4 + build）
```

---

## 6. 云函数冒烟（部署后，控制台「云函数测试」）

### 6.1 `gsyg_semanticProbe`
传最小事件：`{ "teacherTurn": "我会先看地面湿不滑，篮球架附近有没有别的孩子。", "itemId": "Q1", "anchors": [] }`
看返回：`{ ok:true, proposal:{ slot_evidence_proposals:[], ...}, fallback, llmProfile }`

### 6.2 `gsyg_planner`
传最小事件：`{ "itemId": "Q8", "teacherModel": {}, "evidence": {}, "beliefState": { beliefs:{}, version:0 } }`
看返回：`{ ok:true, decision:{ selected_action_id, primary_target_slot, claimed_table_alignment, claimed_risk_level }, gate:{ decision }, fallback, llmProfile }`

**冒烟判据（看 `fallback` 字段，不要看 `ok`——`ok` 恒 true）**：
| `fallback` | 含义 |
|---|---|
| 空 / 不以 `semantic_`·`planner_`·`G05_`·`msgSecCheck` 开头 | ✅ 真通了（LLM 产出合法结果） |
| `semantic_llm_error:` / `planner_llm_error:` | ❌ LLM 调用失败 → 查 key/endpoint/网络/超时 |
| `G05_violation:` / `G05_able_judge` | ⚠️ 模型输出能力/人格判定词，被拦截（提示词要收紧；链路本身通） |

---

## 7. 网关可达性（浏览器 DevTools Network）

在网页访谈页触发一次语义/规划调用，找 `POST {VITE_WEB_API_BASE_URL}/call`，`body: {action:'semanticProbe'|'planner'}`：

| HTTP | error | 排查 |
|---|---|---|
| 200 | `{ ok:true, ... }` | ✅ |
| 400 | `unsupported_action` | 网关未重传 || `ACTIONS` 缺 `planner` |
| 401 | `not_authenticated` | 网关会话未建 → 查 `web-auth.js` 匿名登录链 |
| 502 | `upstream_function_failed` | 下游云函数失败 → 回第 6 步 |
| 503 | `gateway_token_not_configured` | 网关未配 `GSYG_WEB_GATEWAY_TOKEN` |
| 无请求 | — | `semanticEnabled()/plannerEnabled()` 为 false → 查 `VITE_WEB_API_BASE_URL` / `VITE_TCIM_PLANNER=0` |

---

## 8. 真实验收（Replay 是唯一硬依据）

访谈一轮后，读 `session.contextual_belief_state` / `interview[itemId].tcimReplay`(网页) 或 `results[0].diagnostics`(Node)：
- 出现 `SemanticEvent` + `BeliefEvent` + `TeacherModelEvent` + `PlannerEvent` + `GateEvent`；
- **关键**：语义/规划的 `provider`/`source` 为 **`cloud`**（`semanticLLM`/`plannerLLM` 云端成功），而非 `offline`/`local`/`invalid`。
  若全是 `offline`/`local` → 语义/规划层未真正走云端，回查第 6/7 步。

**Q8 语义核验**（人工）：教师答「我会先让他停一下，把管子恢复原样，只改坡度……」，应看到：
- `slot_evidence_proposals` 含 `Q8-S4`（proposed_level≥1）+ 相关 span 回指原话；
- Planner 选到能区分信念的槽（如 `Q8-S4`），Gate APPROVE；
- 首问（若已触发）非固定模板、不泄露。

---

## 9. 失败排查速查表

| 现象 | 原因 | 排查 |
|---|---|---|
| 部署后网页语义/规划没生效 | 网关白名单未重传 / `VITE_TCIM_V2` 未设 `1` / 网关不可达 | 第 7 步 Network |
| `fallback=semantic_llm_error` | 缺 key / endpoint 错 / 模型未开通 / 超时 | 云函数 env + `LLM_TIMEOUT_MS` |
| Replay 全 `offline`/`local` | 回退路径生效（网关失败 or 未配置） | 第 6/7 步 |
| `400 unsupported_action` | 网关 `ACTIONS` 缺 `planner` | 重传 `gsyg_webGateway` |
| `401` | 网关会话未建 | `web-auth.js` 匿名登录 |
| `502` | 下游云函数 crash | 日志回第 6 步 |
| 首问固定模板没走 AI | `VITE_TCIM_V2` 未开 / mode=disabled | `.env` 设 `VITE_TCIM_V2=1` + `VITE_TCIM_SEMANTIC_MODE=fallback_allowed` |

---

## 10. 回滚 / 降级

- 任意一步失败 → 网页 `.env` 设 `VITE_TCIM_V2=0`（或 `VITE_TCIM_SEMANTIC_MODE=disabled`）重建，即回纯规则基线（6/720）。
- 语义/规划回退是**自动**的：网关/key 失败即本地确定性/空 Proposal，TCIM 不崩、不泄露、不改分。
