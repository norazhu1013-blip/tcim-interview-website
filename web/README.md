# 网页端（`web/`）

此目录是与 `miniprogram/` 并存的教师端网页。小程序不改动；两端共用以下业务口径：

- 题库、赋分表、指标映射、访谈知识库的唯一来源仍为 `miniprogram/data/`。
- `npm run sync` 在网页构建前自动把该来源同步到 `src/generated/data.js`，并复制十张情境图。
- `npm run verify` 对小程序与网页的 10 题 × 24 种排列逐一比对评分结果；AI 不参与评分。
- 网页答题也保存 `first_ranking`、`move_log`、时长等过程字段，和小程序会话字段一致。

## AI 访谈口径

- R6.2 网页使用 **Dialogue Agent 主导＋新五表 V0.2.1＋Evidence State**；评分和 R/P/G 筛题仍为确定性程序，AI 不参与评分。
- 网页只经现有账号网关调用 `gsyg_dialogueAgent`。教师不能选择模型、输入密钥或直接访问模型服务；provider/model 由云端配置并锁定到整次测评。
- Dialogue Agent 采用中性同行口吻，不设置表扬次数，不评价教师的诚实、人格或回答质量；挑战后的舒缓轮、整体理解问题和 Evidence 来源隔离继续保留。
- 前台生成只保留最近必要上下文，最多调用模型两次；可安全分离的评价式前缀由程序直接删除，不为删一句话增加模型等待。
- 模型调用失败时，网页保留已有对话并显示“重新生成 / 结束本情境”，不会在后台切换成固定专业问题。
- 小程序原有 `gsyg_interviewChat` 路径继续保留，网页 R6.2 不用它替代 Dialogue Agent。

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

## 网页登录与临时测试入口

网页支持教师用用户名、邮箱验证码和密码自行注册，之后可用用户名或邮箱配合密码登录；已有正式账号凭证时可直接恢复网关 `HttpOnly` 会话 Cookie。不会自动创建匿名身份。SDK 保存的短期 access token 只用于换取网关 Cookie；后续业务请求不携带可伪造的 `openid`、`uid` 或 access token。

研究试用阶段可临时设置 `VITE_TEMPORARY_TEST_ENTRY=1`，并在网关设置 `WEB_TEST_ENTRY_ENABLED=1`。此时网页不展示邮箱注册和验证码，网关为每个浏览器签发随机的 `web:test_*` 测试身份；教师仍需填写姓名、园所和教龄，资料、测评和访谈按该随机身份隔离。正式账号代码不会删除，关闭两个开关并重新部署即可恢复。

在 `.env.production` 中配置：

```env
VITE_WEB_API_BASE_URL=https://<api-domain>/gsyg-web
VITE_CLOUDBASE_ENV_ID=<CloudBase环境ID>
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_LOCAL_RESEARCH_MODE=0
VITE_TEMPORARY_TEST_ENTRY=0
VITE_TCIM_COMPARISON_ARCHITECTURE=dialogue_agent_new_five_tables_evidence_state
VITE_TCIM_RELEASE_ID=TCIM-WEB-2026.09.01-R6.2
```

登录前需要在 CloudBase 控制台启用「用户名密码登录」和邮箱验证码注册，并在环境安全配置中加入网页域名。详见 `cloudfunctions/gsyg_webGateway/README.md`。

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
2. 新建并部署 `gsyg_dialogueAgent`，配置与网关相同的 `GSYG_WEB_GATEWAY_TOKEN`、`TCIM_DIALOGUE_CONTENT_SAFETY_MODE=tencent_tms`、腾讯云 TMS 最小权限凭证、固定 provider/model 和云端模型密钥；普通网页不得调用需要小程序 OPENID 的 `msgSecCheck`。运行时 Node.js 18.15+，超时至少 65 秒。
3. 用同一 `GSYG_WEB_GATEWAY_TOKEN` 重部署 `gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_reportDraft`、`gsyg_selectFinal`、`gsyg_whoami`、`gsyg_exportData`；它们会拒绝伪造网页 actor。
4. 正式运行仅允许已建立正式账号会话的教师调用；临时研究试用可显式开启服务端签名的随机测试身份，不能把客户端提交的 uid 当作身份。保留内容安全审核和审计日志。
5. 若需让教师跨小程序与网页继续同一份记录，服务端必须基于已验证手机号或统一帐号建立绑定，绝不能按姓名合并。

前端不存放 CloudBase 管理员 API Key、LLM Key、网关共享密钥或会话签名密钥。
