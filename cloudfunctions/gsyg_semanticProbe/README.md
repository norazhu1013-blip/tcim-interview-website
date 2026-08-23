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
