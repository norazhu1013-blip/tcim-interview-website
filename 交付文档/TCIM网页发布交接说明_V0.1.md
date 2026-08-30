# TCIM 网页发布交接说明 V0.1

> 适用版本：Dialogue Agent 主导＋新五表 V0.2.1＋Evidence State＋r6 对话节律。
> 本说明面向研究负责人和负责腾讯云/GitHub发布的程序员。

## 一、这次交付的目标

把已经在本机验证通过的比较版发布为可通过互联网访问的研究网页，并保持以下功能不变：

1. 先完成10题测评，再由确定性程序遴选3个访谈情境；
2. Dialogue Agent 主导访谈方向，新五表提供专业地图，Evidence State保存可追溯证据；
3. 每个情境限时10分钟，并保留整体问题与收尾时间；
4. 每个情境以2次具体肯定为目标、最多2次；挑战问题不得连续出现；
5. AI提供的观点不得回写为教师原有能力；RO3/RO4继续与自主证据隔离；
6. 对话、Evidence和报告来源可追溯，评分和筛题仍不由AI决定。

## 二、研究负责人只需要做什么

1. 把本交付压缩包完整发送给程序员，不要拆开只发其中某个文件夹。
2. 同时发送交付包内提供的微信说明文字，要求程序员先阅读本文件。
3. 不要通过微信发送Kimi、OpenAI、腾讯云或GitHub密码，也不要把本机的`.env`文件另行发送。
4. Kimi/OpenAI密钥由程序员在腾讯云后台的“环境变量/密钥”中配置；如需授权，由研究负责人自行登录控制台或使用腾讯云成员权限，不发送个人密码。
5. 程序员发布后，应返回：正式网址、前后端版本号、健康检查结果、一次完整测试记录和回滚版本。

### 2.1 版本控制权

- 后续功能、提示词、五表和访谈策略的升级统一在研究负责人持有的主版本中完成。
- 程序员负责部署冻结版本、修复明确的部署故障和回传运行反馈，不得在云端直接改提示词、五表内容或核心判断逻辑。
- 如线上必须紧急修复，程序员应先建立独立修复分支，说明问题和改动，经研究负责人确认后形成新的发布号；不得静默覆盖原版本。
- 每次发布都必须可回滚，并保留上一版的代码、静态文件和数据兼容能力。

### 2.2 四层版本号

以下四层必须分别记录，不能只说“最新版”：

1. **网页发布号**：本版为`TCIM-WEB-2026.08.30-R6.1`，代表一次可部署、可回滚的整体版本。
2. **专业数据版本**：新五表`V0.2.1`及其`configFingerprint`，用于确认当时依据哪套专业地图。
3. **对话提示版本**：`tcim-dialogue-v3-low-latency-2026-08-30-r6-two-warmth-pressure-rhythm`，用于确认当时的问话策略。
4. **模型版本**：provider/model，例如`kimi/kimi-k3`；模型服务商升级别名或后台切换时也必须留下时间和记录。

Git提交号、构建时间、接口/会话/Evidence schema作为工程复现信息一并保存。

## 三、为什么不能直接上传当前网页文件

当前版本是为了本机安全测试设计的：

- 网页比较模式把Dialogue Agent地址写为`http://127.0.0.1:8787`；
- `local-dialogue-server/server.js`只允许监听本机回环地址；
- 模型密钥设置接口只允许本机网页调用；
- 对话数据默认写入本机`.runtime-data/state.json`。

这些限制保护了API密钥和教师资料，但也意味着把当前`web/dist`直接上传后，其他教师的浏览器会尝试访问“教师自己电脑上的8787端口”，访谈无法运行。正确做法是保留Dialogue Agent核心代码，把本机通信和存储外壳替换为腾讯云HTTPS网关、云端密钥和云数据库。

## 四、程序员必须完成的发布改造

### 4.1 后台

1. 将`local-dialogue-server/src/`中的Dialogue Agent、提示词、输出校验、Evidence分析和Kimi/OpenAI provider迁入腾讯云函数、云托管服务或现有`gsyg_webGateway`后的受保护服务。
2. 云端固定使用研究指定模型；生产网页不显示API密钥输入框，也不开放`/v1/model-config`。
3. 密钥只放在腾讯云环境变量/密钥管理中，不写入代码、网页构建文件、日志或数据库。
4. 对外只暴露业务所需接口，例如首问、后续追问、后台Evidence分析和只读健康检查；接口必须经过已有正式账号会话或同等级鉴权。
5. 设置精确CORS来源，只允许正式网页域名；保留请求体大小、超时、并发、频率限制和内容安全检查。
6. 将本机JSON文件存储替换为现有CloudBase会话、访谈和Evidence数据链；继续使用sessionId、itemId、revision、payloadHash和幂等/旧版本拒绝机制。
7. 保留模型锁：同一次测评的三个访谈不得静默切换provider/model。

> 禁止做法：为了能联网，直接删除回环限制后把Node端口暴露到公网。必须通过HTTPS网关、鉴权、精确CORS和服务端密钥进行封装。

### 4.2 网页

1. 以本交付包源码为准，不使用旧线上分支覆盖新版Dialogue Agent文件。
2. 生产构建时设置：
   - `VITE_LOCAL_RESEARCH_MODE=0`
   - `VITE_WEB_API_BASE_URL=<现有正式网关HTTPS地址>`
   - `VITE_DIALOGUE_AGENT_API_BASE_URL=<新版Dialogue Agent HTTPS地址>`
   - `VITE_CLOUDBASE_ENV_ID=cloud1-2gefzeri3cb333f2`
   - `VITE_CLOUDBASE_REGION=ap-shanghai`
   - `VITE_TCIM_COMPARISON_ARCHITECTURE=dialogue_agent_new_five_tables_evidence_state`
