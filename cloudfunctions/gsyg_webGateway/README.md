# `gsyg_webGateway`：网页匿名登录网关

这是网页端身份入口。网页首页通过 **CloudBase Web SDK 匿名登录**自动检查登录态；没有 CloudBase 凭证时调用 `auth().signInAnonymously()`，再由 SDK 取得短期 CloudBase access token。该 token 只提交给本函数的 `/auth/session` 一次。本函数调用 CloudBase 的已登录用户信息接口反查 UID，再签发一个带 HMAC 的 `HttpOnly` Cookie。之后所有网页业务请求只使用 Cookie，不能从请求 JSON 伪造 `openid`、`uid` 或 CloudBase token。

> 原有匿名演示 Cookie 不再被接受。正式采集前应清理旧 `identityType="web_demo"` 测试数据。

## CloudBase 控制台配置

1. 在「身份认证 → 登录方式」开启**匿名登录**。
2. 在 CloudBase 环境安全配置中加入网页域名，例如 `https://app.example.com`。
3. 网页域名和 API 网关域名按 CORS/Cookie 规则配置；网页端不再使用默认登录页、`redirect_uri` 或微信开放平台回调域。

## 云函数环境变量

以下八个函数必须配置**同一个**高强度随机值：

- `gsyg_webGateway`
- `gsyg_reportTeacher`
- `gsyg_reportSession`
- `gsyg_reportInterview`
- `gsyg_selectFinal`
- `gsyg_interviewChat`
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
GSYG_WEB_RATE_LIMIT=36
GSYG_WEB_RATE_WINDOW_MS=600000

# 普通云函数保持 15 秒；访谈模型允许等待 65 秒。
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
4. 重新上传受控事件云函数：`gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_selectFinal`、`gsyg_interviewChat`、`gsyg_whoami`、`gsyg_exportData`。其中身份与管理员接口只接受格式为 `web:<CloudBase UID>` 的、带共享网关令牌的网页调用。
5. 设置网页构建变量，重新构建并部署 `web/dist`：

```env
VITE_WEB_API_BASE_URL=https://api.example.com/gsyg-web
VITE_CLOUDBASE_ENV_ID=<CloudBase环境ID>
VITE_CLOUDBASE_REGION=ap-shanghai
```

6. 上线前验证：打开网页 → 自动完成 CloudBase 匿名登录 → 网关 `/auth/session` 返回 `ok: true` → 完成一次资料保存、答题上报和访谈调用。可先运行 `npm test` 验证网关的令牌验证、会话签发和伪造身份拦截逻辑。

## 安全边界

- 网页从不直调依赖 `wxContext.OPENID` 的事件云函数，也不在前端保存 `GSYG_WEB_GATEWAY_TOKEN`、会话签名密钥、CloudBase 管理员密钥或 LLM 密钥。
- `/auth/session` 必须成功向 CloudBase 反查 access token 对应的 UID 才会签发 Cookie；Cookie 带 `HttpOnly`、`Secure`（生产环境）和有限有效期。
- 下游会话、访谈上报和遴选均按 `web:<UID>` 做 owner 校验；已知的 `sessionId` 不能覆盖其他教师数据。
- 网页管理员导出只返回 `openid` 以 `web:` 开头的网站参与者数据；小程序管理员原有导出范围不变。
- 如果需要让小程序与网页识别为同一位教师，必须在服务端以已验证手机号或统一帐号建立绑定；不能按姓名合并。
