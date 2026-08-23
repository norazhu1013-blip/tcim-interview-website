# gsyg_semanticProbe —— TCIM A01 语义预筛（LLM 只出 Proposal）

## 做什么

- 对教师某一轮回答做「语义理解与证据抽取」，输出 **EvidenceAnalysisProposal**：
  `candidate_spans` / `candidate_slots` / `conflict_candidates` / `false_evidence_flags` / `no_change_reasons` / `uncertainty`。
- **只做预筛，绝不做裁决**：不判 level / confidence / 能力等级，不写 `evidence_state`。真正写等级的是确定性 `EvidenceUpdater`（锚点命中）。
- 是 TCIM「AI 核心智能」（证据判断由 LLM 语义主导）与「计分/筛题是确定性程序」红线的桥梁——**语义层出 Proposal，确定性裁决定 level**。

## 与其它云函数的区别（部署前必读）

- **自包含**：只 `require('wx-server-sdk')` + 同目录 `./semantic_core.js`。**不需要跑 `node tools/sync_cf.js`**（不在其 canonical 列表），也不涉及 `gsyg_selectFinal` 那种 MP_TO_PY 对拍门槛。
- 上传目录只需 `index.js` / `package.json` / `semantic_core.js` 三个文件。

## 部署

1. **微信开发者工具** → 云开发 → 云函数 → `gsyg_semanticProbe` → 右键「上传并部署（云端安装依赖）」。
   上传前确认文件列表：`index.js` / `package.json` / `semantic_core.js`。
2. **运行时必须 Nodejs 18+**(`wx-server-sdk` 的 `cloud.ai` 需要)。若之前锁了 Node16,按项目踩坑记录——**不能就地改,要删了重建**。
3. **云函数配置 → 环境变量**(按所选 LLM provider 配,无一套通吃默认):

| 变量 | 说明 | 默认 | 何时必配 |
|---|---|---|---|
| `SEMANTIC_PROFILE` | 选用内置配置组 | `wxai` | 换 deepseek / 通用第三方才改 |
| `LLM_TIMEOUT_MS` | 单次语义 LLM 超时 ms | `18000` | 建议 ≥20s |
| `SEC_CHECK` | `1` 开启 `security.msgSecCheck` 机审 | 不开 | 上线建议开(可选) |

**wxai 路径(小程序/网页默认)**:一般不用额外配,走 CloudBase AI——`WXAI_PROVIDER=cloudbase` / `WXAI_MODEL=hy3-preview`(需在云开发控制台「AI+」开通)。

**deepseek 路径(网页常见)**:
| 变量 | 默认 |
|---|---|
| `DEEPSEEK_API_KEY` | 空(必填) |
| `DEEPSEEK_MODEL` | `deepseek-chat` |
| `DEEPSEEK_TEMPERATURE` | `0.1` |
| `DEEPSEEK_MAX_TOKENS` | `700` |

**通用第三方路径(`openai-compatible`)**:
| 变量 | 默认 |
|---|---|
| `OPENAI_COMPATIBLE_ENDPOINT` | 空(必填,完整 chat/completions URL) |
| `OPENAI_COMPATIBLE_API_KEY` | 空(必填) |
| `OPENAI_COMPATIBLE_MODEL` | 空(必填) |
| `OPENAI_COMPATIBLE_TEMPERATURE` | `0.1` |
| `OPENAI_COMPATIBLE_MAX_TOKENS` | `700` |

4. **云函数配置 → 执行超时时间 ≥ 30s**(推荐 60s),否则平台先杀函数,`LLM_TIMEOUT_MS` 白设。
5. 若开 `SEC_CHECK=1`,需在 openapi 权限勾选 `security.msgSecCheck`(v2 scene 4)。**语义层默认关,它只回传 span 文本,一般不必开**。

## 本机验证(无需云端/API Key)

```bash
node cloudfunctions/gsyg_semanticProbe/semantic_core.test.js
```
纯 Node,用伪造 LLM JSON 驱动整条决策链(提示词构造 / 解析 / G04-G05 / 空 Proposal),任何环境可跑。

## 要让网页端真正调用,还需两步(不在本函数内部)

`gsyg_semanticProbe` 部署好后,网页要**经网关**才调它:
1. **重传 `gsyg_webGateway`**:让上一轮加的 `semanticProbe` 白名单生效。网关自身环境变量复用现有:
   `GSYG_WEB_GATEWAY_TOKEN` / `GSYG_WEB_SESSION_SECRET` / `WEB_CLOUDBASE_ENV_ID` / `WEB_ALLOWED_ORIGIN`。
2. **重建并发布网页**:构建变量 `VITE_WEB_API_BASE_URL` 指向网关、`VITE_CLOUDBASE_ENV_ID` 正确。缺网关/缺 key 时 `semanticLLM.js` 自动回退空 Proposal——TCIM 不崩、红线不动。

## 红线(硬约束,实现已守住)

- 语义 provider **永不写 `evidence_state`、永不判 level**;level 只由 `updateEvidence` 锚点命中决定。
- G04:每个候选 span 必须回指教师原话,否则丢弃。
- G05:不因短答/犹豫/礼貌/流畅推断能力、人格、动机或心理状态(三层:semantic_core / engine / semanticLLM 都已拦)。

