# CURRENT_FLOW —— 现有完整调用链（TCIM Task 1 只读审计）

> 依据 2026-08 实际代码梳理（`web/`、`miniprogram/`、`cloudfunctions/`）。只读审计，未改业务代码。

## 一、网页端（`web/`，Vue 3 + Vite）

### 1. 登录链路
```
浏览器加载首页 (web/src/main.js → App.vue)
  → web-auth.ensureWebLogin()
      → GET /auth/session（网关）      ← 无 Cookie → 401
      → CloudBase 匿名登录 signInAnonymously() 拿 access token
      → POST /auth/session
          Authorization: Bearer <token>
          → gsyg_webGateway 向 CloudBase /auth/v1/user/me 校验 → Set-Cookie(gsyg_web_session)
      → 之后 GET /auth/session → 200
```
- 文件：`web/src/services/cloudbase.js`、`web/src/services/web-auth.js`、`web/src/services/web-gateway.js`
- 网关：`cloudfunctions/gsyg_webGateway/index.js`（HTTP 云函数，Express）
- 认证模式：**CloudBase 匿名登录**（`identityType=web_anonymous`，actor=`web:<uid>`）

### 2. 答题→评分→遴选→访谈
```
HomeView 开始测评
  → ExamView 10 题排序（本地，move_log 埋点）
  → submit 提交 → api.reportExam
      → POST /gsyg-web/call  {action:'reportSession', data:{sessionId, answers, scores, ...}}
      → 网关 → gsyg_reportSession → 集合 gsyg_sessions
  → ScoreView / InterviewListView 触发 service 遴选
      → api.selectFinal
      → POST /gsyg-web/call  {action:'selectFinal', data:{sessionId}}
      → 网关 → gsyg_selectFinal（R/P/G + 常模 + 任务卡预生成）→ 写回 selection
  → InterviewView 逐情境访谈
      ├─ TCIM 模式（默认 VITE_TCIM_MODE=ont）：
      │    → web/src/core/tcim/engine.js（本地确定性引擎，不调云端 LLM）
      │    → 数据 web/src/generated/tcim-data.js（由 5 张表生成）
      └─ legacy 模式：
           → api.interviewNext
           → POST /gsyg-web/call  {action:'interviewChat', data:{...}}
           → 网关 → gsyg_interviewChat（LLM 提示词 v7.4）
  → 访谈完成 → api.reportInterview
      → POST /gsyg-web/call  {action:'reportInterview'}
      → 网关 → gsyg_reportInterview → 集合 gsyg_interviews
```
- 本地存储：`web/src/services/storage.js`（localStorage，sessionId 主键）
- 确定性评分：`web/src/core/scoring.js`（查表）；过程指标：`web/src/core/process.js`
- legacy 访谈辅助：`web/src/core/interview.js`（trigger 匹配 / 脚本队列 / kbSlice）

## 二、小程序端（`miniprogram/`，原生）

```
home 开始答题 → exam（movable-view 排序，move_log 埋点）
  → submit → api.reportExam → wx.cloud.callFunction gsyg_reportSession → gsyg_sessions
  → score / review / interviewList
      → interviewGate.ensureFinalThen → api.selectFinal → gsyg_selectFinal
  → interview → utils/interview.js
      ├─ buildScriptQueue（规则版兜底，T→Q→E→锚点）
      └─ llmNextQuestion → api.interviewChat → gsyg_interviewChat（LLM 首选）
  → 完成 → api.reportInterview → gsyg_reportInterview → gsyg_interviews
```
- 文件：`miniprogram/utils/api.js`（wx.cloud.callFunction，`gsyg_` 前缀）
- `miniprogram/utils/config.js`：`PREFIX='gsyg_'`，集合 `gsyg_teachers/sessions/interviews`
- 登录：`miniprogram/pages/login`（手机号授权，云函数 `gsyg_getPhoneNumber`）

## 三、云函数（`cloudfunctions/`，CloudBase）

| 函数 | 类型 | 职责 | 关键输入→输出 |
|---|---|---|---|
| `gsyg_webGateway` | HTTP | 认证网关、转发 | `/auth/session`(GET/POST)、`/auth/logout`、`/call`(5 类 action 白名单) |
| `gsyg_reportTeacher` | 事件 | upsert 教师资料 | `{profile}` → `gsyg_teachers` |
| `gsyg_reportSession` | 事件 | upsert 作答 | `{sessionId, answers, scores, ...}` → `gsyg_sessions` |
| `gsyg_selectFinal` | 事件 | R/P/G 遴选 + 任务卡 | `{sessionId}` → 读 session → advisor → `selection` |
| `gsyg_interviewChat` | 事件 | LLM 动态追问 | `{sessionId, itemId, history, taskCard, ...}` → `{question, done, ...}` |
| `gsyg_reportInterview` | 事件 | upsert 访谈记录 | `{sessionId, transcripts, feedback}` → `gsyg_interviews` |
| `gsyg_exportData` | 事件 | 研究导出 | `{format}` → xlsx/json 文件 |
| `gsyg_getPhoneNumber` | 事件 | mp 手机号换号 | `{code}` → phone |

## 四、数据流

```
miniprogram/data/  ← canonical 题库/赋分/映射/知识库
      │  (sync-data.mjs 构建时同步)
      ▼
web/src/generated/data.js
tcim/professional_data/game_support/  ← TCIM 5 张表（build_tcim_data.py 生成）
      │  (build_tcim_web_data.mjs 构建时同步)
      ▼
web/src/generated/tcim-data.js
```

## 五、关键结论

1. **教师回答保存位置**：网页 localStorage（`storage.js`）+ 云 `gsyg_sessions/interviews`。
2. **LLM 调用**：唯一在 `gsyg_interviewChat`（legacy 访谈 + 网页 legacy 模式）；TCIM 模式不调。
3. **题目/测评数据读取**：`web/src/generated/data.js`（源自 `miniprogram/data/`）。
4. **下一问生成**：
   - legacy：`gsyg_interviewChat`（LLM）
   - TCIM：`web/src/core/tcim/engine.js`（确定性）
5. **最小接入点（TCIM）**：`web/src/views/InterviewView.vue` 的 `requestNext()` —— TCIM/legacy 在此分叉。
