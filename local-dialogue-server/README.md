# TCIM 本地 Dialogue Agent 服务

这是一个独立于云函数、可在本机运行的 HTTP 服务。它同时提供：

- Dialogue Agent：首问、后续追问、Evidence 提议和可撤销工作假设；
- Kimi K3 与 OpenAI 两种模型接入，以及无需密钥、必须显式进入且不计入正式结果的 mock 工程演示模式；
- 网页网关兼容端点：`/auth/session` 和 `/call`；
- 本地持久化，以及复用仓库原有 `advisor_port.js` / `advisor_norms.js` 的确定性三题遴选。

服务只使用 Node.js 内置模块和 `fetch`，不需要安装 npm 依赖。建议使用 Node.js 20 或更高版本（最低 18.15）。

## 快速启动

最简单的方式是在项目根目录双击 `启动本机比较版.cmd`。服务启动时会自动读取本目录的 `.env`，已经存在的进程环境变量优先；`.env` 已被 Git 忽略。服务启动后也可在本机网页中选择 Kimi、OpenAI 或模拟模式；选择会立即生效，不需要重启服务。

也可以在 PowerShell 中进入本目录，然后选择一种 provider。

### 无密钥试运行

```powershell
$env:TCIM_DIALOGUE_PROVIDER = 'mock'
node server.js
```

### Kimi K3

```powershell
$env:TCIM_DIALOGUE_PROVIDER = 'kimi'
$env:KIMI_API_KEY = '仅放服务端密钥'
$env:KIMI_MODEL = 'kimi-k3'
node server.js
```

默认兼容端点是 `https://api.moonshot.cn/v1/chat/completions`。可用 `KIMI_BASE_URL` 调整该官方域名下的 API 路径，用 `KIMI_MODEL` 设置模型名。

为防止密钥被误发，正常运行只接受官方 HTTPS 地址：OpenAI 为 `api.openai.com`，Kimi 为 `api.moonshot.cn`。只有注入 mock fetch 或连接 `localhost`/回环地址上的测试替身时，才可临时设置 `TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS=1`；该开关也不会放行局域网或公网第三方地址，研究运行不得开启。

为兼容第一版部署，`MOONSHOT_API_KEY` 也可作为 `KIMI_API_KEY` 的别名；两者都设置时优先使用 `KIMI_API_KEY`。仓库不含现成密钥。本机网页填写的密钥只会经回环接口写入本目录下被 Git 忽略的 `.env`，不会进入源码、运行数据、接口响应或服务日志。

### OpenAI

```powershell
$env:TCIM_DIALOGUE_PROVIDER = 'openai'
$env:OPENAI_API_KEY = '仅放服务端密钥'
$env:OPENAI_MODEL = 'gpt-5.6-sol'
node server.js
```

