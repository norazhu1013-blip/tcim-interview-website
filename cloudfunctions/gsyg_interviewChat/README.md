# gsyg_interviewChat —— AI 访谈动态追问

## 做什么

- 每轮教师发言后由客户端调本云函数拿到「下一句要问的问题」+「教师上一轮回答实质覆盖了哪些证据点(E1-E7)」。
- 小程序默认走微信云开发 AI 能力（`cloud.extend.AI` / `cloud.ai` 两代 API 自动兼容）。
- 网页端可通过内置 profile 切换到 OpenAI 官方 Responses API；密钥只保存在云函数环境变量中，不进入网页或仓库。
- 当前访谈策略为 **V7.4**：正常访谈至少 8 个可回答问题，不设固定最高问数；达到最低问题数后，再按内容完整性和剩余时间决定是否收束。
- 普通模型超时或暂时不可用时，云函数优先根据教师最新原话生成一条简短恢复追问，避免悄悄切回固定脚本。配置缺失、内容安全失败等无法安全恢复的错误返回 `ok:false`，客户端保留原对话并让教师选择重新生成或结束本情境。

## 与之前"规则版问过即算"的关键差异

- 规则版：AI 问过对应证据代码的 Q → 教师随便答 → 那条 E 就记入账本。
- 本版：LLM 拿到 system 里 E1-E7 清单 + 历史对话，**基于教师最后一轮原话**判定其是否实质覆盖了某些 E，返回 `covered_evidence` 数组；客户端把该数组塞进证据账本 `_ledger`。

## 部署

1. **本机先跑 `node tools/sync_cf.js`**(把 `tools/task_card_builder.js` + `tools/knowledge.json` 拷进本目录;每次 tools/ 改动后都要跑)。
2. 微信开发者工具 → 云开发 → 云函数 → `gsyg_interviewChat` → 右键「上传并部署（云端安装依赖）」。上传时确认这几个文件在列表里:`index.js` / `package.json` / `task_card_builder.js` / `knowledge.json`。
3. 云开发控制台 → 「AI+」→ 开通目标模型（默认 `hy3-preview`;也可换 `deepseek-v3` / `hunyuan-turbo` 等已开通模型）。
4. 云函数配置 → 环境变量:

| 变量 | 说明 | 默认 |
|---|---|---|
| `WXAI_MODEL` | wxai 已开通的模型 id | `hy3-preview` |
| `WXAI_PROVIDER` | wxai provider | `cloudbase` |
| `LLM_TIMEOUT_MS` | 单次 LLM 超时 ms | `30000` |
| `SEC_CHECK` | `1` 开启对 AI 输出的 `security.msgSecCheck` 机审（上线建议开） | 不开 |
| `WEB_INTERVIEW_LLM_PROFILE` | 网页端未传 `llmProfile` 时使用的内置配置组 | `wxai` |
| `OPENAI_API_KEY` | OpenAI 官方项目 API Key（只存云函数环境变量） | 空 |
| `OPENAI_MODEL` | OpenAI 官方模型 | `gpt-5.6-sol` |
| `OPENAI_REASONING_EFFORT` | OpenAI 推理强度 | `high` |
| `OPENAI_MAX_OUTPUT_TOKENS` | 含推理与最终 JSON 的输出上限 | `4000` |
| `DEEPSEEK_API_KEY` | `deepseek` 配置组 API Key | 空 |
| `DEEPSEEK_MODEL` | `deepseek` 配置组模型名 | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Kimi 官方开放平台 API Key（只存云函数环境变量） | 空 |
| `KIMI_MODEL` | Kimi 配置组模型名 | `kimi-k3` |
| `KIMI_REASONING_EFFORT` | K3 推理强度：`low` / `high` / `max` | `high` |
| `KIMI_MAX_COMPLETION_TOKENS` | K3 单轮推理与最终 JSON 的输出上限 | `4000` |
| `OPENAI_COMPATIBLE_ENDPOINT` | `openai-compatible` 配置组完整 chat/completions URL | 空 |
| `OPENAI_COMPATIBLE_API_KEY` | `openai-compatible` 配置组 API Key | 空 |
| `OPENAI_COMPATIBLE_MODEL` | `openai-compatible` 配置组模型名 | 空 |

## LLM profile 切换

云函数内置 `LLM_PROFILES` 白名单，前端只能传 `llmProfile` 选择已有配置，不能传 endpoint 或 key。

当前内置:

| profile | 类型 | 说明 |
|---|---|---|
| `wxai` | 微信云开发 AI | 小程序和网页端默认 |
| `openai-official` | OpenAI 官方 Responses API | 固定直连 `https://api.openai.com/v1/responses`；默认 `gpt-5.6-sol` |
| `deepseek` | OpenAI-compatible | endpoint 固定为 `https://api.deepseek.com/chat/completions` |
| `kimi-k3` | Kimi 国内官方 OpenAI-compatible API | 固定直连 `https://api.moonshot.cn/v1/chat/completions`；使用严格 JSON Schema |
| `openai-compatible` | OpenAI-compatible | 通用第三方接口，endpoint/model/key 走 `OPENAI_COMPATIBLE_*` |

网页端可在构建变量中指定:

```env
VITE_INTERVIEW_LLM_PROFILE=openai-official
```

