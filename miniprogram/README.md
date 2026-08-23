# 游戏支持与引导能力测评 · 微信小程序（原生）

面向幼儿园教师的「游戏支持与引导能力」AI 测评小程序端。**原生开发，无任何第三方框架/npm 依赖**。
遵循仓库根目录 `CLAUDE.md` 的全部红线与信息架构、`prototype.html` 的界面、`设计文档.md` 与 `demo/` 的数据与算法口径。

---

## 一、如何运行（微信开发者工具）

1. 打开「微信开发者工具」→ 导入项目。
2. 目录选择**仓库根目录**（含 `project.config.json`、`miniprogram/`、`cloudfunctions/` 的那一层，**不是** `miniprogram/` 子目录）。
3. AppID 已在根 `project.config.json` 配好：`wxb3835ca53ec166c8`；`miniprogramRoot: "miniprogram/"`、`cloudfunctionRoot: "cloudfunctions/"`。
4. 编译即可预览（app.json 在 `miniprogram/` 下经 miniprogramRoot 生效）。首启进入 P0 登录 → 首次到「我的」Tab 完善信息 → 「答题」Tab。

> 无需 npm install / 构建步骤；纯原生页面。**唯一权威结构 = 仓库根 `project.config.json`**；`miniprogram/` 下不再单独放 project.config.json（已删除，避免歧义）。

---

## 二、目录结构（仓库根打开）

```
<仓库根>/
├─ project.config.json               # 唯一权威工程配置：miniprogramRoot=miniprogram/、cloudfunctionRoot=cloudfunctions/、appid=wxb3835ca53ec166c8
├─ cloudfunctions/                   # 云函数（gsyg_ 前缀，右键上传部署）
│  ├─ gsyg_reportTeacher/    {index.js, package.json} → 写 gsyg_teachers
│  ├─ gsyg_reportSession/    {index.js, package.json} → 写 gsyg_sessions
│  ├─ gsyg_reportInterview/  {index.js, package.json} → 写 gsyg_interviews
│  └─ gsyg_interviewChat/    {index.js, package.json} → AI 动态追问（LLM provider 抽象，可选）
└─ miniprogram/                      # 小程序端（miniprogramRoot）
   ├─ app.js / app.json / app.wxss   # 全局入口、页面注册、极简全局样式（移植自 prototype）
   ├─ sitemap.json
   ├─ data/                          # 导入数据的 JS 化版本（= demo/*.json）
   │  ├─ questions.js      题库（全 10 题 Q1–Q10，题干+四选项，DOC 原文）
   │  ├─ scoreTable.js     赋分表（排列串→0-4 分，全 10 题×24 排列，DOC 真实值）
   │  ├─ indicatorMap.js   指标映射（主/次二级、三级 + 观测点 + 指标规范名）
   │  └─ knowledge.js      访谈知识库（触发T/脚本Q/证据E/锚点）+ R/P/G 筛选阈值
   ├─ utils/
   │  ├─ config.js         全局常量：云环境 ID（CLOUD_ENV）、前缀（PREFIX=gsyg_）、集合名、云函数名
   │  ├─ uuid.js           每次答题生成 sessionId（记录主键）
   │  ├─ store.js          本地存储层（wx.setStorageSync）：profile / session / interview
   │  ├─ scoring.js        确定性查表评分 + 派生统计 + R/P/G 自动筛选（移植 demo doSelect）
   │  ├─ process.js        过程指标：move_log 回放 / 首末位摇摆 / 路径振荡 / P-IVI（移植 demo）
   │  ├─ interview.js      访谈规则引擎：命中触发规则→脚本序列→证据账本→锚点编码
   │  └─ api.js            3 个上报封装（wx.cloud.callFunction 调云函数，本地优先、失败入 pending）
   └─ pages/               # 逐页对照 prototype 的 P0–P9
      login / profile / home / exam / submit / score / select / review / interviewList / interview / done
```
> 另：`tools/build_scoreTable.js`（仓库根）= 一次性 xlsx→scoreTable.js 转换脚本。

### 页面 ↔ 原型对照

