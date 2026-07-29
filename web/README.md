# 网页端（`web/`）

此目录是与 `miniprogram/` 并存的教师端网页。小程序不改动；两端共用以下业务口径：

- 题库、赋分表、指标映射、访谈知识库的唯一来源仍为 `miniprogram/data/`。
- `npm run sync` 在网页构建前自动把该来源同步到 `src/generated/data.js`，并复制十张情境图。
- `npm run verify` 对小程序与网页的 10 题 × 24 种排列逐一比对评分结果；AI 不参与评分。
- 网页答题也保存 `first_ranking`、`move_log`、时长等过程字段，和小程序会话字段一致。

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

## 网页微信扫码登录（正式接入）

网页使用 CloudBase Web SDK 发起微信开放平台网站扫码登录。扫码回调后，SDK 拿到的短期 access token 只用于换取网关的 `HttpOnly` 会话 Cookie；后续业务请求不携带可伪造的 `openid`、`uid` 或 access token。

在 `.env.production` 中配置：

```env
VITE_WEB_API_BASE_URL=https://<api-domain>/gsyg-web
VITE_CLOUDBASE_ENV_ID=<CloudBase环境ID>
VITE_CLOUDBASE_REGION=ap-shanghai

# 仅在 CloudBase 还开启了匿名登录、并要自动完成首次扫码帐号绑定时启用：
VITE_CLOUDBASE_ENABLE_FIRST_LOGIN_BIND=true
```

登录前需要在 CloudBase 控制台启用「微信开放平台登录」，并配置微信开放平台网站应用的 AppId、AppSecret、网页域名与授权回调域。首次扫码帐号若未绑定 CloudBase 用户，CloudBase 需要先建立一个用户再绑定第三方身份；本项目可在管理员明确启用匿名登录后，使用一次性匿名帐号完成这一步绑定。详见 `cloudfunctions/gsyg_webGateway/README.md`。

## 后端安全边界（上线前必做）

现有 `gsyg_*` 云函数最初由微信小程序调用，并以 `wxContext.OPENID` 作为身份。**网页不能直接调用它们。** 网页统一调用 `VITE_WEB_API_BASE_URL/call` 的 HTTPS 网关；网关验证 CloudBase 登录身份、从验证结果中取得稳定 UID，再受控调用同一套数据集合和确定性算法。

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
2. 用同一 `GSYG_WEB_GATEWAY_TOKEN` 重部署 `gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_selectFinal`；它们会拒绝匿名演示 actor 和伪造网页 actor。
3. 仅允许已登录教师调用资料写入、会话上报、筛题和 AI 访谈；保留内容安全审核和审计日志。
4. 若需让教师跨小程序与网页继续同一份记录，服务端必须基于已验证手机号或统一帐号建立绑定，绝不能按姓名合并。

前端不存放 CloudBase 管理员 API Key、LLM Key、网关共享密钥或会话签名密钥。
