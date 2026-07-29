# 云函数目录（`gsyg_` 前缀）

| 云函数 | 触发方 | 集合 | 作用 |
|---|---|---|---|
| `gsyg_initDb` | 管理端一次性 | 三个集合 | 幂等建集合 + 建唯一/复合索引 |
| `gsyg_getPhoneNumber` | 登录页手机号授权 | —— | 用 getPhoneNumber `code` 换真实手机号（`cloud.openapi.phonenumber.getPhoneNumber`） |
| `gsyg_reportTeacher` | 客户端保存 profile | `gsyg_teachers` | 按 `openid` upsert（isAdmin 不接受客户端写入） |
| `gsyg_reportSession` | 客户端提交答题 | `gsyg_sessions` | 按 `sessionId` upsert |
| `gsyg_reportInterview` | 客户端提交访谈 | `gsyg_interviews` | 按 `sessionId` upsert |
| `gsyg_interviewChat` | 访谈对话每轮 | —— | LLM 动态追问，失败回退规则版 |
| `gsyg_whoami` | 客户端「我的」页 onShow | `gsyg_teachers` | 返回 `{openid, isAdmin, teacher}` |
| `gsyg_exportData` | 管理员在「我的」页触发 | 三个集合 | 全量导 JSON → 云存储 `gsyg-exports/` → 返回下载链接 |
| `gsyg_webGateway` | 网页端（HTTP） | 三个集合/既有函数 | **测试专用**匿名 Cookie 网关，受控转发网页完整流程 |

## 管理员标记

`gsyg_teachers` 集合有 `isAdmin: boolean` 字段（默认 `false`）。**客户端上传的 profile 不能改 `isAdmin`**，必须在云开发控制台数据库里手工把某条 teacher 记录的 `isAdmin` 改为 `true` —— 这就是"最简管理员认证"。

设置流程：
1. 目标用户先在小程序里完善一次个人信息（触发 `gsyg_reportTeacher` upsert 建条记录）。
2. 云开发控制台 → 数据库 → `gsyg_teachers` → 找到该 openid 记录 → 编辑 → `isAdmin: true`。
3. 该用户下次进「我的」页会看到"角色：管理员"。

后续要做的导出/清理等管理功能可以在云函数里读 teacher.isAdmin 判定是否放行。

## 部署新环境的一次性流程

1. 微信开发者工具打开仓库根，云开发环境已选好。
2. 右键各云函数 → 上传并部署（云端安装依赖）。
3. 打开 `gsyg_initDb` → 云端测试 → event 空 `{}` → 触发，返回的 `collections/indexes` 都 ok 即完成。
4. 集合权限建议设「仅创建者可读写」，客户端只走上述业务云函数。

索引细节见 `gsyg_initDb/README.md`。

## 手机号授权（`gsyg_getPhoneNumber`）

登录页按钮 `open-type="getPhoneNumber"` 回调返回手机号 `code`，客户端 `api.getPhoneNumber(code)` 调本云函数，云端用 `cloud.openapi.phonenumber.getPhoneNumber({ code })` 换取真实手机号。

本函数两用：
- **换号**：传 `{ code }`（getPhoneNumber 返回的手机号 code）→ `cloud.openapi.phonenumber.getPhoneNumber` 换真实手机号。
- **探测权限**：传 `{ probe:true }`（无真实 code，用占位 code 强制走到 openapi）→ 返回 `noPermission`（据 `-604101 function has no permission` 判定）。客户端 `api.checkPhonePermission()` 用它决定登录门槛，**不加人工开关**。

**登录页手机号授权按钮常驻**（单个 `open-type="getPhoneNumber"`，`miniprogram/pages/login/login.js`）：
- **授权成功** → 换号：有权限存真实号；无权限(`-604101`)/失败则空号，已授权仍放行。
- **拒绝授权** → 据探测结果决定：**有权限 → 强制授权(停留登录页)**；**无权限/云不可用 → 免授权放行**。探测即 `checkPhonePermission()` 调本函数 `{probe:true}`。

**前置约束**：新版 `getPhoneNumber` 走 `code → cloud.openapi` 换号，需小程序**主体具备「手机号快速验证/实时验证组件」权限与额度**（**个人主体不支持**，企业/政府/其他组织主体在 mp 后台开通）。未开通时返回 `-604101`——探测据此走免授权登录。**在 mp 后台开通该组件后，探测自动转为强制授权，无需改任何代码**。

手机号（有权限时拿到）存本地，`profile` 保存时随 `gsyg_reportTeacher` 一并上报。所有非登录页在 onShow/onLoad 用 `store.requireLogin()` 守卫，未登录即 `reLaunch` 登录页。

## 网页微信扫码登录网关（`gsyg_webGateway`）

网页端部署 `gsyg_webGateway` 为 **HTTP 云函数**。网页通过 CloudBase Web SDK 发起微信开放平台扫码登录；网关向 CloudBase 校验短期 access token 后签发 HttpOnly Cookie，并白名单转发 profile/session/确定性三题遴选/AI 访谈。业务请求不接受客户端提交的 `openid`、`uid` 或 access token。

部署前，网关和 `gsyg_reportTeacher`、`gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_selectFinal` 须配置相同的 `GSYG_WEB_GATEWAY_TOKEN`；网关还必须配置独立 `GSYG_WEB_SESSION_SECRET`、`WEB_CLOUDBASE_ENV_ID`、精确网页域名 `WEB_ALLOWED_ORIGIN` 及 HTTPS Cookie 参数。函数监听 9000，HTTP 访问路径建议为 `/gsyg-web`。完整控制台设置、首次账号绑定和验证步骤见 `gsyg_webGateway/README.md`。

