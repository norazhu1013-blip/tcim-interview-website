# gsyg_initDb —— 数据库一次性初始化

新环境或换环境后调一次即可（幂等，重复调用安全）。

## 做了什么

1. 幂等 `db.createCollection` 创建三个集合：
   - `gsyg_teachers` —— 教师信息（按 `openid` upsert）
   - `gsyg_sessions` —— 每次答题（按 `sessionId` upsert）
   - `gsyg_interviews` —— 每次访谈（按 `sessionId` upsert）
2. 按查询语义建立索引（需要配置腾讯云 CAM 密钥）。

## 索引方案

| 集合 | 索引名 | 键 | 唯一 | 服务的查询 |
|---|---|---|---|---|
| `gsyg_teachers` | `uniq_openid` | `openid: 1` | ✅ | `where({openid}).limit(1)` upsert |
| `gsyg_teachers` | `idx_updatedAt` | `updatedAt: -1` | | 管理端按更新时间倒排 |
| `gsyg_sessions` | `uniq_sessionId` | `sessionId: 1` | ✅ | `where({sessionId}).limit(1)` upsert |
| `gsyg_sessions` | `idx_openid_createdAt` | `openid: 1, createdAt: -1` | | 用户历史列表（首页记录卡） |
| `gsyg_sessions` | `idx_submitStatus` | `submitStatus: 1` | | 分状态汇总/筛选 |
| `gsyg_interviews` | `uniq_sessionId` | `sessionId: 1` | ✅ | `where({sessionId}).limit(1)` upsert |
| `gsyg_interviews` | `idx_openid` | `openid: 1` | | 按用户聚合访谈 |

三个业务主键均为**唯一索引**，防重复写入是硬约束（否则 upsert 里的 `where` + `add` 竞态会出现同键多行）。

## 部署与调用

1. 微信开发者工具「云开发 → 云函数」中右键 `gsyg_initDb` → 「上传并部署（云端安装依赖）」。
2. 在 `gsyg_initDb` 云函数「配置 → 环境变量」中添加：
   - `TCB_SECRET_ID`
   - `TCB_SECRET_KEY`
   - `TCB_ENV`（例如 `cloud1-2gefzeri3cb333f2`）
3. 打开该云函数 → 「云端测试」→ event 直接 `{}` 或 `{ "action": "all" }` → 触发。
   - 仅建集合：`{ "action": "collections" }`
   - 仅建索引：`{ "action": "indexes" }`
4. 返回值中 `collections` 列出集合状态（created/exists），`indexes` 列出每条索引是否建立。
5. 未配置密钥时，集合仍会创建成功，索引步骤会跳过并返回 `plan` 供手工新增。

## 注意

- 集合创建使用 `DYNAMIC_CURRENT_ENV`；索引创建通过 `@cloudbase/manager-node` 使用 `TCB_ENV` 指定目标环境。
- 集合权限建议在控制台设为「仅创建者可读写」或「仅管理端可读写」，客户端通过 4 个业务云函数间接访问。