3. 公网版隐藏本机模型选择/API密钥配置界面，由后台配置固定模型；研究需要比较模型时，应使用受控实验配置，不让普通教师输入密钥。
4. 重新执行完整校验和生产构建；不得把`.env.comparison`中的127.0.0.1地址编进正式包。
5. 静态文件上传腾讯云后，检查所有资源、路由刷新、登录Cookie、网关请求和Dialogue Agent请求均为HTTPS。

## 五、腾讯云后台变量清单

以下变量只填写在腾讯云后台，不通过微信传值：

- `TCIM_DIALOGUE_PROVIDER=kimi`
- `KIMI_API_KEY=<腾讯云密钥配置>`
- `KIMI_BASE_URL=https://api.moonshot.cn/v1`
- `KIMI_MODEL=kimi-k3`
- `TCIM_DIALOGUE_TIMEOUT_MS=45000`
- `TCIM_DIALOGUE_MAX_BODY_BYTES=1048576`
- `TCIM_DIALOGUE_MAX_HISTORY_TURNS=8`
- `TCIM_DIALOGUE_FAST_REASONING_EFFORT=low`
- `TCIM_DIALOGUE_FAST_MAX_OUTPUT_TOKENS=500`
- `TCIM_EVIDENCE_REASONING_EFFORT=medium`
- `TCIM_EVIDENCE_MAX_OUTPUT_TOKENS=1600`
- `WEB_ALLOWED_ORIGIN=<正式网页精确HTTPS来源>`
- 现有网关会话、网关令牌和CloudBase环境变量继续沿用正式环境配置。

不得在云端设置`TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS=1`。

## 六、发布前门禁

1. 后端测试：`local-dialogue-server`测试必须全部通过，当前基线为53/53。
2. 网页测试：`web`的`pnpm run verify`必须通过，包括240个题目×排列对拍、新五表负向夹具、计时、Dialogue Agent领域层和报告测试。
3. 生产构建成功，构建产物中不存在127.0.0.1、localhost、API密钥或`.runtime-data`内容。
4. 后台`/health`返回Kimi、`kimi-k3`、ready=true，以及提示版本`tcim-dialogue-v3-low-latency-2026-08-30-r6-two-warmth-pressure-rhythm`。
5. 发布采用新版本目录或可原子切换的静态托管版本，不覆盖唯一可回滚副本。

## 七、发布后必须完成的验收

使用一个新的研究测试账号，从头完成一次：

1. 注册/登录和教师资料保存；
2. 10题作答、提交、评分和3题遴选；
3. 三个AI访谈完整完成；
4. 检查每题计时、两分钟前后整体问题、收尾和超时保护；
5. 检查每题具体肯定不超过2次，挑战问题不连续；
6. 检查没有重复提问、没有每轮固定复述、没有暴露标准答案或内部Evidence ID；
7. 刷新、退出再登录，确认对话和Evidence仍能回看；
8. 确认报告只引用Canonical Evidence，RO3/RO4不进入“教师原有能力”；
9. 检查浏览器开发者工具中所有请求均为HTTPS，没有127.0.0.1请求；
10. 记录每轮耗时、HTTP错误和后台日志，请研究负责人试用确认后再扩大访问范围。

### 7.1 反馈必须绑定版本

每次新测评创建时冻结`releaseSnapshot`，至少包含：网页发布号、Git提交、构建时间、新五表版本/指纹、Dialogue Agent提示版本、会话/Evidence schema。每次访谈调用另保存实际provider/model/promptVersion；不能只依赖网页预计版本。

教师填写的三项访谈反馈、研究者人工评价、失败日志和耗时记录，必须带`sessionId + itemId + releaseSnapshot + 实际模型trace`。旧记录不得在升级后改写成新版本。以后汇总“自然度、温度、压力、重复率、延时、Evidence有效性”时，必须按网页发布号和模型分组，不能把不同版本混在一起平均。

程序员应提供按版本导出反馈的能力，或至少保证现有数据导出包含上述版本字段。导出交给研究负责人后，后续优化仍在研究主版本中完成，再形成下一个冻结发布包。

## 八、发布完成的返回材料

程序员应向研究负责人返回：

- 正式测试网址；
- Git分支、提交号和构建时间；
- 前端静态版本、Dialogue Agent提示版本和新五表指纹；
- 后端健康检查截图或文本；
- 一次端到端验收记录；
- 已知问题；
- 回滚地址/回滚提交和操作方法。

## 九、回滚条件

出现以下任一情况，应先停止扩大试用并回滚：

- 网页仍请求127.0.0.1；
- API密钥出现在网页、网络请求或日志；
- 教师之间出现会话/资料串号；
- 同一测评静默切换模型；
- 访谈无法保存、重复覆盖或历史回看丢失；
- 计分、筛题或标准答案边界被破坏；
- 连续大面积超时、中断或安全检查失败。

回滚只切换前端静态版本和Dialogue Agent服务版本，不删除教师原始记录。数据库结构变更必须向后兼容或先备份。

## 十、本次功能基线

- 功能提交：`1e5dca9 feat: balance interview warmth and challenge pacing`
- 分支：`codex/dialogue-agent-comparison`
- 新五表：V0.2.1
- 新五表指纹：`d8eebef72dad95f81045250e6a17c6bfdc78fc6441211e425e3ac9e0e2d7ef07`
- Dialogue Agent提示版本：`tcim-dialogue-v3-low-latency-2026-08-30-r6-two-warmth-pressure-rhythm`

最终交付包的精确源码提交和文件校验值，以包内`RELEASE_MANIFEST.json`和`SHA256SUMS.txt`为准。