OpenAI provider 使用 Responses API、严格 JSON Schema，并固定发送 `store: false`。实现依据 [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) 和 [gpt-5.6-sol 模型说明](https://developers.openai.com/api/docs/models/gpt-5.6-sol)。

若未设置 `TCIM_DIALOGUE_PROVIDER`，服务按以下优先级自动选择：存在 `KIMI_API_KEY` 或 `MOONSHOT_API_KEY` 时用 Kimi；否则存在 `OPENAI_API_KEY` 时用 OpenAI；都没有时用 mock。网页遇到 mock 时不会自动开始访谈，必须由使用者明确进入演示；演示记录标为 `simulationOnly` 并从正式统计、上报和报告中过滤。密钥只由服务端使用；除本机模型设置页通过受限配置接口保存外，其他浏览器请求不能传入密钥，密钥也不会写入运行数据。

默认监听 `http://127.0.0.1:8787`。可复制 `.env.example` 了解全部环境变量；密钥只由本机服务读取和保存，接口只向网页返回“是否已配置”的布尔状态，不会返回密钥本身或写入运行数据。

## Dialogue Agent 协议

端点：

- `POST /v1/dialogue/first`：强制首问；
- `POST /v1/dialogue/next`：强制后续轮；
- `POST /v1/dialogue/turn`：由请求体的 `phase` 指定 `first` 或 `next`；
- `GET /v1/model-config`：读取当前 provider、模型、就绪状态及两类密钥是否已配置；
- `POST /v1/model-config`：本机选择 `kimi`、`openai` 或 `mock`，可选提交当前 provider 的 `api_key`；保存后立即热切换；
- `GET /health`：查看 provider、模型、就绪状态和超时配置。

模型配置接口固定返回：

```json
{
  "ok": true,
  "provider": "mock",
  "model": "mock-dialogue-v1",
  "ready": true,
  "configured": { "kimi": false, "openai": false },
  "restart_required": false
}
```

`POST` 请求体为 `{ "provider": "kimi|openai|mock", "api_key": "可选" }`。Kimi/OpenAI 不填写 `api_key` 会沿用已保存的密钥；填写时长度必须为 1–512 个字符、不能全为空白，也不能含换行或 NUL 字节。mock 不接受密钥。接口与其他本地端点共用回环来源和 CORS 安全门，只接受来自 `localhost`、`127.0.0.1` 或 `[::1]` 的页面。密钥不会出现在响应中。`.env` 通过同目录临时文件原子替换；在 Windows 上会显式移除继承权限，只允许当前用户、SYSTEM 和 Administrators 访问。

切换发生时，已经开始的一轮仍使用该轮启动时的 provider，下一轮才使用新选择，避免单轮请求中途换模型。正式访谈每轮还会携带 `expected_provider` 和 `expected_model` 会话锁；若另一标签页已切换全局模型，服务分别返回 HTTP 409 `provider_mismatch` 或 `model_mismatch`，不会静默混用模型继续保存正式数据。

首问示例：

```json
{
  "compiled_card": {
    "schema_version": "tcim-five-tables-v0.1",
    "item_id": "Q1",
    "scenarioBrief": { "scenarioId": "SC-Q1", "text": "幼儿正在生成新的玩水方式。" },
    "professionalLenses": [],
    "evidencePolicies": [
      {
        "evidenceClaimId": "ECL-Q01-PLAY-FRAME",
        "understandingId": "UND-Q01-001",
        "allowedResponseOrigins": ["RO0", "RO1", "RO2"],
        "minEvidenceLevel": "L2"
      }
    ],
    "dialoguePolicies": [],
    "synthesisPolicies": [],
    "rankingPrior": null,
    "processPrior": null
  },
  "history": [],
  "evidence_summary": {},
  "teacher_context": {},
  "session_id": "local-session-1",
  "item_id": "Q1"
}
```

后续轮需增加当前教师原话：

```json
{
  "phase": "next",
  "compiled_card": {
    "scenarioBrief": {},
    "professionalLenses": [],
    "evidencePolicies": [{
      "evidenceClaimId": "ECL-Q01-PLAY-FRAME",
      "understandingId": "UND-Q01-001",
      "allowedResponseOrigins": ["RO0", "RO1", "RO2"]
    }],
    "dialoguePolicies": [],
    "synthesisPolicies": [],
    "rankingPrior": null,
    "processPrior": null
  },
  "history": [
    { "role": "assistant", "text": "看到这个情境时，您最先注意到的是什么？" }
  ],
  "teacher_turn": "我会先看幼儿有没有继续尝试，也会留意同伴的反应。",
  "evidence_summary": {
    "confirmed": [],
    "open_evidence_claims": ["ECL-Q01-PLAY-FRAME"]
  }
}
```

成功响应含：

```json
{
  "ok": true,
  "request_id": "...",
  "provider": "kimi",
  "model": "kimi-k3",
  "prompt_version": "tcim-dialogue-v2-five-tables-2026-08-29-r3",
  "action": "ASK",
  "visible_text": "您提到会先观察，哪些具体表现会改变您的做法？",
  "direction": {
    "label": "澄清观察与行动的连接",
    "open_thread_id": "teacher-observation-threshold",
    "rationale": "承接教师主动提出的观察线索",
    "consulted_policy_ids": ["DP-Q01-OPEN"]
  },
  "understanding": {
    "teacher_quote": "我会先看幼儿有没有继续尝试",
    "meaning": "教师会依据幼儿是否继续尝试来调整做法",
    "confidence": "HIGH"
  },
  "evidence_candidates": [{
    "evidence_claim_id": "ECL-Q01-PLAY-FRAME",
    "understanding_id": "UND-Q01-001",
    "relation": "SUPPORT",
    "proposed_status": "PARTIAL",
    "response_origin": "RO1",
    "confidence": 0.72,
    "spans": ["我会先看幼儿有没有继续尝试"],
    "rationale": "教师在开放问题后自主提出具体观察线索"
  }],
  "completion_recommendation": { "recommended": false, "reason": "仍需了解观察如何改变行动" },
  "boundary": { "kind": "NONE", "policy_id": "" },
  "working_hypotheses": [],
  "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 },
  "latency_ms": 0,
  "provider_request_id": "...",
  "trace": { "request_id": "...", "provider": "kimi", "model": "kimi-k3", "prompt_version": "...", "prompt_cache_key": "...", "usage": {}, "latency_ms": 0 }
}
```

模型结果即使通过上游的严格 schema，服务仍会再次执行统一验证，包括：字段不多不少、`evidence_claim_id`/`understanding_id` 必须成对存在于能力类 `evidencePolicies`、ORIGIN_POLICY 不得冒充能力证据、`response_origin` 必须是对应策略允许的 RO0–RO4、`relation` 与 `proposed_status` 必须使用固定枚举、每条 `spans` 必须逐字引用本轮教师原话、首问不得生成 Evidence，以及 `ASK`/`CLOSE` 协议。

为兼容最初的独立服务调用方，HTTP 响应还附带派生别名：`next_question = visible_text`（仅 ASK）、`evidence_proposals = evidence_candidates`、`done = action === CLOSE`、`closing = visible_text`（仅 CLOSE）。模型自身只生成上面的 v2 字段，网页核心可直接使用 `action`、`visible_text`、`direction`、`evidence_candidates`、`completion_recommendation` 和 `boundary`。

五表中的 `AFFORDANCE` 和 `MONITOR` 只作为建议：模型可以追随教师新出现的高价值线索，也可以形成表外开放线索和可撤销假设。只有 `HARD_BOUNDARY` 会门控模型行为；表项覆盖情况本身不能强制追问或自动结束。

为降低多轮延迟，静态压缩编译卡放在 system prompt 的稳定前缀，阶段、历史、本轮原话和 Evidence 摘要放在 user prompt。OpenAI 请求附带只由数据/配置指纹和 `itemId` 构成的 `prompt_cache_key`，不包含教师姓名、会话 ID 或原话；`store: false` 保持不变。

## 本地网页网关

浏览器可把 API 基址指向 `http://127.0.0.1:8787`。服务允许来自 `localhost` 或 `127.0.0.1` 任意端口的 CORS 请求；其他网页 Origin 会被拒绝。

- `GET|POST /auth/session`：返回固定的本地开发身份；
- `POST /auth/logout`：本地无状态退出；
- `POST /call`：请求格式为 `{ "action": "...", "data": {} }`。

已实现的 `/call` action：

- `whoami`
- `reportTeacher`
- `reportSession`
- `selectFinal`
- `reportDraft`
- `reportInterview`
- `dialogueTurn`（与 `/v1/dialogue/turn` 等价）

本地身份默认为 `local:local-user`。测试多个用户时，可在请求中设置 `X-TCIM-Local-User`，数据会按身份隔离。

`selectFinal` 要求此前上报的会话包含 Q1–Q10，每题 `final_ranking` 都是 A/B/C/D 的完整排列。它直接调用：

- `cloudfunctions/gsyg_selectFinal/advisor_port.js`
- `cloudfunctions/gsyg_selectFinal/advisor_norms.js`

输出标记为 `advisor_local_v1`，保留确定性遴选信息，但按当前新 Dialogue Agent 的要求不生成旧 `task_card`。

运行数据默认保存在 `local-dialogue-server/.runtime-data/state.json`，该目录已被 Git 忽略。可用 `TCIM_LOCAL_DATA_FILE` 改到本目录下的其他相对路径或绝对路径。

注意：本地网关的固定身份只为本机联调服务，不是生产认证方案。当前运行数据为未加密的本机研究试验数据，不得存放未经研究授权的真实教师数据；正式试用仍需补齐加密、知情同意、删除、导出与保留期限机制。不要把该端口监听到公网，也不要在不受信任的局域网接口上开放。

## 测试

```powershell
node --test test/*.test.js
```

测试覆盖 OpenAI Responses 请求映射、Kimi Chat Completions 请求映射、provider 自动选择与热切换快照、模型配置接口的本地安全门和密钥不回传、`.env` 持久化/重启恢复、严格统一输出校验、超时中止、本地 CORS、草稿/访谈幂等保护，以及原顾问算法的 `selectFinal` 端到端调用。测试使用注入的 mock `fetch`/provider，不会访问外网，也不需要真实密钥。

## 主要环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TCIM_DIALOGUE_PROVIDER` | 自动选择 | `kimi`、`openai` 或 `mock` |
| `TCIM_DIALOGUE_HOST` | `127.0.0.1` | 监听地址 |
| `TCIM_DIALOGUE_PORT` | `8787` | 监听端口 |
| `TCIM_DIALOGUE_TIMEOUT_MS` | `45000` | 单次上游调用超时 |
| `TCIM_DIALOGUE_MAX_BODY_BYTES` | `1048576` | 最大 JSON 请求体 |
| `TCIM_DIALOGUE_MAX_HISTORY_TURNS` | `40` | 送入模型的最大历史轮数 |
| `TCIM_LOCAL_DATA_FILE` | `.runtime-data/state.json` | 本地数据文件，相对本服务目录 |
| `TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS` | `0` | 仅限本机 provider 测试替身的显式开关 |
| `KIMI_API_KEY` | 无 | Kimi 服务端密钥 |
| `MOONSHOT_API_KEY` | 无 | 第一版 Kimi 密钥变量兼容别名 |
| `KIMI_BASE_URL` | `https://api.moonshot.cn/v1` | Kimi OpenAI 兼容基址 |
| `KIMI_MODEL` | `kimi-k3` | Kimi 模型名 |
| `OPENAI_API_KEY` | 无 | OpenAI 服务端密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI API 基址 |
| `OPENAI_MODEL` | `gpt-5.6-sol` | OpenAI 模型名 |
