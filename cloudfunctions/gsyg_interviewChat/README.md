# gsyg_interviewChat —— AI 访谈动态追问（wxai 版）

## 做什么

- 每轮教师发言后由客户端调本云函数拿到「下一句要问的问题」+「教师上一轮回答实质覆盖了哪些证据点(E1-E7)」。
- 走微信云开发 AI 能力（`cloud.extend.AI` / `cloud.ai` 两代 API 自动兼容）。
- 失败/超时/未开通 → `ok:false`，客户端 `interview.js` 自动回退规则版脚本序列（`interview.utils.js` 的 T→Q→E 流程）。

## 与之前"规则版问过即算"的关键差异

- 规则版：AI 问过对应证据代码的 Q → 教师随便答 → 那条 E 就记入账本。
- 本版：LLM 拿到 system 里 E1-E7 清单 + 历史对话，**基于教师最后一轮原话**判定其是否实质覆盖了某些 E，返回 `covered_evidence` 数组；客户端把该数组塞进证据账本 `_ledger`。

## 部署

1. 微信开发者工具 → 云开发 → 云函数 → `gsyg_interviewChat` → 右键「上传并部署（云端安装依赖）」。
2. 云开发控制台 → 「AI+」→ 开通目标模型（默认 `deepseek-v3`；也可换 `hunyuan-turbo`/`hunyuan-lite`/其它已开通模型）。
3. 云函数配置 → 环境变量：

| 变量 | 说明 | 默认 |
|---|---|---|
| `WXAI_MODEL` | wxai 已开通的模型 id | `deepseek-v3` |
| `LLM_TIMEOUT_MS` | 单次 LLM 超时 ms | `12000` |
| `SEC_CHECK` | `1` 开启对 AI 输出的 `security.msgSecCheck` 机审（上线建议开） | 不开 |

4. 若开启 `SEC_CHECK=1`，需在小程序 openapi 权限里勾选 `security.msgSecCheck`（云开发环境默认可用；不需要小程序 appsecret）。

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
  "remainingMs": 480000
}
```

## 返回结构

```json
{ "ok": true, "question": "…", "done": false, "evidenceHint": ["E1","E3"] }
```

`ok:false` 时客户端不显示，回退到规则脚本队列。

## 云端调试

云函数「云端测试」贴一个最小 event（把 itemContext / teacherRanking / history 填几行）即可，返回结果里 `evidenceHint` 应能随 history 里教师最后一句变化。

## 后续可优化（v1.1）

- 单情境结束后再让 LLM 出「10 表五档锚点编码」写回 session.interview[itemId]，为报告页做准备。
- history 超 12 轮时头部压缩（保留首题情境 + 最近 8 轮）。
- 换用 `streamText` 做流式,减少感知延迟。
