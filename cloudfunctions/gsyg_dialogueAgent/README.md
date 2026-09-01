# gsyg_dialogueAgent

把冻结提交中的 `local-dialogue-server/src/` Dialogue Agent 核心部署到现有 CloudBase 网页账号网关之后。它不开放模型配置接口，不保存密钥，也不使用本机 `.runtime-data`。

## 发布边界

- 浏览器只能经 `gsyg_webGateway` 的已登录 HttpOnly 会话调用；云函数再次校验共享网关令牌和正式网页账号 actor。
- 每次正式调用先核对 `gsyg_sessions` 所有者，并在首次调用时把 provider/model/promptVersion 锁到整次测评。
- 普通网页默认使用腾讯云文本内容安全 TMS 审核教师输入与 AI 可见输出，不再误调需要小程序身份的 `msgSecCheck`。
- 只有真正的小程序调用链才允许显式配置 `wechat_miniprogram` 模式；未正确配置时正式调用会失败关闭。
- `src/` 是 `local-dialogue-server/src/` 的部署副本。修改核心逻辑后运行 `node tools/sync_dialogue_cf.js`，再同时执行本机服务和云函数测试。

## 云端变量

- `GSYG_WEB_GATEWAY_TOKEN`：与网页网关相同的共享令牌。
- `TCIM_DIALOGUE_CONTENT_SAFETY_MODE=tencent_tms`：网页生产默认值。
- `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`：只放云函数密钥管理；优先使用为 TMS 单独创建的最小权限子账号凭证。
- `TENCENTCLOUD_SESSION_TOKEN`：使用临时凭证时一并配置。
- `TENCENT_TMS_REGION=ap-guangzhou`、`TENCENT_TMS_BIZ_TYPE=TencentCloudDefault`：按内容安全控制台实际策略调整。
- `provider` 只允许临时诊断，并且必须额外设置 `TCIM_DIALOGUE_ALLOW_PROVIDER_SAFETY_ONLY=1`；不得作为正式发布配置。
- `SEC_CHECK=1`：仅当 `TCIM_DIALOGUE_CONTENT_SAFETY_MODE=wechat_miniprogram` 时使用。
- `TCIM_DIALOGUE_PROVIDER=kimi`（或经研究方案确认的 `openai`）。
- `KIMI_API_KEY` / `MOONSHOT_API_KEY`，或 `OPENAI_API_KEY`：只放云函数环境变量/密钥管理。
- 其余 `TCIM_DIALOGUE_*`、`KIMI_*`、`OPENAI_*` 参数见发布交付包模板。
- 生产禁止 `TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS=1`。

Node.js 运行时须为 18.15 或更高，函数超时建议至少 65 秒。上传时选择“云端安装依赖”。

正式部署前须先在腾讯云控制台开通文本内容安全服务，并给 TMS 凭证配置最小调用权限。`config.json` 保留 `security.msgSecCheck` 云调用权限，只供未来真正的小程序调用链使用；普通网页模式不会调用它。依赖锁文件固定使用发布时的微信官方 `wx-server-sdk 4.0.2`，后续升级前必须复跑本目录测试与云端健康检查。

## 验证

```bash
node tools/sync_dialogue_cf.js --check
node --test cloudfunctions/gsyg_dialogueAgent/test/*.test.js
```
