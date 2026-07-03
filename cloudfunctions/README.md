# 云函数目录（`gsyg_` 前缀）

| 云函数 | 触发方 | 集合 | 作用 |
|---|---|---|---|
| `gsyg_initDb` | 管理端一次性 | 三个集合 | 幂等建集合 + 建唯一/复合索引 |
| `gsyg_reportTeacher` | 客户端保存 profile | `gsyg_teachers` | 按 `openid` upsert |
| `gsyg_reportSession` | 客户端提交答题 | `gsyg_sessions` | 按 `sessionId` upsert |
| `gsyg_reportInterview` | 客户端提交访谈 | `gsyg_interviews` | 按 `sessionId` upsert |
| `gsyg_interviewChat` | 访谈对话每轮 | —— | LLM 动态追问，失败回退规则版 |

## 部署新环境的一次性流程

1. 微信开发者工具打开仓库根，云开发环境已选好。
2. 右键各云函数 → 上传并部署（云端安装依赖）。
3. 打开 `gsyg_initDb` → 云端测试 → event 空 `{}` → 触发，返回的 `collections/indexes` 都 ok 即完成。
4. 集合权限建议设「仅创建者可读写」，客户端只走上述 5 个业务云函数。

索引细节见 `gsyg_initDb/README.md`。
