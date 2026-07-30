# gsyg_interviewChat —— AI 访谈动态追问

## 做什么

- 每轮教师发言后由客户端调本云函数拿到「下一句要问的问题」+「教师上一轮回答实质覆盖了哪些证据点(E1-E7)」。
- 小程序默认走微信云开发 AI 能力（`cloud.extend.AI` / `cloud.ai` 两代 API 自动兼容）。
- 网页端默认同样走微信云开发 AI 能力；也可通过入参 `llmProfile` 在云函数内置配置组之间切换到第三方 OpenAI-compatible 接口。
- 失败/超时/未开通 → `ok:false`，客户端 `interview.js` 自动回退规则版脚本序列（`interview.utils.js` 的 T→Q→E 流程）。

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
| `DEEPSEEK_API_KEY` | `deepseek` 配置组 API Key | 空 |
| `DEEPSEEK_MODEL` | `deepseek` 配置组模型名 | `deepseek-chat` |
| `OPENAI_COMPATIBLE_ENDPOINT` | `openai-compatible` 配置组完整 chat/completions URL | 空 |
| `OPENAI_COMPATIBLE_API_KEY` | `openai-compatible` 配置组 API Key | 空 |
| `OPENAI_COMPATIBLE_MODEL` | `openai-compatible` 配置组模型名 | 空 |

## LLM profile 切换

云函数内置 `LLM_PROFILES` 白名单，前端只能传 `llmProfile` 选择已有配置，不能传 endpoint 或 key。

当前内置:

| profile | 类型 | 说明 |
|---|---|---|
| `wxai` | 微信云开发 AI | 小程序和网页端默认 |
| `deepseek` | OpenAI-compatible | endpoint 固定为 `https://api.deepseek.com/chat/completions` |
| `openai-compatible` | OpenAI-compatible | 通用第三方接口，endpoint/model/key 走 `OPENAI_COMPATIBLE_*` |

网页端可在构建变量中指定:

```env
VITE_INTERVIEW_LLM_PROFILE=deepseek
```

不填时，网页请求由云函数按 `WEB_INTERVIEW_LLM_PROFILE || "wxai"` 选择；若云函数也未配置 `WEB_INTERVIEW_LLM_PROFILE`，默认走 `wxai`。小程序不传该字段，默认仍走 `wxai`。

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

`llmProfile` / `llmModel` 只用于调试和审计，不包含 endpoint 或 key。`ok:false` 时客户端不显示，回退到规则脚本队列；若后端已解析出 profile，也会尽量带上这两个字段。

## 云端调试

云函数「云端测试」贴一个最小 event（把 itemContext / teacherRanking / history 填几行）即可，返回结果里 `evidenceHint` 应能随 history 里教师最后一句变化。

## 后续可优化（v1.1）

- 单情境结束后再让 LLM 出「10 表五档锚点编码」写回 session.interview[itemId]，为报告页做准备。
- history 超 12 轮时头部压缩（保留首题情境 + 最近 8 轮）。
- 换用 `streamText` 做流式,减少感知延迟。