| 页面 | 原型 | 说明 |
|---|---|---|
| login | P0 | **手机号授权按钮常驻**(单个 `open-type="getPhoneNumber"`)：授权成功→换号(有权限存真实号、无权限-604101/失败空号仍放行);拒绝授权→据探测(`checkPhonePermission`)决定:有权限强制授权停留、无权限免授权放行。登录态 `login_state.phoneAuthed`;手机号存本地、profile 保存时随 `gsyg_reportTeacher` 一并上报。**未登录允许浏览所有页面;开始答题 / 提交答卷 / 保存资料 / 进入 AI 访谈时才用 `store.requireLoginWithPrompt(hint)` 弹窗要求登录**。详见 `cloudfunctions/README.md` |
| profile | P0b/P1b | **「我的」Tab**（tabBar）：双重身份 —— 首次无 profile 引导填写→保存进「答题」；常驻可随时查看/修改，保存调 `gsyg_reportTeacher` 更新 |
| home | P1 | **「答题」Tab**（tabBar，默认选中）：开始测评 CTA + 历次记录；每条记录卡「看答题/看评分/去访谈或回看」 |
| exam | P2 | 情境排序（**长按拖动重排 + 拖动震动**），限时 20 分钟；每次拖动提交成功追加一条 move_log（option/from_pos/to_pos/ts），供过程指标计算 |
| submit | P3 | 提交完成，入口：查看评分 / 去 AI 访谈 |
| score | P4 | 评分结果（总分 + 各题得分），确定性查表 |
| select | P5 | 自动筛选 3 题（R/P/G 三路候选 + 合并去重 + 覆盖校验） |
| review | P6 | 看答题（swiper 左右滑动回看每题排序 + 得分） |
| interviewList | P7 | 访谈情境列表（**从属于具体答题记录**）：已完成/待访谈 |
| interview | P8 | AI 一对一访谈（先呈现案例+四选项+本人排序；每轮一问；限时 10 分钟） |
| done | P9 | 访谈完成 |

---

## 三、数据存储（本地优先）

除下述 3 个上报接口外，**所有数据都存在手机本地**（`wx.setStorageSync`），见 `utils/store.js`：

- `profile`：教师信息。
- `session_ids` + `session:<uuid>`：每次答题一条会话（记录主键 = 前端生成的 UUID）。会话内含：`answers`（含 move_log 等过程埋点）、`scores`、`selection`、`interview`。可多次答题，记录列表按 session 展示。
- 每条会话绑定 `dataVersion`，以便历史复现（对应「教师作答绑定当时 version」）。

---

## 四、后端 = 微信云开发 CloudBase（云函数 + 云数据库，gsyg_ 前缀）

后端采用**微信云开发 CloudBase「云函数 + 云数据库」**：客户端**不直连数据库**，改为调用云函数（`gsyg_` 前缀），云函数内用 `wx-server-sdk` 拿 openid 并读写集合，**权限在服务端控制**。集合与函数统一前缀 `gsyg_`（与知识库题号 `GSYG_` 一致；想换前缀集中改 `utils/config.js` 的 `PREFIX`）。

- **云环境 ID**：`cloud1-2gefzeri3cb333f2`（`utils/config.js` 的 `CLOUD_ENV`）。
- `app.js onLaunch` 里 `wx.cloud.init({ env: CLOUD_ENV, traceUser: true })`；`app.json` 已加 `"cloud": true`；`project.config.json` 已加 `"cloudfunctionRoot": "cloudfunctions/"`。
- 封装在 `utils/api.js`（`wx.cloud.callFunction`）。**本地优先、上报不阻塞**：调用方先写本地 storage 成功，再异步调云函数；失败进本地待重传队列 `pendingReports`（`app.onShow` 自动 `flushPending()`），try/catch 不 throw。
- **优雅降级**：基础库不支持 `wx.cloud` 或未初始化时，只存本地 + 记 pending，不报错（`cloudReady()` 判定）。
- 云函数约定返回 `{ ok:true, id }` 或 `{ ok:false, error }`；`api.js` 据此判断成败。

| 时机 | 客户端方法 | 云函数 | 集合 | upsert 键 | 主要字段 |
|---|---|---|---|---|---|
| 完善信息时 | `reportProfile` | `gsyg_reportTeacher` | `gsyg_teachers` | `openid` | `openid`、`profile`、`createdAt/updatedAt` |
| 答题结束后 | `reportExam` | `gsyg_reportSession` | `gsyg_sessions` | `sessionId`（前端 UUID） | `sessionId`、`openid`、`profile`、`answers`、`scores`、`total`、`selection`、`submitStatus`、`items[].durationMs`、`examStartTs`、`examSubmitTs`、`totalDurationMs`、`createdAt` |
| 访谈结束后 | `reportInterview` | `gsyg_reportInterview` | `gsyg_interviews` | `sessionId` | `sessionId`、`openid`、`transcripts`、`createdAt` |

