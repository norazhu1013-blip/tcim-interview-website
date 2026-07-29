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

## 后端接入（上线前必做）

现有 `gsyg_*` 云函数由微信小程序调用，并以 `wxContext.OPENID` 作为身份。**网页不能直接调用它们。** CloudBase 对混合调用场景也明确提示：非小程序调用没有 `OPENID`，复用实例还可能遗留上一位小程序用户的环境变量，从而造成越权风险。

因此网页端统一调用 `VITE_WEB_API_BASE_URL/call`。该 HTTPS 网关应：

1. 使用网页认证（短信、账号、微信开放平台扫码或企业 SSO 任选已开通的一种）建立 HttpOnly 会话或验证 Bearer token。
2. 从可信会话取得稳定的 `webUserId`，绝不从请求 JSON 接收 `openid` / `uid`。
3. 将 `reportTeacher`、`reportSession`、`selectFinal`、`interviewChat`、`reportInterview` 分发给现有同一套数据集合和确定性算法；会话记录增加 `identityType: 'web'` 与 `ownerId: webUserId`，并按 ownerId 做读写校验。
4. 保持小程序的 `openid` 记录和网页的 `webUserId` 隔离；如产品要求同一教师跨端连续使用，再通过已验证的手机号或统一账号在服务端建立绑定，不能只依赖姓名。
5. 仅允许已登录用户访问写入、筛题与访谈接口；AI 仍由服务端调用，且保留内容安全审核和审计日志。

网关约定：

```http
POST /call
Content-Type: application/json

{"action":"reportSession","data":{"sessionId":"..."}}
```

返回值沿用云函数约定：`{ "ok": true, ... }` 或 `{ "ok": false, "error": "..." }`。

将 `.env.example` 复制为 `.env.production` 并填入网关地址后再构建。前端不存放 CloudBase 管理员 API Key、LLM Key 或网关共享密钥。
