# `gsyg_webGateway`：网页账号登录网关

这是网页端身份入口。教师验证邮箱后自行创建 **CloudBase 用户名和密码**，再用用户名或邮箱登录并由 SDK 取得短期 CloudBase access token。该 token 只提交给本函数的 `/auth/session` 一次。本函数调用 CloudBase 的已登录用户信息接口反查 UID，并确认不是匿名身份后，再签发一个带 HMAC 的 `HttpOnly` Cookie。之后所有网页业务请求只使用 Cookie，不能从请求 JSON 伪造 `openid`、`uid` 或 CloudBase token。

> 原有匿名会话 Cookie 不再被接受。历史匿名研究数据保留，不按姓名自动合并到新账号。

## CloudBase 控制台配置

1. 在「身份认证 → 登录方式」开启**用户名密码登录**和**邮箱验证码**，允许教师验证邮箱后自行注册。
2. 在 CloudBase 环境安全配置中加入网页域名，例如 `https://app.example.com`。
3. 网页域名和 API 网关域名按 CORS/Cookie 规则配置；网页端不使用默认登录页、`redirect_uri` 或微信开放平台回调域。

## 云函数环境变量

以下网页受控函数必须配置**同一个**高强度随机值（只部署实际启用的可选模块）：

- `gsyg_webGateway`
- `gsyg_reportTeacher`
- `gsyg_reportSession`
- `gsyg_reportInterview`
- `gsyg_reportDraft`
- `gsyg_selectFinal`
- `gsyg_interviewChat`
- `gsyg_dialogueAgent`
- `gsyg_semanticProbe`
- `gsyg_planner`
- `gsyg_whoami`
- `gsyg_exportData`

```text
GSYG_WEB_GATEWAY_TOKEN=<至少32字节随机值>
```

`gsyg_webGateway` 另需：

```text
# 用于给 HttpOnly 网关会话签名；独立随机值，至少32字节，绝不放入前端。
GSYG_WEB_SESSION_SECRET=<至少32字节随机值>

# 与网页 VITE_CLOUDBASE_ENV_ID 一致。WEB_CLOUDBASE_REGION 保留给自定义 URL/历史配置使用。
WEB_CLOUDBASE_ENV_ID=<CloudBase环境ID>
WEB_CLOUDBASE_REGION=ap-shanghai

# 可选。未填时按上述环境 ID 自动构造：
# https://<env>.api.tcloudbasegateway.com/auth/v1/user/me
WEB_CLOUDBASE_USERINFO_URL=

WEB_ALLOWED_ORIGIN=https://app.example.com
WEB_COOKIE_SECURE=1
WEB_COOKIE_SAMESITE=lax
WEB_SESSION_TTL_SECONDS=21600
# 临时研究试用入口。正式投入使用时应设为0，并恢复前端账号登录。
WEB_TEST_ENTRY_ENABLED=0
WEB_TEST_SESSION_TTL_SECONDS=604800
# R6.1 每轮有前台问句 + 后台 Evidence 两次调用，三题访谈建议至少 120。
GSYG_WEB_RATE_LIMIT=180
GSYG_WEB_RATE_WINDOW_MS=600000

# 普通云函数保持 15 秒；旧访谈和 R6.1 Dialogue Agent 允许等待 65 秒。
GSYG_WEB_UPSTREAM_TIMEOUT_MS=15000
GSYG_WEB_INTERVIEW_TIMEOUT_MS=65000
NODE_ENV=production
```

访谈超时是在独立的 CloudBase SDK 实例初始化时设置的。不要只把 `timeout` 放进
`cloud.callFunction()` 的参数对象；当前 `wx-server-sdk` 的 provider 调用链不会让该值
覆盖底层默认的 15 秒等待。

网页和 API 不在同一个站点且确实需要跨站 Cookie 时，设 `WEB_COOKIE_SAMESITE=none`；此时必须保持 HTTPS 和 `WEB_COOKIE_SECURE=1`。`WEB_ALLOWED_ORIGIN` 仅填写精确的网页 Origin，不要使用 `*`。

## 部署

1. CloudBase 控制台 → 云函数 → 新建 **HTTP 云函数**，名称 `gsyg_webGateway`，Node.js 18+。
2. 上传本目录并选择「云端安装依赖」。HTTP 云函数通过 `scf_bootstrap` 监听 9000 端口；函数自身超时需设为至少 70 秒。
3. 配置上述环境变量；在「HTTP 访问服务」绑定 `/gsyg-web` 路径或自定义 API 域名。
4. 新建并部署 `gsyg_dialogueAgent`（Node.js 18.15+、超时至少 65 秒、网页模式配置 `TCIM_DIALOGUE_CONTENT_SAFETY_MODE=tencent_tms` 及 TMS 最小权限凭证），再重新上传网关白名单使用的受控事件云函数：`gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_reportDraft`、`gsyg_selectFinal`、`gsyg_whoami`、`gsyg_exportData`，以及实际启用的可选模块。函数只接受格式为 `web:<CloudBase UID>` 的、带共享网关令牌的网页调用。
5. 设置网页构建变量，重新构建并部署 `web/dist`：

```env
VITE_WEB_API_BASE_URL=https://api.example.com/gsyg-web
VITE_CLOUDBASE_ENV_ID=<CloudBase环境ID>
VITE_CLOUDBASE_REGION=ap-shanghai
```

6. 上线前先访问 `/gsyg-web/health`，确认 `dialogueAgent.ready=true`、provider/model/promptVersion 正确，再打开网页完成注册、资料、答题和访谈。可先运行 `npm test` 验证正式账号通过、匿名身份拒绝、会话签发和伪造身份拦截逻辑。

### 临时免注册测试

研究团队短期试用时，可将网关 `WEB_TEST_ENTRY_ENABLED=1`，并在网页构建中设置 `VITE_TEMPORARY_TEST_ENTRY=1`。网页会调用 `POST /auth/test-session`；网关生成不可预测的 `web:test_*` actor，签发带 HMAC 的 `HttpOnly` Cookie，并继续由网关覆盖业务请求中的身份字段。它不是所有人共用的公共账号，也不接受前端自报 uid。关闭这两个开关并重新部署即可恢复正式账号入口。

## 安全边界

- 网页从不直调依赖 `wxContext.OPENID` 的事件云函数，也不在前端保存 `GSYG_WEB_GATEWAY_TOKEN`、会话签名密钥、CloudBase 管理员密钥或 LLM 密钥。
- `/auth/session` 必须成功向 CloudBase 反查 access token 对应的 UID，且有明确的非匿名账号证据，才会签发 Cookie；Cookie 带 `HttpOnly`、`Secure`（生产环境）和有限有效期。
- `/auth/test-session` 只有 `WEB_TEST_ENTRY_ENABLED=1` 时存在；它只签发随机测试身份，不接收邮箱、密码或客户端 uid。测试身份默认七天有效，清除浏览器 Cookie 后会成为新的测试参与者。
- 下游会话、访谈上报和遴选均按 `web:<UID>` 做 owner 校验；已知的 `sessionId` 不能覆盖其他教师数据。
- 网页管理员导出只返回 `openid` 以 `web:` 开头的网站参与者数据；小程序管理员原有导出范围不变。
- 如果需要让小程序与网页识别为同一位教师，必须在服务端以已验证手机号或统一帐号建立绑定；不能按姓名合并。