> upsert 逻辑（在云函数内）：先 `where({openid})`（teachers）或 `where({sessionId})`（sessions/interviews）查，命中 `update`、否则 `add`。云函数以服务端身份读写，无客户端权限限制、且天然按 openid 归属。
> 备选：若倾向少函数，可合并为单个 `gsyg_report`，用 `data.action='teacher'|'session'|'interview'` 分发。当前采用**三个独立函数**（职责清晰，推荐）。
> LLM 仍不能在小程序直连，真实访谈的 LLM 调用放在云函数 `gsyg_interviewChat`（见下）。

### 云开发部署（运维，部署一次）

1. **开通云开发**：微信开发者工具 → 云开发 → 创建/选择环境，确认环境 ID = `cloud1-2gefzeri3cb333f2`（不同则改 `utils/config.js` 的 `CLOUD_ENV`）。云函数内用 `cloud.DYNAMIC_CURRENT_ENV`，自动跟随当前环境，无需改函数代码。
2. **部署云函数**（gsyg_ 前缀）：在仓库根 `cloudfunctions/` 下（cloudfunctionRoot 已指向它），对每个函数目录**右键 →「上传并部署：云端安装依赖」**（会按各自 `package.json` 安装 `wx-server-sdk`）：
   - `gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_interviewChat`
   - TCIM 网页端语义层(可选)：`gsyg_semanticProbe`（A01 语义预筛，自包含无需 sync_cf；部署步骤见其 `README.md`，且需重传 `gsyg_webGateway` 白名单才在网页生效）
3. **创建 3 个集合**（数据库 → 集合管理，gsyg_ 前缀）：`gsyg_teachers`、`gsyg_sessions`、`gsyg_interviews`。
   - 权限：因只经云函数读写，集合权限可设 **「仅管理端可读写」（所有用户不可读写）**——客户端不直接访问 DB，最安全。
4. **字段无需预建**（文档型，写入即建）。建议为 `gsyg_sessions`/`gsyg_interviews` 的 `sessionId`、各集合的 `openid` 建索引，便于 upsert 查询与后台汇总。
5. **本地联调**：未部署云函数时，`callFunction` 会失败 → 走 pending 队列 + 本地存储，答题/评分/筛选/访谈全流程本地照常可用；部署后 `app.onShow` 自动重传。

### AI 动态访谈 `gsyg_interviewChat`（可选，配置后启用）

- **作用**：让访谈动态追问（非纯脚本）。客户端 `utils/interview.js` 的 `llmNextQuestion` 调它；入参 `{ sessionId, itemId, itemContext, teacherRanking, processTags, kbSlice(客户端传入的该题知识库切片), history, remainingMs }`，返回 `{ ok, question, done, evidenceHint }`。
- **回退**：LLM 未配置 / 失败 / 超时（客户端 15s、云端 12s）/ `wx.cloud` 不可用 → `llmNextQuestion` 返回 `null`，页面**自动回退规则版脚本序列**（Q1–Q7/Q-stop），保证离线/未接模型也能走完访谈。
- **LLM provider（环境变量，不硬编码 key）**：在云开发控制台为该函数配置环境变量：
  - `LLM_PROVIDER`：`wxai`（微信云开发 AI 能力，**推荐**，国内可达）/ `openai`（OpenAI 兼容接口，含多数国产大模型的 `/v1/chat/completions` 兼容层）/ `custom`。
  - `LLM_ENDPOINT`、`LLM_KEY`、`LLM_MODEL`：provider=openai/custom 时必填（endpoint 为完整 chat/completions URL）。
  - ⚠️ **腾讯云国内环境直连海外 API 可能不通**：推荐用**微信云开发 AI 能力**或**国产大模型**；Claude 仅在网络可达时经兼容网关使用。
- **红线（已写入 system prompt）**：只围绕教师真实排序追问判断依据/现场语言/后续策略；绝不暴露专家排序、得分、标准答案；每轮一问；先接住上轮回答再追缺失证据；`remainingMs<60000` 或证据足 → `done:true` + 收束语。
- **合规 TODO**：返回文本上线前应过 `security.msgSecCheck`（AI 生成内容需人工审核 + 可追溯），index.js 已留注释位。

---

## 五、算法口径（与 demo 一致，勿简化）

- **评分 = 确定性查表**（`scoring.js`）：`排序数组 → "A>B>C>D" → 查 scoreTable → 0-4 分`。总分/均分/总体水平/每题相对个人均值偏离 RD 均为算术。**AI 不参与打分，严禁任何智能判断**。
  - `data/scoreTable.js` 为 **DOC《000 10题赋分.xlsx》真实值**（全 10 题 × 24 排列），由 `tools/build_scoreTable.js` 一次性转换生成（小程序运行时不读 xlsx）。
  - **排列顺序口径**：xlsx 首列「选项组合」（ABCD…DCBA，恰为字典序）**显式**给出每行对应排列，行号↔排列 **来自原表、非假设**；排列串语义 = 最理想→最不理想。若研究团队确认口径不同，只改 `tools/build_scoreTable.js` 的 `permToKey` 一处。