不填时，网页请求由云函数按 `WEB_INTERVIEW_LLM_PROFILE || "wxai"` 选择；若云函数也未配置 `WEB_INTERVIEW_LLM_PROFILE`，默认走 `wxai`。小程序不传该字段，默认仍走 `wxai`。

正式切换网页端时，在云函数环境变量中设置 `WEB_INTERVIEW_LLM_PROFILE=openai-official` 和 `OPENAI_API_KEY`。不要把 `OPENAI_API_KEY` 放进 `VITE_*`、网页源码、GitHub 或聊天记录。官方通道使用严格 JSON Schema，并设置 `store:false`，不让 Responses API 保存访谈请求。

试用 Kimi K3 时，先在 Kimi 国内 API 开放平台充值解锁 K3并创建 Key，把 Key 仅保存为云函数环境变量 `MOONSHOT_API_KEY`；网页构建变量改为 `VITE_INTERVIEW_LLM_PROFILE=kimi-k3`。国内平台 Key 只能配合 `api.moonshot.cn` 使用，不能发送至国际版 `.ai`。K3 固定采样参数不允许自定义，因此本配置不发送 `temperature`，使用 `reasoning_effort=high`、`max_completion_tokens=4000` 与严格 JSON Schema。若真实访谈响应偏慢，只调整 `KIMI_REASONING_EFFORT=low`，不改访谈提示词。

> 地区合规提醒：OpenAI 官方 API 只能在其公布的支持国家和地区内访问和提供访问。当前 CloudBase 环境为上海区，不得直接把生产默认 profile 切为 `openai-official`；否则既可能连接失败，也可能导致 OpenAI 账号被暂停。必须先确认服务部署位置与实际服务对象均符合 OpenAI 支持地区政策，再配置官方 Key 和启用该 profile。

5. 云函数配置 → **执行超时时间** ≥ 45s(推荐 60s),否则平台会先杀函数,`LLM_TIMEOUT_MS` 白设。
6. 若开启 `SEC_CHECK=1`,需在小程序 openapi 权限里勾选 `security.msgSecCheck`(云开发环境默认可用)。

## canonical 源文件(不要直接改本目录副本 —— sync_cf 会覆盖)

| 本目录文件 | canonical 位置 | 生成方式 |
|---|---|---|
| `task_card_builder.js` | `tools/task_card_builder.js` | 手写(与 gsyg_selectFinal 共用) |
| `knowledge.json` | `tools/knowledge.json` | `node tools/build_knowledge_v16.js` 从 `DOC/inbox_0709/_kb16/*.xlsx` 生成 |

改这两个文件的流程:改 `tools/` 里的原文件 → 跑 `node tools/sync_cf.js` → 本目录副本会被覆盖 → 微信开发者工具重传本云函数。

## event 结构（客户端 `interview.js` askNext 已构造好）

```json
{
  "sessionId": "uuid",
  "itemId": "GSYG_07",
  "itemContext": { "stem": "…", "options": {"A":"…","B":"…","C":"…","D":"…"}, "title": "艾莎公主不运动" },
  "teacherRanking": ["C","A","B","D"],
  "processTags": ["首位强摇摆","修改≥2次"],
  "kbSlice": { "core_orientation": "…", "observation_points": ["…"], "triggers": [{"code":"T1","result_cond":"…","target":"…"}], "evidence_points": [{"code":"E1","name":"…"}] },
  "history": [{"role":"ai","text":"…"},{"role":"me","text":"…"}],
  "remainingMs": 480000,
  "llmProfile": "deepseek"
}
```

## 返回结构

```json
{
  "ok": true,
  "question": "…",
  "done": false,
  "evidenceHint": ["E1","E3"],
  "llmProfile": "wxai",
  "llmModel": "hy3-preview"
}
```

`llmProfile` / `llmModel` 只用于调试和审计，不包含 endpoint 或 key。`ok:false` 时客户端不自动换成另一套访谈脚本，而是保留当前对话并提供“重新生成 / 结束本情境”；若后端已解析出 profile，也会尽量带上这两个字段。

## V7.4 访谈流程

- 每轮先理解教师最新回答，再从当前主线中选择一个最值得推进的问题；不固定首问，也不按选项顺序逐项索要排序理由。
- 正常访谈少于 8 个可回答问题时不能主动结束。达到 8 个后，只有主要教育判断、理由关系、关键张力或适用边界已经较完整，才可以收束。
- 距离本情境结束不足 1 分钟时，生成与教师刚才观点有关的内容化收束，不使用通用结束套话。
- 每次只问一个主要问题；教师表示没听懂时，先用更简单的话解释原问题，不另开新话题。
- 题目知识库用于访谈前形成情境理解和可能假设，不作为逐项覆盖的问题清单。

## 云端调试

云函数「云端测试」贴一个最小 event（把 itemContext / teacherRanking / history 填几行）即可，返回结果里 `evidenceHint` 应能随 history 里教师最后一句变化。

提交或部署前运行：

```bash
node tools/verify_interview_v7.js
node tools/verify_interview_resilience.js
node tools/verify_openai_official.js
node tools/verify_kimi_k3.js
```

## 后续可优化（v1.1）

- 单情境结束后再让 LLM 出「10 表五档锚点编码」写回 session.interview[itemId]，为报告页做准备。
- history 超 12 轮时头部压缩（保留首题情境 + 最近 8 轮）。
- 换用 `streamText` 做流式,减少感知延迟。
