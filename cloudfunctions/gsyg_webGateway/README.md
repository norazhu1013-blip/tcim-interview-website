# `gsyg_webGateway`：网页匿名演示网关

这是**测试环境专用** HTTP 云函数：它不验证手机号，而为每个浏览器签发随机 HttpOnly Cookie，并将该 Cookie 映射为 `web_demo:<随机值>`。Cookie 丢失、换浏览器或无痕模式后均视为新用户。

## 部署前环境变量

以下四个普通事件云函数和网关必须配置**同一个**高强度随机值：

- `gsyg_webGateway`
- `gsyg_reportTeacher`
- `gsyg_reportSession`
- `gsyg_reportInterview`
- `gsyg_selectFinal`

```text
GSYG_WEB_GATEWAY_TOKEN=<至少32字节随机值>
```

网关另需：

```text
WEB_ALLOWED_ORIGIN=https://<网页域名>
WEB_COOKIE_SECURE=1
WEB_COOKIE_SAMESITE=lax
GSYG_WEB_RATE_LIMIT=36
GSYG_WEB_RATE_WINDOW_MS=600000
NODE_ENV=production
```

本地静态站和 API 不在同一个站点时，把 `WEB_COOKIE_SAMESITE=none`，并保持 HTTPS。

## 部署

1. CloudBase 控制台 → 云函数 → 新建 **HTTP 云函数**，名称 `gsyg_webGateway`，Node.js 18+。
2. 上传本目录，选择「云端安装依赖」；HTTP 云函数需启动 `scf_bootstrap` 并监听 9000 端口。
3. 配置上述环境变量；在「HTTP 访问服务」绑定 `/gsyg-web` 路径或自定义 API 域名。
4. 设置函数安全规则允许 HTTP 演示调用；网关本身以 `WEB_ALLOWED_ORIGIN` 做浏览器来源限制，不能把现有 `gsyg_*` 事件云函数公开给网页。
5. 设置网页构建环境变量：`VITE_WEB_API_BASE_URL=https://<api-domain>/gsyg-web`，重新构建并部署 `web/dist`。

## 限制

- 不可用于正式数据采集、管理员操作、导出或教师跨设备记录。
- 测试时不要录入真实手机号或敏感个人信息；完成测试后清理 `identityType="web_demo"` 的数据。
- 正式上线必须替换为手机号验证码认证，并移除匿名演示网关或关闭其路由。