- **时间埋点**（`exam.js`）：记录每题 `duration_ms`、`enter_ts/submit_ts`、`move_log` 时间戳，及整卷 `examStartTs/examSubmitTs/totalExamMs`；本地存 session，并随 sessions 上报（`items[].durationMs`、`totalDurationMs`、`examStartTs`、`examSubmitTs`）。时间用于 P-IVI/筛选与后续分析，**评分不依赖时间**（时间长≠能力弱）。
- **过程指标**（`process.js`）：**必须回放 move_log**（从 `first_ranking` 起「移除选项→插入到 to_pos」重建每步排序）。首/末位摇摆按各步序列变更次数（≥2 强摇摆），**不用「首≠尾」简化**；路径振荡 = 位次方向反转；合成 P-IVI。评分不依赖过程指标。
- **R/P/G 筛选（服务端遴选,advisor 完整版）**：由云函数 `gsyg_selectFinal`(`cloudfunctions/gsyg_selectFinal/`) 完成,基于 Node.js 端口的 Python advisor 完整算法(`tools/advisor_port.js`)+ 45 位教师冷启动常模(`tools/advisor_norms.js`)。用户点「去 AI 访谈」时经 `utils/interviewGate.js` 阻塞式调用,失败弹「重试 / 取消」。**`scoring.js selectThree` 已 deprecated 但保留代码**,不在提交流程中使用(仅供离线兜底与参考;端上单教师简化版口径与研究版不一致)。
- **访谈**（`interview.js`）：教师排序命中最高优先级触发规则(T)→取脚本序列(Q)→逐轮提问→采集证据点(E)→依锚点编码水平。不暴露专家排序/得分/标准答案。

> 已用 demo 的 Q1 过程埋点验证 `process.js` 回放与 demo.html 完全一致（首位强摇摆 D→A→C / 路径振荡 / 高修正投入）。

---

## 六、待办 / 未决（接手前必看）

1. **✅ 赋分表已用 DOC 真实值**（`data/scoreTable.js`，全 10 题）。**待研究团队核对**的仅剩「选项组合列语义 = 排序(最理想→最不理想)」这一口径；已用知识库 04 表方向做合理性自检通过（Q1 A/C 靠前高分·D 靠前 0；Q5 B/D 靠前高分；Q6 C/D 靠前高分）。若口径不符，改 `tools/build_scoreTable.js` 的 `permToKey` 重新生成。
2. **✅ 全 10 题真实数据**：questions/scoreTable/indicatorMap/knowledge 四处均为 Q1–Q10 DOC 真实数据、题号一致（`node tools/validate_data.js` 校验通过）。答题走 10 题，R/P/G 从 10 题选 3。
3. **✅ 知识库全 10 题**：各题按 DOC 13 表结构化（core_orientation/paths/evidence_points E1-E7/biases P1-P7/triggers T/scripts Q1-Q7+Q-stop/anchors 5 档/suggestions），由 `tools/build_knowledge.js` 生成。注：源 xlsx 有两套列模板（Q 码 / S 码），已统一归一到 09 表基码 Q1–Q7/Q-stop；触发排序匹配由 `interview.js` 依 result_cond 文本通用判定（规则版；真实 LLM 留 `llmNextQuestion` 桩）。
4. **真实 LLM 访谈**：`interview.js` 现为**规则版**（固定脚本序列逐轮提问）。真实 LLM 接入见 `llmNextQuestion` 桩，须经自有已备案后端调用，遵守「不暴露标准答案、每轮一问、非评判」。
5. **过程阈值**：`knowledge.js` 的时长阈值暂用固定 ms（移植 demo）；上线接入常模队列后改百分位。
6. **AI 对话为纯文字输入**（不做语音）：访谈页仅文字输入 + 发送，已移除语音按钮与 `scope.record` 授权。
7. **报告生成（P?）**：CLAUDE.md 第 8 节的综合能力画像报告（三源融合→导出 DOC/PDF）本期未实现，报告须服务端生成。

---

## 七、合规提醒（上线硬门槛）

教育类目资质 + ICP 备案 + 企业主体；UGC 与 AI 生成内容均过 `msgSecCheck/mediaCheckAsync`，AI 问答须人工审核 + 可追溯；隐私指引（AI 对话为纯文字，无需录音授权）。
