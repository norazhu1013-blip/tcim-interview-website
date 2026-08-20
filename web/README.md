# 网页端（`web/`）

此目录是与 `miniprogram/` 并存的教师端网页。小程序不改动；两端共用以下业务口径：

- 题库、赋分表、指标映射、访谈知识库的唯一来源仍为 `miniprogram/data/`。
- `npm run sync` 在网页构建前自动把该来源同步到 `src/generated/data.js`，并复制十张情境图。
- `npm run verify` 对小程序与网页的 10 题 × 24 种排列逐一比对评分结果；AI 不参与评分。
- 网页答题也保存 `first_ranking`、`move_log`、时长等过程字段，和小程序会话字段一致。

## AI 访谈口径

- 网页与小程序共用 `gsyg_interviewChat` 的 **V7.4 访谈决策程序**，模型配置只改变实际调用的模型，不改变访谈规则。
- 正常访谈至少提出 8 个可回答问题，不设固定最高问数；达到 8 个后按教师回答是否已经形成较完整的判断链，再决定是否收束。
- 每轮围绕教师最新回答推进一条主线，优先追问判断之间的关系、教育张力、条件或边界，不按固定首问和选项顺序机械询问排序理由。
- 模型调用失败时，网页保留已有对话并显示“重新生成 / 结束本情境”，不会在后台切换成固定问题脚本。
- 剩余不足 1 分钟时仍由同一访谈程序结合教师最新回答生成内容化收束，不用通用结束语突然截断。

## 本地运行

```bash
cd web
npm install
npm run dev
```

生产构建：

```bash
npm run verify
npm run build
```

`npm run verify` 同时检查评分口径和 V7.4 访谈流程，任一项不一致都会失败。

## 网页 CloudBase 账号登录

网页使用研究者发放的 CloudBase 用户名和密码登录；已有正式账号凭证时可直接恢复网关 `HttpOnly` 会话 Cookie。不会自动创建匿名身份。SDK 保存的短期 access token 只用于换取网关 Cookie；后续业务请求不携带可伪造的 `openid`、`uid` 或 access token。

在 `.env.production` 中配置：

```env
VITE_WEB_API_BASE_URL=https://<api-domain>/gsyg-web
VITE_CLOUDBASE_ENV_ID=<CloudBase环境ID>
VITE_CLOUDBASE_REGION=ap-shanghai
# 可选：选择 gsyg_interviewChat 内置 LLM profile；生产环境也可由云函数默认值决定
VITE_INTERVIEW_LLM_PROFILE=openai-official
```

登录前需要在 CloudBase 控制台启用「用户名密码登录」、发放账号，并在环境安全配置中加入网页域名。详见 `cloudfunctions/gsyg_webGateway/README.md`。

## 后端安全边界（上线前必做）

现有 `gsyg_*` 云函数最初由微信小程序调用，并以 `wxContext.OPENID` 作为身份。**网页不能直接调用它们。** 网页统一调用 `VITE_WEB_API_BASE_URL/call` 的 HTTPS 网关；网关验证 CloudBase 正式账号、从验证结果中取得稳定 UID，再受控调用同一套数据集合和确定性算法。

网关约定：

```http
POST /call
Content-Type: application/json
Cookie: gsyg_web_session=<HttpOnly cookie，由浏览器自动携带>

{"action":"reportSession","data":{"sessionId":"..."}}
```

返回值沿用云函数约定：`{ "ok": true, ... }` 或 `{ "ok": false, "error": "..." }`。

部署时必须：

1. 部署 `cloudfunctions/gsyg_webGateway/` HTTP 云函数，并按其 README 配置 `GSYG_WEB_GATEWAY_TOKEN`、`GSYG_WEB_SESSION_SECRET`、CORS 与 CloudBase 环境变量。
2. 用同一 `GSYG_WEB_GATEWAY_TOKEN` 重部署 `gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_selectFinal`、`gsyg_interviewChat`、`gsyg_whoami`、`gsyg_exportData`；它们会拒绝匿名演示 actor 和伪造网页 actor。
3. 仅允许已建立正式账号会话的教师调用资料写入、会话上报、筛题和 AI 访谈；保留内容安全审核和审计日志。
4. 若需让教师跨小程序与网页继续同一份记录，服务端必须基于已验证手机号或统一帐号建立绑定，绝不能按姓名合并。

前端不存放 CloudBase 管理员 API Key、LLM Key、网关共享密钥或会话签名密钥。