## canonical 源文件

- `index.js`:云函数入口(LLM I/O + secCheck + 包装)。
- `semantic_core.js`:纯逻辑层(提示词 / 解析 / 规范化 / G04-G05 校验),无 SDK / 无网络,可本地测试。
- `semantic_core.test.js`:本地测试(纯 Node)。

## 部署后验证清单

> 本链路是**失败静默降级**设计:缺 key / 缺网关 / LLM 超时都会回退「空 Proposal」,**不抛错**。
> 因此「没报错」≠「已生效」。下面的清单按**分层**递进,每层都有自己的判据,并区分「降级」与「真故障」。

### L1 · 云函数纯逻辑(任何环境,不依赖云端)
```bash
node cloudfunctions/gsyg_semanticProbe/semantic_core.test.js
# 期望: gsyg_semanticProbe semantic_core tests passed
```
**判据**:通过 = 提示词 / 解析 / G04-G05 / 空 Proposal 决策链 OK。这一步失败 = 代码或数据问题,**与部署无关**。

### L2 · 云函数本体能冷启动 + 返回 `ok:true`
用微信云开发控制台/云函数测试工具直接测试 `gsyg_semanticProbe`,传一个最小事件:
```js
{ "teacherTurn": "我会先看地面湿不滑,篮球架附近有没有别的孩子。", "itemId": "Q1" }
```
- 期望返回 `{ ok:true, proposal:{...}, llmProfile, llmModel, fallback }`。
- **判据 A(降级或真故障)**:`fallback` 字段会告诉你发生了什么——
  - `fallback` 为空 / 未以 `semantic_` / `G05_` 开头 → **真通了**(LLM 出了 Proposal)。
  - `fallback` 以 `semantic_llm_error:` 开头 → LLM 调用失败,查环境变量 key / endpoint / 网络。
  - `fallback` 以 `G05_violation:` 开头 → 模型输出了能力/人格判定词,被拦截(提示词要收紧,但链路本身通了)。
  - `fallback = ''` 且 `proposal.candidate_spans` 为空 → 模型回了空,或该教师原话确实无证据(正常,不代表故障)。
- **判据 B**:`ok` 恒为 `true`(本函数设计为永不抛错),所以**不能**用 `ok` 判断是否有效,要用 `fallback` 和 `proposal`。

### L3 · 网关白名单 + 鉴权(网页真正调用前)
在浏览器 DevTools Network 里找请求 `POST {VITE_WEB_API_BASE_URL}/call` body `{action:'semanticProbe'}`:
- 期望 `HTTP 200` + `{ ok:true, proposal }`。
- 若 `HTTP 400` + `{error:'unsupported_action'}` → **网关没重传**,`semanticProbe` 白名单未生效。
- 若 `HTTP 401` + `{error:'not_authenticated'}` → 网关会话/Cookie 没建立(查 `web-auth.js` 匿名登录链)。
- 若 `HTTP 502` + `{error:'upstream_function_failed'}` → 云函数调用失败,回头看 L2。
- 若请求压根没发 → 说明 `semanticEnabled()===false`,查 `VITE_WEB_API_BASE_URL` 是否配置、`VITE_TCIM_SEMANTIC` 是否被设 `0`。

### L4 · 语义信号真的进到了 Evidence(唯一硬依据)
这是全链路**唯一能证明「LLM 真的出了语义层贡献」**的地方——看 TCIM Replay 里有没有 `SemanticEvent`。
网页端 `session.interview[itemId].tcimReplay` 每轮追加事件,找：
- `event:'SemanticEvent', type:'span'`(合法候选 span)─ 且 `provider` 字段非 `'offline'`。
- **关键**:`provider` 应为 `'custom'`。若全是 `type:'invalid'` / `provider:'offline'` / 无 `SemanticEvent` → 语义层实际没生效(虽然引擎不报错)。
- User 可查 localStorage 里的 `tcimSession` Replay,或在 `InterviewView.vue` 的 `processTeacherTurn` 返回里打印 `replay`。

### 一张判据速查表
| 现象 | 含义 | 该查哪 |
|---|---|---|
| `semantic_core.test.js` 失败 | 代码/数据问题,与部署无关 | L1 |
| `fallback` 以 `semantic_llm_error:` | LLM 调用失败 | L2 环境变量 key/endpoint |
| `fallback` 以 `G05_violation:` | 模型越界,被拦(链路通) | 收紧提示词 |
| HTTP 400 `unsupported_action` | 网关白名单未生效 | L3 重传网关 |
| HTTP 401 | 网关会话未建 | L3 web-auth 匿名登录 |
| 无 `SemanticEvent` / `provider:'offline'` | 语义层未实际生效 | L4 查 VITE_WEB_API_BASE_URL / 语义层配置 |
| `provider:'custom'` + `SemanticEvent type:'span'` | **真通了** | —— |

**核心结论**:判断「语义层是否上线」,**不要**看 `ok`(恒 true)或「没报错」(降级不报错),要**同时**看 L2 的 `fallback` **和** L4 的 `SemanticEvent.provider != 'offline'`。两者都过才算真生效。
