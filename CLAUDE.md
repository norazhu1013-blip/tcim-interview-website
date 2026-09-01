# 项目指令 · 幼儿园教师「游戏支持与引导能力」AI 测评小程序

> 本文件供所有 AI agent(Claude Code / Codex 等)在处理本项目前**必读并遵守**。
> 权威设计见 `设计文档.md`(v2.0),交互原型见 `prototype.html`,数据导入格式见 `数据导入规范.md`,原始数据在 `DOC/`。

---

## 1. 产品是什么

面向幼儿园教师的专业能力测评工具。流程:**10题情境判断测验(排序作答)→ 结果+过程数据分析 → R/P/G 遴选3道访谈题 → AI一对一证据访谈 → 综合能力画像报告**。

### 双平台架构(重要,勿当成单一小程序)
- **幼研智库 · 测验平台**:教师完成 10 题测验,**限时 20 分钟**;试卷码 或 扫码进入;须绑定统一教师姓名。
- **幼教慧谈 · 访谈平台**:AI 一对一访谈 + 报告。工作台点「AI访谈」,完成系统生成的 **3 个情境**访谈。
- **数据同步**:测验第 10 分钟起**每 30 秒**轮询同步接口,按试卷码/批次拉取作答状态+结果+日志,覆盖/增量更新;仅当状态=`已提交`或`超时自动提交`才进入访谈优选。

---

## 2. 全系统红线(任何实现都不得违反)

1. **计分与筛题是确定性程序,AI 不参与打分。** 分数只来自赋分表查表 + 算术。
2. **AI 访谈不暴露**专家排序 / 得分 / 标准答案,只围绕教师真实排序追问;不诱导预设答案。
3. **最终 3 题 ≠ 最低分题**,而是最能解释判断机制的题;主二级指标尽量不同质(8题主指标为C,别选3道全C)。
4. **报告每条判断必须可回溯**到具体题目 / 过程标签 / 访谈原话,禁空泛评价。
5. **过程数据波动 ≠ 能力弱**,只作访谈线索。
6. **禁用旧「五维能力」**,统一用下方 3 二级 / 7 三级指标规范名。

---

## 3. 指标体系(统一命名,不得改写)

- **A 对游戏的特点、价值的理解**:A1 对游戏特点的理解 / A2 对游戏价值的理解(游戏中的学习)/ A3 对游戏价值实现的认识
- **B 游戏条件的保障**:B1 游戏环境创设 / B2 教师在幼儿游戏中的角色
- **C 游戏支持与指导**:C1 游戏中的观察 / C2 对游戏行为的分析与回应

每个三级指标含:观测点、发展脉络(4级递进)、理想水平锚点。

### 10题主/次指标映射
Q1篮球架玩水 C2/A1 · Q2频繁求助 C2/C1 · Q3区域停留短 C1/C2 · Q4未参与建构 C2/B2 · Q5价值不符 A1/A3 · Q6材料无层次 B1/C2 · Q7艾莎不运动 C2/A2 · Q8引水难题 C2/B1 · Q9飞行棋 C2/C1 · Q10跳绳混乱 C2/B2。

---

## 4. 打分机制 = 确定性查表

`DOC/AI 测评 访谈及报告流程/000 10题赋分.xlsx`:**24 行(4做法全排列 4!=24)× 10 列(Q1-Q10)**,格子 = 该排列在该题的得分(专家预定 0-4)。
打分逻辑:`教师拖拽顺序 → perm_id → 查该题列 → 0-4 分`。派生总分/均分/常模位/RD偏离,均为算术。
⚠️ **唯一待研究团队确认**:24 行分别对应哪种排列顺序(建议导入模板显式加 `order` 列锁定)。

---

## 5. 过程数据(8 项,前端埋点)

总作答时长 / 首位修改轨迹 / 末位修改轨迹 / 修改次数 / 关键停顿点 / 首反应选项 / 排序路径振荡 / 极快作答,合成 **P-IVI** 综合指数。**必须保存修改路径(`move_log`),而非只存最终答案。**

### 过程指标计算口径(已定,demo.html 已实现,勿退回简化版)
- **必须回放 `move_log`**:从 `first_ranking` 起,逐步"移除该选项→插入到 `to_pos`"(为对埋点误差鲁棒,忽略 `from_pos`,只用 option+to_pos),重建每一步完整排序。回放终态应等于 `final_ranking`(可作校验)。
- **首位摇摆**:取各步首位序列,数变更次数 —— 变更≥1=摇摆,≥2=**强摇摆**(强访谈线索),并输出路径如 `D→A→C`。**不可**用"首≠尾"简化(会漏掉 D→A→D 这类变回原样的摇摆)。
- **末位摇摆**:同上,取各步末位序列。
- **路径振荡**:任一选项的位次序列出现**方向反转**(先上后下 / 先下后上)即判定 —— 表示在两取向间反复换位。
- 评分不依赖以上任何过程指标;它们只用于 P分筛选、访谈触发的过程增强条件、限时控制。详见 `设计文档.md` 5.1/5.2。

---

## 6. 题目知识库 = AI 访谈资料包(每题 13 表)

`DOC/10个题目的知识库/*.xlsx`,10 份,每份 13 个工作表,结构一致,是访谈与报告的专业背景本体:

`01基本信息 02情境结构 03测评意图 04专业路径与实证校准 05选项解释 06能力证据点E1-E7 07常见偏误P1-P7 08访谈触发规则T1-T7 09AI追问脚本Q1-Q7+Q-stop 10评分锚点(高/中高/中/偏低/证据不足) 11个性化支持建议(7类) 12过程性数据 13实证校准说明(三层关系:赋分定位/指标解释/访谈确认)`

访谈运作:教师排序+过程标签 → 命中 **T触发规则** → 调用 **Q追问脚本** → 采集 **E证据点** → **评分锚点**编码 → **支持建议**。

### ⚠️ 解析注意
这 10 份 xlsx 用 `x:` 命名空间前缀 + 内联 `t="str"` 存 `<x:v>`,**不是标准 sharedStrings**。解析必须匹配 `<x:row>` / `<x:v>`,否则读出 0 行(曾误判为文件损坏)。docx 正常解析。

---

## 7. AI 访谈交互规则(硬约束)

- 点情境 →「开始访谈」;AI **先呈现完整案例(不用插图)+ 四个选项 + 该教师的排序**,不再要求教师先填"最有效做法"。
- **单情境限时 10 分钟**(非三题总计时)。AI 生成问题前**剩余 ≥1 分钟**才生成新问;**<1 分钟**不再生成但保存记录。
- 教师正在回答时超 10 分钟**不强制中断**,等提交;提交后标记「已完成」。超时未提交提示:「本情境访谈时间已到,请尽快提交当前回答」。
- 每轮**只问一个问题**;先接住回答,再围绕缺失证据追问;后台维护证据账本。**AI 对话为纯文字输入(不做语音)**。
- 情境选择界面:**已访谈**左上角红勾,按键为「退出案例/回看访谈」,默认不可重访只可回看(回看=题干+四选项+本人原排序+每轮问答+提交时间);**未访谈**可开始。
- 三题全完成:弹窗「访谈完成,感谢!」(可关闭/回首页)。
- **信息架构(已定)**:**底部 2 个 Tab:答题 / 我的**。「答题」Tab=首页(开始测评 CTA + 历次答题记录列表,首页与记录合并);「我的」Tab=个人信息页(profile:姓名/园所/班级/教龄/试卷码,可随时查看修改,保存后更新后端 profile)。答题/评分/筛选/访谈/回看均为带返回的子页。访谈**从属于具体答题记录**(每次测评生成该次专属的 3 题访谈),入口=记录卡的「去访谈/回看」,**不设独立"访谈" Tab**。每条记录卡有「看答题 / 看评分 / 去访谈(或回看)」三入口。评分是某条记录的结果页。理由:多条记录时全局访谈入口无法表达"这是哪次访谈"。

---

## 8. 报告生成

三源融合(测验定位 / 过程解释 / 访谈确认;一致增强、不一致解释)→ 二级指标画像 → 七个三级指标展开 → 证据回填 → 学习建议(对齐指标编码,源自各题「11支持建议」)→ 非评判审核 → 导出 DOC/PDF。可呈现分数/维度/证据,**不暴露**标准排序/专家答案/评分规则。

---

## 9. 技术与合规要点

- 前端:微信小程序原生/Taro;拖拽排序 `movable-view`;图表 ec-canvas。
- LLM **不能在小程序直连**,必须经自有已备案后端;打分/筛题为独立确定性服务。
- **AI 对话纯文字输入,不做语音**(已移除语音按钮/`scope.record`)。报告 PDF/DOC **服务端生成**。
- 合规硬门槛:①教育类目资质+ICP备案+企业主体;②UGC与AI生成内容均过 `msgSecCheck`/`mediaCheckAsync`,AI问答需人工审核+可追溯;③隐私指引。

---

## 10. 表格录入 = ETL 导入 + 版本管理

标准模板.xlsx → 导入脚本(格式校验 / 一致性校验 / 排列口径转换)→ 数据库(带 `version`,旧版保留)→ 后端按 version 读取。
一致性校验:分值0-4;24排列不重不漏;题号在题库/赋分/映射/知识库**四处一致**。教师作答绑定当时 version 以保证历史可复现。

---

## 11. 工作约定

- **重要的事一律写入本文件 `CLAUDE.md`**(用户明确要求)。包括:关键决策、需求变更、口径确认结果、踩过的坑、约定。不要只在对话里说、也不要写进 memory —— 以本文件为唯一长期事实源,便于后续任何 agent 接手即遵守。
- **每次代码修改完毕即 commit**(用户 2026-07-08 要求),不积压。
- **commit 后即 push**(用户 2026-07-09 要求)。commit 完成后同一轮对话内 `git push`,不积压。全局规则,详见 Shinku `Skills/git-workflow-principles/SKILL.md § 提交后即 push`。
- 修改设计相关内容时,**同步更新** `设计文档.md` 与 `prototype.html`,保持一致。
- 涉及指标名称、赋分、访谈规则时,以 `DOC/` 原始文件为准,勿凭记忆改写。
- 产出面向教师的文案须**专业但通俗、非评判**。

---

## 12. 项目产出物索引

| 文件 | 内容 |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | agent 指令(本文件 / 指向本文件) |
| `设计文档.md` | 权威设计规范 v2.0 |
| `prototype.html` | 交互原型(**简版**:聚焦四大功能 答题/记录/评分/访谈,底部4 Tab,单主色扁平) |
| `数据导入规范.md` | 5 类导入文件的 JSON 格式 + 校验规则 |
| `DOC/` | 原始数据源(题库/赋分/映射/10题知识库13表/流程手册) |
| `docs/tcim/` | TCIM 文档索引 + 权威参考(V0.1/V0.2 研究团队 docx 可读归档)+ V0.2 迁移/部署手册。**入口 `docs/tcim/README.md`**(索引+来源说明);`V0.2_SECOND_BATCH_REFERENCE.txt`(第二批 V0.2: PRDM A06/A07、RAG KnowledgeNeedProposal、开发手册、总说明);`Q8_AI_EXAMPLE_REFERENCE.txt`(八题示例);`V0.2_MIGRATION_AND_DEPLOYMENT.md`(迁移+部署);`DEPLOYMENT_RUNBOOK.md`(操作者执行清单) |
| `demo/` | 可查看可运行样例(见下) |

### demo/ 目录(数据格式 + 全流程可运行演示)
- `demo.html` —— **双击打开即可运行**;演示三步:① 自动评分(查表)② 自动筛选3题(R/P/G,过程指标由 6_process_log 真实派生)③ 模拟AI访谈(触发T→脚本Q→证据E→锚点编码)。内置数据与下列 json 一致。
- `1_questions.demo.json` 题库(Q1/Q5/Q6)
- `2_score_table.demo.json` 赋分(3题×24排列;**分数为示例合成,上线须换 DOC 真实值并锁定 order 口径**)
- `3_indicator_map.demo.json` 指标映射
- `4_selection_rules.demo.json` R/P/G 阈值与覆盖规则
- `5_knowledge_base.demo.json` 知识库(第1题按真实13表完整;Q5/Q6为骨架)
- `6_process_log.sample.json` 前端过程埋点上报样例(含 move_log/时长/停顿,对应设计文档 5.2)

### 待办 / 未决(接手前先看)
- ⚠️ **赋分表 24 行 ↔ 排列顺序口径**:需与研究团队确认;确认后更新 `数据导入规范.md` 与 demo 的 `2_score_table`。
- 未做:Excel→JSON 正式导入脚本;10题知识库全部结构化;AI访谈系统提示词模板。

---

## 13. 小程序实现说明(`miniprogram/`)

原生微信小程序(无框架/无 npm 依赖),严格对照 `prototype.html` P0–P9。详见 `miniprogram/README.md`。关键实现决策:

- **信息架构**:**底部 2 Tab(app.json tabBar)——「答题」=home(首页含记录,默认选中)/「我的」=profile(个人信息,可随时查看修改,保存调 gsyg_reportTeacher)**;color/selectedColor=#a6abb5/#3f63d6,纯文字无图标。login 不在 tabBar,登录后 switchTab 到 home(无 profile 则先 switchTab 到 profile 完善)。其余 exam/submit/score/select/review/interviewList/interview/done 为 navigateTo 子页;返回 home 一律 switchTab。访谈从属于具体答题记录。共 11 页。
- **登录:手机号授权按钮常驻(功能一直在),`-604101` 无权限只降级不挡登录。** 登录判断统一 `isLoggedIn`=`!!login_state.phoneAuthed`。**登录守卫从"页面级硬跳"改为"动作级弹窗触发":** 允许所有页面(含 home/profile/exam/submit/score/review/interviewList/done)未登录也能进入浏览;仅在**具体动作**触发时弹窗要求登录:home 的开始答题/继续答题、exam 的手动提交(超时自动提交不弹)、profile 的保存、interview 的 onLoad(首次进入立刻拉 LLM,必须先登录,不登录弹窗后 navigateBack)。使用统一 `store.requireLoginWithPrompt(hint)`:已登录返回 true,否则 `wx.showModal` 「去登录/取消」,确认后 `reLaunch` 到 login。老的 `requireLogin()`(硬 reLaunch,不弹)保留但已无引用点。
  - login **单个** `open-type="getPhoneNumber"` 按钮(文案「微信登录」),`bindgetphonenumber=onGetPhone`。**不再按权限隐藏按钮**(曾因隐藏导致"授权功能消失",已废弃)。
  - **授权成功**(errMsg=`getPhoneNumber:ok` 且有 code):`wx.login` 存 code → `api.getPhoneNumber(code)` 换号 → `saveLogin({phone,openId})` 放行。**有权限存真实号;无权限(`-604101 function has no permission`)/换号失败则 phone 留空,已授权仍放行**。
  - **拒绝授权**:据探测的主体权限决定——`onLoad` 后台 `api.checkPhonePermission()`(云函数 `gsyg_getPhoneNumber` 传 `{probe:true}`,占位 code 触发 `cloud.openapi` 权限前置校验,据 `-604101` 判 `noPermission`)存 `this._hasPermission`。**有权限 → toast 停留(强制授权);无权限 → `saveLogin({phone:''})` 放行(免授权)**。探测未回则即时再探一次。
  - 手机号(有权限时拿到)**存本地**,不在登录时单独上报,而是 `profile.onSave` 并入 `store.getPhone()`(登录态.phone‖profile.phone)随 `gsyg_reportTeacher` **一并提交**。`api.getPhoneNumber(code)`/`checkPhonePermission()` **不进 pendingReports**。mp 后台开通手机号组件后,换号自动成功存真实号、拒绝分支自动转强制,**无需改代码**。
- **存储**:除 3 个后端上报接口外全部本地(`wx.setStorageSync`,`utils/store.js`);每次答题前端生成 UUID 作 sessionId(记录主键),可多次答题。
- **后端 = 微信云开发 CloudBase「云函数 + 云数据库」**,客户端**不直连 DB**,统一前缀 `gsyg_`(与知识库 GSYG_ 一致,集中于 `utils/config.js` 的 `PREFIX`)。`utils/api.js` 用 `wx.cloud.callFunction` 调 3 个云函数 → 云函数(wx-server-sdk 拿 openid)读写集合:`gsyg_reportTeacher`→`gsyg_teachers`(按 openid upsert) / `gsyg_reportSession`→`gsyg_sessions`(按 sessionId upsert:answers+scores+total+selection+时间字段) / `gsyg_reportInterview`→`gsyg_interviews`(按 sessionId upsert:transcripts)。云函数代码在**仓库根** `cloudfunctions/gsyg_*/`(开发者工具在**仓库根**打开;根 `project.config.json` 为唯一权威:`miniprogramRoot=miniprogram/`、`cloudfunctionRoot=cloudfunctions/`、appid=wxb3835ca53ec166c8;`miniprogram/` 下不再放 project.config.json)。**本地优先**:先写本地再异步 callFunction,失败入 `pendingReports`(`app.onShow` 自动 flush)、不阻塞;wx.cloud 不可用时降级只存本地。部署步骤(右键上传云函数+建集合+权限设"仅管理端")见 `miniprogram/README.md`「云开发部署」。
- **算法移植自 `demo.html`**:评分=查表(`utils/scoring.js`);过程指标必回放 move_log(`utils/process.js`,首末位摇摆按各步序列变更次数、路径振荡=方向反转,勿用"首≠尾"简化);R/P/G 筛选=`selectThree`(合并去重+覆盖校验)。已用 demo Q1 埋点验证与 demo.html 一致。
- **访谈**(`utils/interview.js`):LLM 首选 + 规则版兜底。命中触发规则(T)→脚本序列(Q)逐轮一问→证据账本(E)→锚点编码;不暴露专家排序/得分/标准答案;单情境限时 10 分钟、剩余<1 分钟不再生成新问但保存;已完成只可回看。真实 LLM 动态追问经云函数 `gsyg_interviewChat`(`llmNextQuestion` 调用);**LLM 未配置/失败/超时自动回退规则版脚本序列**,离线也能走完。
- **`gsyg_interviewChat` 已接入微信云开发 AI(CloudBase AI / wxai)**,链路已跑通。踩坑一次全记清,免得下次接手又猜:
  - 云函数**必须 Nodejs18.15+ 运行时**(创建时锁定,不能就地改;要升老函数只能删了重建;`wx-server-sdk` 也要 ≥ 4.x 才能 `require('wx-server-sdk').ai`)。
  - `cloud.ai` 是**工厂函数**,先 `cloud.ai()` 拿实例,再 `ai.createModel(provider)` 拿 model 客户端。`createModel` 的参数是 **provider**(默认 `cloudbase`),**不是** model_id。
  - `model.generateText / streamText` 请求参数**同时放顶层和 data 内**:`{model, messages, data:{model, messages}}`。SDK 从顶层读,`data` 层保留兼容。
  - 环境变量集中在云函数配置里,不进代码:`WXAI_MODEL`(默认 `hy3-preview`) / `WXAI_PROVIDER`(默认 `cloudbase`) / `LLM_TIMEOUT_MS`(默认 12000) / `SEC_CHECK=1` 开 `openapi.security.msgSecCheck` v2 scene:4 机审(合规硬门槛③,上线必开)。
  - **evidenceHint 由 LLM 判定,已修复"问过即算"**:system prompt 强制严格 JSON `{"next_question","done","covered_evidence":["E1","E3"]}`,基于教师**上一轮原话**判定覆盖了哪些 E,客户端 `interview.js` 落账本。规则版只在 LLM 失败时兜底(彼时才回落"问过即算",可接受)。
  - 边界不变:knowledge.js 定专业内容/脚本边界,AI 只负责对话中的理解/追问/证据确认/表达组织,**评分与筛题仍为确定性程序、AI 不参与**。
- **评分用 DOC 真实赋分表**:`data/scoreTable.js` 由 `tools/build_scoreTable.js` 从《000 10题赋分.xlsx》一次性生成(全 10 题×24 排列)。排列顺序口径来自 xlsx 首列「选项组合」(ABCD…DCBA 字典序)显式给出、非假设;已用知识库 04 表方向自检通过。仅「该列语义=排序」待研究团队最终核对,若不符改 `permToKey` 一处重生成。
- **时间埋点**:每题 duration + 整卷 examStartTs/examSubmitTs/totalExamMs 均本地存 + 随 sessions 上报(items[].durationMs/totalDurationMs);时间用于 P-IVI/筛选,评分不依赖时间。
- **全 10 题真实数据**:questions/scoreTable/indicatorMap/knowledge 四处均为 Q1–Q10 DOC 真实数据、题号一致(已校验);答题走 10 题、R/P/G 10 选 3。
  - questions/indicatorMap/scoreTable 由 `tools/build_questions.js`/`build_indicatorMap.js`/`build_scoreTable.js` 从 DOC 生成。
  - **knowledge.js 由 `tools/build_knowledge.js` 生成(全 10 题富结构,已完成——非骨架)**:每题含 core_orientation、empirical_note、paths(4-5)、evidence_points E1-E7、biases P1-P7、triggers T(7-8:result_cond+process_cond+target+scripts+priority/prio)、scripts Q1-Q7+Q-stop(09 表真实措辞,字段 q/E/stage/goal/next)、anchors 5 档、suggestions(7)。均取自各题知识库 xlsx 13 表真实内容。
  - 知识库源 xlsx 有**两套列模板**(变体A:Q1/2/4/5/6/7 = Q码脚本;变体B:Q3/8/9/10 = S码/首问内嵌),build_knowledge.js 用表头关键词通用取列兼容两套;追问脚本码统一归一到 09 表基码 Q1-Q7/Q-stop,triggers.scripts/biases 引用皆存在于本题。
  - triggers.result_cond 为文本,`interview.js` 运行时**通用正则判定**(首/末位、靠前≤2、靠后≥3、X/Y前两位),按 prio 取最高、无命中回退首条;已用流水线验证(Q1 D首→T1、A/C前二→T4;Q5/Q8/Q10 均正确出脚本)。真实 LLM 访谈由 `interview.js` 的 `llmNextQuestion` → `gsyg_interviewChat` 云函数完成(见上方 wxai 说明)。
  - ⚠️ 曾出现竞态:我(lead)一度用一份精简版 knowledge.js 覆盖了 worker 富版;已用 `tools/build_knowledge.js` 重新生成富版并验证兼容,精简版及其 build_knowledge.py 已删。**knowledge.js 以 `tools/build_knowledge.js` 为唯一生成源。**
  - 报告页(设计文档第 8 节)本期未做。
- **2026-07-08 首页/界面优化(据 DOC 两份《首页(等)+界面优化建议》整合,后者为超集)**:
  - **home**:①顶部身份区改「来自:园所」,未填园所显示「去完善」按钮(→profile);②主卡标题改「开始"游戏支持与引导"情境判断测评」+ 新副文案;③流程说明由 3 步→**2 步**(删「自动评分与情境挑选」,不给教师看):1 情境作答｜20 分钟以内、2 AI 交流｜30 分钟以内;底部小字改「请您根据自己的真实想法作答…」;④空记录文案改「暂无记录。完成测评后…」;⑤记录卡**去掉「看评分」**,只留「看答题」+「去访谈/回看」;⑥**答题/访谈互斥**:存在「已提交但访谈未全部完成」的记录时,`blockStart=true` 禁用「开始答题」(答完只能访谈,访谈完才能开新测评)。
  - **submit**:去掉「查看评分」,只留「去 AI 访谈」+「回到首页」;文案改「感谢作答!接下来请进入 AI 访谈。」(onScore 已删)。
  - **exam / interview 自绘导航栏**(`navigationStyle:custom`):左上**不放系统返回键**。原因:小程序无法隐藏系统返回箭头,只能走 custom nav。导航尺寸 JS `initNavBar()` 用 `getWindowInfo().statusBarHeight`+`getMenuButtonBoundingClientRect()` 算 navBarH/bodyTop(px),`.navbar`/`.exam-top`/`.iv-top` 改 `position:fixed`,body 用内联 `top:{{bodyTop}}px` 覆盖 wxss。右上仍是微信胶囊(不可去)。
  - **答题/访谈进行中禁止退出**(2026-07-08 追加):exam 导航栏**无任何退出按钮**(退答只能靠提交/超时自动提交离开;`onExit` 已删);interview **进行中(isReview=false)也无退出按钮**,仅**回看模式(isReview=true)**显示左上「返回」(`onExit`,confirm 后 navigateBack)。exam 内「上一题」保留(题内导航,非退出)。
  - **interviewList**:每情境下的「考察内容(interview_focus)」改为**该情境原文(题干 stem)**。
  - **interview**:①「你的排序」四选项加 `.iv-rank` 缩小字体(b 40rpx/x 23rpx)+ 收紧内外边距,凸显对话(方案甲);②时间到(remain≤0)不强制中断,教师**再答一次**后 finalize 并弹「本情境访谈已结束→返回列表」modal。
- **2026-07-08 赋分表核查 + 更新为最新(据 `DOC/calculate_advisor_rpg_final(1).py` 的 `SCORE_CSV`,最新方案)**:
  - **打分流程已验证正确**:`scoring.js` 用 `final_ranking.join('>')`(排序串,左=最理想)查 `SCORES[Qx][key]`,与 Python `SCORE_CSV` 的键语义完全一致。
  - ⚠️ **题号错位(重要)**:该 Python 程序自身的题号(其 `QUESTION_CONTENT`/`ABILITY_MAP`)与小程序题号**不同**,`SCORE_CSV` 的 01-10 列按 **Python 题号**排。必须按**情境正文/选项内容**映射,切勿按列号直接套:`mpQ1→py列1, Q2→4, Q3→6, Q4→2, Q5→5, Q6→3, Q7→9, Q8→10, Q9→7, Q10→8`(A/B/C/D 选项顺序两边逐字一致,已核对)。
  - **结果**:10 题中 9 题分数原本已与最新方案一致;仅 **Q5(消防员/阳阳)8 格**为旧值,已更新。生成/对拍脚本:`tools/build_scoreTable_from_py.py`(dry-run 打印 diff,`--write` 落盘;重跑 diff=0)。若日后 Python 方案再更新,改该脚本的 `MAP` 或重跑即可。
  - FYI(非本次范围):mp 的 R/P/G 三题**遴选**(`scoring.js selectThree`)是简化版,与 Python advisor 的 P-IVI/IIV/覆盖修正完整算法不同;但**赋分(scoring)**本身正确、已对齐最新。
- **2026-07-08 R/P/G 遴选切服务端(方案 A,完整版 advisor + 常模化)**:替代原 `scoring.js selectThree` 简化版,与 Python advisor 逐位对齐。
  - **`tools/advisor_port.js`** — Python `calculate_advisor_rpg_final.py` 的 1:1 Node.js 端口(~950 行,无外部依赖)。移植内容:过程特征(8 项含 >120s 中断剔除)/ F/M/B/O + P-IVI / R 分档 / G 4 象限 / IIV_classic+hybrid / FES 整合 + RS 备用综合 + 能力覆盖修正 / safeInterviewPrompt。**题号约定与 Python 一致**(内部 1..10 = Python 编号,与 mp 题号错位,见上表)。
  - **常模化(阶段 4 关键)**:`addPScores(rows, norms)` 加 norms 开关。批量模式(不传 norms)用同批次跨教师算百分位(研究场景);单教师模式**必须传** norms,否则单人百分位恒 50、算法退化。`tools/build_norms.js` 从 45 位模拟教师提取 8 个指标的分布数组 → `tools/advisor_norms.js`(56KB,`version:'2026-07-08-45sim'`)。
  - **对拍(硬门槛)**:三个脚本必须 exit 0 才能改动/部署 advisor:
    - `tools/verify_align.js` — 批量模式 vs Python 参考输出 6 张 CSV 逐位一致
    - `tools/verify_norms_mode.js` — 45 位逐位单教师+常模模式 vs Python(45/45 完美匹配,1.1ms/位)
    - `tools/verify_cf_pipeline.js` — mp session → cf 翻译层 → advisor 输出 vs Python(45/45 完美匹配)
    参考输出 `tools/advisor_ref_output/`(Python advisor 首次生成,入库便于未来复跑)。
  - **云函数 `cloudfunctions/gsyg_selectFinal/`**:
    - `index.js` wx-server-sdk 包装 + mp↔py 题号翻译(MP_TO_PY 自对合表)+ mp session 埋点合成为 advisor 期望的 enter/change/leave 事件(按 option 定位、忽略 from_pos,与 mp `utils/process.js` 一致,对埋点漂移容错)+ 幂等缓存(algo=`advisor_v1` + normsVersion 匹配则复用)+ 落库到 `gsyg_sessions.selection`。
    - `advisor_port.js` / `advisor_norms.js` 从 tools/ 物理拷贝,由 `tools/sync_cf.js` 单命令同步(云函数目录须自包含,不能相对 require)。改动 advisor 后必须 sync 再上传。
  - **前端阻塞式流水线**:
    - `utils/interviewGate.js` 守卫:点「去 AI 访谈」时 `ensureFinalThen(sid, onOk)` — 已有 advisor_v1 selection 直进;缺失则 `wx.showLoading + flushPending + api.selectFinal` 阻塞式拉;失败弹「暂时无法开始访谈 · 重试 / 取消」,错误码文案本地化。
    - `exam.js doSubmit` **不再调 `selectThree`**,不再本地初始化 selection/interview 占位;上报 reportExam 传 `selection:null`,交云函数落地。
    - `submit.js onSelect` / `home.js onInterview` / `interviewList.js onLoad` 三处入口统一走守卫。方案乙:submit 页立刻显示成功,点访谈按钮才阻塞。
    - `store.saveSelection` 落地云函数返回并初始化 interview 占位;`store.hasFinalSelection` 判 `selection.algo === 'advisor_v1'`。
  - **失效条件与刷新**:换常模必须换 `norms.version` 字符串(否则老 session 缓存不重跑)。刷新流程见 `cloudfunctions/gsyg_selectFinal/README.md`。
  - **`scoring.js selectThree` 已 deprecated**:保留代码供离线兜底与参考,不在提交流程中调用。评分/查表仍在端上(`scoring.js scoreOne/computeScores`),红线不变(AI 不参与打分)。
- **2026-07-08 上线后修复三则 + 看答题页 + 情境配图**:
  - **`-502001` 写回失败**(方案 A 上线首次调用暴露):`gsyg_selectFinal` 用 `update({data:{selection:{...}}})` 会被 CloudBase 拍平成 sub-path 操作(`selection.algo` / `selection.final`...),而上游 `gsyg_reportSession` 每次都写 `selection: event.selection || null`,使字段值为 `null`,MongoDB 底层拒绝在 `null` 上创建子字段。修复:①`gsyg_selectFinal` 用 `db.command.set(selection)` 强制**替换整个字段**,不拍平;②`gsyg_reportSession` 未传 selection 时**不写此字段**(而非写 null),未来新 session 干净;老 session `set()` 也能覆盖。**幂等缓存这才真正生效**——之前每次都在重跑 advisor 是因为写回失败,缓存永远没落地。
  - **`interviewGate` 读错层级**:`callCloud` 成功返回 `{ok:true, data:<云函数结果>}`,真正的 selection 在 `r.data.selection` 里。之前直接读 `r.selection` 永远 undefined,即使云函数成功也走进"重试"分支,弹窗成"遴选服务不可用(undefined)"。修复:改读 `r.data.selection` + `console.warn` 打印原始错误 + 加 callCloud 层错误码文案(`cloud_unavailable` / `cf_fail` / `callFunction_fail` / `exception`)。
  - **导出增补 selection 统计**:`gsyg_exportData` 本来就 dump 整个 sessions 集合(`selection` 字段随文档一起导出)。追加 `stats.sessions.{selected_advisor_v1, missing_selection, other_algo}` 到返回值与 bundle,一眼看出遴选覆盖率,方便管理员判断还有几条 session 未走 gsyg_selectFinal。
  - **看答题页 `review` 补题干 + 选项缩小**:①原页只显示 title 和排序,没题干,用户对不上情境 → 补 `<view class="t ink">{{item.stem}}</view>`,风格与 exam/interview 一致(主色标题 + 正文);②新增 `.rv-opt` 覆盖全局 `.opt` 尺寸(b 40rpx × 22rpx 字 / x 23rpx / padding 10-14rpx / margin-bottom 8rpx),与 interview `.iv-rank` 尺寸对齐,一屏容量更好。
  - **情境配图(10 张,答题页专用)**:据 DOC《十张图.zip》,答题环节题干**上方**加情境图,访谈/看答题/提交/评分**不加**。原图 26MB PNG 用 `tools/build_scenario_images.py`(Pillow)压到 750px 宽 progressive JPEG q82,10 张合计 **640KB**,主包内置(mp 主包上限 2MB)。命名 `Q1..Q10.jpg` 与 mp 题号一致(原文件名 001..010 自然对应,无需映射)。`exam.wxml` 加 `<image src="/images/scenarios/{{q.item_id}}.jpg" mode="widthFix" lazy-load>`;`exam.wxss` 加 `.scenario-img`(full width / 圆角 14rpx / 占位色 soft)。DOC/images_ten/ 原始 PNG 归档,方便日后重新压缩。**注意**:图片在包体里,换图需要发新版 mp,非热更新;频繁换图应迁云存储。
- **部署清单(2026-07-08 方案 A 全部落地后)**:三个云函数需要上传并部署:
  1. `gsyg_selectFinal`(核心遴选) — 每次 `advisor_port.js`/`advisor_norms.js` 改动前跑 `node tools/sync_cf.js` 再传
  2. `gsyg_reportSession`(不再写 null selection)
  3. `gsyg_exportData`(stats 增强)
  三份对拍脚本改动 advisor 后必跑,全 exit 0 才能部署:
  - `node tools/verify_align.js` — 批量模式 vs Python 6 张 CSV
  - `node tools/verify_norms_mode.js` — 单教师+常模模式 vs Python
  - `node tools/verify_cf_pipeline.js` — mp session → 翻译层 → advisor vs Python
- **2026-07-09 按 DOC《界面及程序建议 0709》整合四条改动**:
  - **登录去手机号**:`store.isLoggedIn` 改为「profile.name 已填即登录」(老用户 phoneAuthed=true 仍兼容);profile 页只保留**姓名/园所/教龄**三项(全必填),删任教班级、试卷码、账号信息卡(OpenID + 角色);`login` 页移除 `getPhoneNumber`,只做静默 `wx.login` 取 code + 一个「进入」按钮;`requireLoginWithPrompt` 弹窗改「请先完善个人信息」→ 跳「我的」Tab;home / exam / interview 提示文案同步。`home.onStart` 建 session 不再传 paperCode。
  - **输入框「完成」遮挡 bug**:interview `<textarea>` 加 `show-confirm-bar="{{false}}" adjust-position="{{true}}" cursor-spacing="20" hold-keyboard="{{true}}"`,消除微信默认「完成」按钮遮挡输入的汉字。
  - **访谈计时**:`finalize` 不再 `stopTimer`(时间 > 0 时倒计时持续走,直到用户离开或时间到);`tick` 剩余 ≤ 0 显示红色 `00:00` + `stopTimer`(不再每秒 setData);不强制中断,教师可继续回答直到主动 finalize 或 `onUnload`。toast 改「本情境访谈时间已到,可继续完成当前回答」。
  - **AI 提问深度**:`gsyg_interviewChat` 系统提示词大改。加❌禁的浅层提问示例("为什么把 D 排最理想")+✅四种专业范式(抓具体细节 / 触专业边界 / 揭短式反问 / 对比性追问),每类举例;把知识库 09 表专业追问脚本(`kbSlice.scripts`)加进 prompt 作为"研究团队预设深度参考";加节奏指引(首轮不用"你怎么排的"起手,≥3 个 E 覆盖或 5 轮以上收束)。硬约束和 JSON 输出格式保持不变。改后需重部署 `gsyg_interviewChat`。
- **2026-07-09 AI 访谈 MVP:任务卡 + 16 表知识库 + 阶段化(DOC/inbox_0709)**:
  - **决策**:Q1 用户说"访谈能力还不强",直接做 MVP 四步。Q2 知识库放 `cloudfunctions/gsyg_interviewChat/knowledge.json`(方案 B,不占 mp 包体)。Q3 Python advisor 内部题号**不动**,继续用 `gsyg_selectFinal` 的 MP_TO_PY 翻译层——mp 端看到的顺序已是新 canonical(001 文档目标已达成),重写 Python 内部会作废常模+三份对拍。
  - **16 表知识库导入**:`tools/build_knowledge_v16.js` 从 `DOC/inbox_0709/_kb16/*.xlsx`(10 题 × 16 表)解析,输出 `cloudfunctions/gsyg_interviewChat/knowledge.json`(~580KB)。每题存:全 16 表原始行 + 常用切片(`ai_rules`(15 表 30 条规则/题)/ `scripts` / `option_explanations` / `evidence_points` / `triggers` / `output_schema` / `basic` / `context_structure` / `assessment_intent`)。解析要点:kb16 xlsx 全用 inlineStr(t="str"),`sharedStrings.xml` 空;`r:id` 是字符串如 `R5dd68bc2bd274265` 不是 rId数字;rels Target 可能以 `/xl/` 开头需切掉;首行作 header,merged banner 行(如 "09 AI追问脚本(按既定指标体系更新)")会被误当 header 但不影响主用途表 15/16。云函数冷启动 `require` 一次共享内存。
  - **gsyg_selectFinal v1 → v1.1**:`ALGO_VERSION = 'advisor_v1.1'`,老 session 幂等缓存失效强制重跑一次。`selection.final[i]` 补四个 task_card 教师作答画像字段:`teacherFinalOrder` (final_ranking.join('')) / `teacherInitialOrder` (first_ranking.join('')) / `orderChanged` / `orderChangeSummary`。数据来源是 `sessionDoc.answers[mpId]`(免费,不改 advisor_port)。`store.hasFinalSelection` 兼容 `advisor_v*` 前缀 + 检查 `teacherFinalOrder` 存在,老 v1 视作未完成 → 自动触发一次重拉。
  - **gsyg_interviewChat v2 · 任务卡组装**:云函数从 `event.taskCardSeed`(mp 端拼)+ knowledge.json 里当前题的 `ai_rules`(15 表 30 条),按 `trigger_condition` 筛出适用当前教师的规则,按 `rule_type` 分组产出完整 task_card:`ability_focus.{main,secondary}` / `interview_hypotheses[]` / `must_obtain_evidence[]` / `recommended_probes[]` / `interview_flow` / `process_hints` / `forbidden_disclosure`。触发匹配 `matchTrigger` 覆盖 `all` / `A_first` / `A_last` / `priorityOption_C` / `priorityPair_BC` / `order_changed` / `process_complex/stable` 等原子,支持 OR/AND(或/与) 组合。未识别条件视作 `all`。
  - **gsyg_interviewChat v2 · 阶段化 S1-S4**:`S1_CONTEXT → S2_COMPARE → S3_STRATEGY → S4_SUMMARY`。`decideNextStage(stage, coveredEvidence, turnCount)`:轮次≥2 且 covered≥1 或 turnCount≥3 时推进;S4 保持不推。云函数返回 `{stage, nextStage}`,mp 端 `interview.js` 用 `nextStage` 更新本地 `_stage`。
  - **gsyg_interviewChat v2 · system prompt 重写**:先前的"四种专业范式(抓细节/触边界/揭短/对比)"保留;**新增「当前教师任务卡」块**列 task_card 全部字段(题目/能力方向/教师最终+初始排序/变化摘要/重点选项/重点比较对/过程标签/遴选来源) + 假设/证据/追问三张列表 + 当前阶段焦点说明。task_card 缺失时降级到 v1 `kbSlice` 路径(兼容期)。
  - **mp interview.js**:`startLive` 从 `session.selection.final[i]` 读出本题 task_card seed,拼装 `_taskCardSeed`(含教师排序 + priorityOption/Pair + processTags + ability_type + sources)。`_stage` 从 `S1_CONTEXT` 起。每次调云函数,ctx 加 `taskCardSeed` + `stage`,保留 `kbSlice` v1 兼容。`utils/interview.js llmNextQuestion` 透传 `stage/nextStage`。
  - **上线部署**:①`node tools/sync_cf.js`(改过 advisor 才需);②微信开发者工具重新部署 `gsyg_selectFinal`(algo v1.1);③重新部署 `gsyg_interviewChat`(带 knowledge.json 上传)。
  - **暂未做(等 MVP 稳定后再启动)**:结构化证据抽取(独立云函数 `gsyg_extractEvidence` 按 16 表 output_schema 输出 evidence_json) / Python advisor 按知识库顺序内部整改(001 全套) / 报告页。
- **2026-07-09 任务卡预生成落地 · advisor v1.1 → v1.2**:
  - **背景**:002 doc 要求每教师最终 3 题在遴选时就生成完整任务卡(不是每轮云函数现场拼),存到 session,供访谈/导出/未来证据抽取直接读。
  - **共享模块** `tools/task_card_builder.js`:从 `gsyg_interviewChat/index.js` 抽出 `matchTrigger` / `buildTaskCard` / `decideNextStage` / STAGES / STAGE_LABEL / DEFAULT_FORBIDDEN_DISCLOSURE。`setKnowledge(kb)` 注入知识库,两个云函数共用一份实现。
  - **canonical 位置**:`tools/knowledge.json`(build_knowledge_v16 输出改到这里),不再直接写云函数目录。`tools/sync_cf.js` 分配:`gsyg_selectFinal` 拿 advisor_port + advisor_norms + task_card_builder + knowledge.json;`gsyg_interviewChat` 拿 task_card_builder + knowledge.json。改任一 → 跑 sync_cf → 上传各云函数。
  - **`gsyg_selectFinal` v1.2**:ALGO_VERSION `advisor_v1.1 → advisor_v1.2`,老 session 强制重跑一次。遴选完 3 题后 for each item 调 `taskCardBuilder.buildTaskCard(seed)` 预生成完整卡,挂到 `selection.final[i].task_card`。字段完全对齐 002 doc:`task_card_version` / `item_id` / `item_title` / `knowledge_base_id` / `scenario` / `ability_focus` / `teacher_answer_profile` / `interview_hypotheses[]` / `must_obtain_evidence[]` / `recommended_probes[]` / `interview_flow[]` / `process_hints[]` / `forbidden_disclosure[]`。
  - **`gsyg_interviewChat` v2.1**:入参优先级 `taskCard`(session 已存) > `taskCardSeed`(现场拼) > `kbSlice`(v1 兜底)。有 taskCard 时浅拷贝并覆盖 `current_stage`,不再每轮重跑 buildTaskCard(省 5-30ms + KB 遍历)。日志 `[task_card] source=session|seed|none` 便于追查。
  - **mp `interview.js`**:`startLive` 从 `seedFull.task_card` 读完整卡到 `_taskCard`(processTags 合入 teacher_answer_profile);缺卡时降级到 `_taskCardSeed`。ctx 同时带 taskCard + taskCardSeed。
  - **`store.hasFinalSelection` 增强**:检查 `final[0].task_card.interview_hypotheses` 存在,老 v1.1 视为未完成 → interviewGate 自动重拉。
  - **`gsyg_exportData` 增强**:①`stats.sessions` 兼容 `advisor_v*` 前缀,拆成 `selected_with_task_card` / `selected_no_task_card` / `missing_selection` / `other_algo`;②新增 `bundle.task_card_index`(展平 [participantName, final_rank, item_id, teacherFinal/Initial, priorityOption/Pair, hypotheses/evidence/probes count]),研究者从 JSON 里一眼扫全部任务卡。
  - **部署**:①`node tools/sync_cf.js` ②重传 `gsyg_selectFinal`(v1.2 自动补齐老 session task_card) ③重传 `gsyg_interviewChat`(v2.1 直读 task_card) ④重传 `gsyg_exportData`(新 stats + index)。
- **2026-07-15 三项改动(据研究团队《AI访谈运行提示词 v4.0》+ 新题序程序 + 反馈问题)**:
  - **① AI 访谈系统提示词升级为「决策程序版」v4.0**(`cloudfunctions/gsyg_interviewChat/index.js`):`buildSystemPrompt` 改为返回静态策略常量 `INTERVIEW_POLICY`——先在内部形成「教师判断图」;每轮只执行三种问题功能之一:**细化**(S 情境解释/T 任务判断/A 行动推演/R 结果标准)、**深化**(区别性策略特征→作用机制→后果→教育关切→价值冲突/条件)、**拓展**(重新命名/替代假设/观察位置/单一条件变化/概念边界/实践结构);含去重规则、问题选择标准(解释力/连续性/区分度/新颖性/安全性)、句式与收束规则。个性化任务卡改为经 `buildUserPrompt` 以提示词要求的**动态输入**注入(当前情境/四个做法/教师最终排序/初始排序与变化/访谈焦点/值得关注选项/值得比较对/待检验假设/参考问题/证据点/完整对话历史/剩余时间)。项目红线保留(不透露专家排序/得分/标准答案/对错、纯文字、严格 JSON)。**输出 JSON 新增 `question_strategy`**(mode/type/operator/anchor/relation_sought/advances_from,仅后台研究审计,mp 端不展示、服务端 `console.log('[strategy]')`);`covered_evidence` 放宽为「教师已明确说出的内容」(不再强制 E1-E7),`normalizeResult` 宽松保留非空字符串项。旧 S1-S4 阶段/stage 字段保留返回(mp 兼容)但**不再注入 prompt**,由模型自身管理问题类型。**mp 端无需改动**(`utils/interview.js llmNextQuestion` 只取 question/done/evidenceHint/stage/nextStage,忽略新字段)。部署:重传 `gsyg_interviewChat`(index.js 直接改,非 sync_cf 同步文件;knowledge.json/task_card_builder.js 未变)。
  - **2026-07-16 AI 访谈运行提示词升级为 v4.1**(`cloudfunctions/gsyg_interviewChat/index.js`):按研究团队新版提示词补充三类问题的具体正反例，进一步说明细化是展开可分析的实践关系、深化是建立理由之间的联系、拓展是引入可检验的新差异；明确类型转换不要求逐项使用 STAR、ACV 或所有拓展方式；内部问题选择标准由五项扩为六项，新增**易懂性**；句式规则新增幼儿园教师日常口语、单一主要询问重点及四项内部易懂性检核，同时要求改写时保留具体锚点和分析价值。动态输入、严格 JSON、项目红线和 mp 端取值方式不变。生效方式：只需重新部署 `gsyg_interviewChat`，无需重新上传小程序前端。
  - **2026-07-16 AI 访谈运行提示词升级为 v4.2 + 收束流程修正**(`cloudfunctions/gsyg_interviewChat/index.js`):依据真实试访记录，将“深度”明确为情境线索—策略—后果—教育关切—条件之间的关系，不再等同于持续索要动作细节/观察指标/现场话术；同一情境的具体话术/行动/观察型问题通常合计一次，去重由“锚点+认知操作”扩为“锚点+认知操作+可能答案空间”；增加问题前提检验、单情境反事实原则上一次、任务卡证据允许未确认、承接语可选，候选问题标准扩为八项（新增推进价值、前提正当性、互动负担）；未加入教师元沟通/对话修复专节。动态任务卡标签同步改为“可选、不要求逐项覆盖”。**流程修正**:最多六个可回答问题；教师提交第六次回答后，云函数在调用模型前直接返回陈述性收束语，不再生成无法回答的第七问；模型提前 `done=true` 时若仍输出问句或要求确认/补充，服务端改用安全收束语。`done=false` 才能输出可回答问题，`done=true` 只能输出不要求回答的陈述语。只需重部署 `gsyg_interviewChat`，mp 前端无需发版。
  - **② 访谈全部完成后、提交前新增 3 个反馈问题**:新页 `pages/feedback/feedback`(已入 app.json,共 12 页)。3 题:1「您对此次 AI 访谈的整体感受如何？」2「在本次 AI 访谈过程中，哪些问题或交流内容给您留下了较深印象？」3「您觉得哪些地方还可以进一步改进？」。**路由**:interview `onBack()` 当 `allDone` 且未提交反馈 → `redirectTo` feedback;已提交 → done。feedback 提交 → 存 `session.interviewFeedback={q1,q2,q3,submittedAt}`(`store.saveInterviewFeedback`)+ `api.reportInterview({...,feedback})` 上报 → `redirectTo` done。interviewList 的 allDone 卡:未提交反馈显示「填写访谈反馈」按钮(`onFeedback`→navigateTo),已提交显示「回到首页」。反馈内容**可留空**(问题呈现即满足「提交前增加 3 问」,答案非强制)。**`gsyg_reportInterview`**:`feedback` 只在有值时写入(`if(event.feedback)`),避免每题上报(feedback=null)覆盖已提交反馈(同 selection null-fix 思路)。feedback 随 `gsyg_interviews` 文档被 `gsyg_exportData` 一并导出,无需改导出。部署:重传 `gsyg_reportInterview`。
  - **③ 计分/情境筛选参考程序更新为「新题序新赋分」**(`DOC/calculate_advisor_rpg_final_新题序新赋分.py`):研究团队把 Python 内部题号重排为**与小程序题号一致**(py Qn == mp Qn)。经校验为旧程序的**保值重排**——`SCORE_CSV`:`new[mpQ]===old[MP_TO_PY[mpQ]]` 全 240 处 0 不一致(赋分值未变,仅换列);`ABILITY_MAP` 标题/主/次能力在 MP_TO_PY 下 10/10 一致;mp `data/scoreTable.js` 与新程序赋分逐格 0/240 一致(mp 早已对齐)。旧参考 `DOC/calculate_advisor_rpg_final(1).py` 保留(历史 provenance)。
  - **④ 恒等题号迁移落地(去掉 `MP_TO_PY`,应本人 2026-07-15 要求)**:把整条 advisor 链路的内部题号迁到小程序恒等题号,彻底删除 `gsyg_selectFinal` 的翻译层。
    - `advisor_port.js`:`SCORE_CSV/ABILITY_MAP/QUESTION_CONTENT/SCENARIO_FOLLOWUP_QUESTIONS` 4 个常量由新参考程序(python 载入后)提取生成,全部为小程序题序;头注已重写。
    - 45 教师模拟数据重贴标签:`tools/migrate_sim_to_mp_order.py`(自对合 M 映射;只改题号标签、不改任何数值/排序内容)→ 新目录 `DOC/…/模拟数据_45位教师_mp题序/`。原目录保留。
    - `advisor_norms.js`:`build_norms.js` 指向新数据重生成,Q 键改 mp 题号,`version` bump 到 `2026-07-15-45sim-mporder`(老 session 缓存据此失效重跑一次)。
    - `tools/advisor_ref_output`:由新参考程序在重贴标签数据上重生成(6 张 legacy CSV + 2 xlsx)。
    - `gsyg_selectFinal/index.js`:删除 `MP_TO_PY/PY_TO_MP`,`buildAdvisorInput` 直接用 mpNum,`mpQ` 恒等;`ALGO_VERSION` 不变(靠 normsVersion 触发一次重算)。`verify_cf_pipeline.js` 映射改恒等;三份对拍(verify_align/norms_mode/cf_pipeline)对**新参考** 45/45·0 diff。
    - **行为差异(须知)**:与迁移前(旧 py 题号 + MP_TO_PY)相比,45 位模拟教师中 **43/45 最终 3 题完全一致,2 位**(sim_009、sim_043)因 R/P/G 排序中「同值并列按题号断」的 tie-break 在重排后断法不同而选出不同情境。这是**采用研究团队新程序 tie-break 的预期结果、非缺陷**(旧 mp 链路此前并非与新程序完全等价,正是这 2 例;迁移后 mp 与新程序逐位一致)。差异记录见 `tools/verify_migration_equivalence.js`。
    - **部署**:`node tools/sync_cf.js` → 重传 `gsyg_selectFinal`(advisor_port + advisor_norms 新版,normsVersion 变化会让老 session 自动重跑一次遴选;结果对 43/45 不变、2 例按新程序更新)。mp 前端无需改。
- **2026-07-16 管理员导出增加研究整理版 Excel**:
  - **双格式并存**:`gsyg_exportData` 新增 `event.format="xlsx"|"json"`。`json` 继续保存 teachers/sessions/interviews/task_card_index 全量原始字段,并改为带缩进的可读 JSON；`xlsx` 用 `exceljs` 生成研究整理版,不替代原始备份。
  - **旧版小程序兼容**:云函数缺省格式改为 `xlsx`——已发布的旧页面调用 `exportData({})`、不传 `format` 时，现有“导出全部数据”入口会直接生成 Excel，因此此项可只重部署 `gsyg_exportData`、不更新小程序版本。只有明确传 `format:"json"` 时才生成原始 JSON；两种导出均只读数据库并按时间戳创建新文件，不覆盖历史 JSON 或业务数据。旧页面辅助文字仍可能显示 JSON，待以后正常发版时再由新版双入口纠正。
  - **Excel 九表**:导出说明 / 教师信息 / 测验访谈汇总 / 作答明细 / 情境筛选 / 访谈逐字稿 / 访谈编码 / 访谈任务卡 / 访谈反馈。保留教师姓名、园所、教龄和当次历史姓名,另给 T001…教师编号用于跨表关联；整理版不放 openid/_id/wxCode,这些运行字段仍在原始 JSON。
  - **历史数据兼容**:selection 无 algo 的旧 session 仍进入“情境筛选”,标为“历史版本/未标记”；没有完整 task_card 的记录不伪造任务卡；pending 情境在逐字稿/编码表中显式保留；同一 openid 曾修改姓名时,“教师信息”列出当前姓名与历史姓名。
  - **管理员界面**:`我的 → 管理员` 分为“导出整理版 Excel”和“导出原始 JSON”两个入口,下载链接仍复制到剪贴板、有效期约 2 小时。
  - **验证/部署**:`npm install` 安装 `gsyg_exportData` 依赖后,运行 `node tools/verify_export_workbook.js <full.json> [output.xlsx]` 回读校验九张表和各明细行数；上线需重新部署 `gsyg_exportData`（选择云端安装依赖）并重新编译小程序。
- **2026-07-22 AI 访谈生成内容提示与列表留白**:访谈情境列表顶部说明、访谈进行中的底部输入区、访谈完成状态及回看状态均显示「内容由AI生成，仅供参考」；访谈列表每张情境卡增加上下内边距，卡片间纵向外间距统一为 `32rpx`（移除循环内联 `margin-top:0`，避免覆盖全局相邻卡片间距）；`prototype.html` 与 `设计文档.md` 同步保持一致。
- **2026-07-29 双端并存 · 新增网页端 `web/`**:
  - **范围**:保留原生微信小程序 `miniprogram/` 不改动；新增 Vue 3 + Vite 的响应式教师端网页，覆盖资料、历次记录、20 分钟 10 题排序、评分/回看、服务端三题遴选、AI 访谈、反馈与完成页。管理端不在网页端重复建设。
  - **唯一数据口径**:`miniprogram/data/` 仍是题库、赋分、指标映射、知识库的 canonical source；`web/scripts/sync-data.mjs` 在网页构建前自动同步至 `web/src/generated/data.js` 并复制情境图。`npm run verify` 必须跑小程序与网页 10×24=240 个题目排列的评分对拍；评分仍是确定性查表，AI 不参与评分。
  - **数据字段**:网页会话沿用 `sessionId`、`answers.{Qn}.first_ranking/final_ranking/move_log/duration_ms`、`scores`、`selection`、`interview`、`interviewFeedback` 等字段，以保持过程数据、筛题与访谈口径一致。
  - **后端安全边界(硬约束)**:现有 `gsyg_*` 事件云函数依赖小程序 `wxContext.OPENID`，**网页不可直接调用**。网页一律调用 `VITE_WEB_API_BASE_URL/call` HTTPS 网关，由网关完成网页认证、从可信会话取得 `webUserId`，再受控访问同一数据集合与确定性算法。禁止从网页 JSON 接收/信任 `openid`、`uid`；不得把 CloudBase 管理员 API Key、LLM Key 或网关密钥放进前端。小程序保留 `wx.cloud.callFunction` 原路径。跨端统一教师身份必须由服务端基于已验证手机号或统一账号绑定，不能按姓名合并。
  - **上线前**:完成网关的登录、CSRF/CORS、ownerId 权限校验、审计与内容安全审核；仅允许已登录用户调用写入、遴选和访谈。详见 `web/README.md`。
- **2026-07-30 网页端改为 CloudBase 匿名登录**:
  - **身份链路(替换 2026-07-29 默认登录页方案)**:`web/src/services/cloudbase.js` 在 `main.js` 初始化 `@cloudbase/js-sdk` 并 `app.provide('$cloud', cloud)`；`web-auth.js` 在首页加载时先查网关 Cookie,没有网关会话时读 CloudBase 本地凭证,无凭证则调用 `auth().signInAnonymously()`。**不再使用 `auth().toDefaultLoginPage()`、不跳转默认登录页、不依赖微信开放平台扫码/redirect_uri**。`getAccessToken()` 只用于调用网关 `/auth/session` 一次,之后只带 HMAC 签名的 HttpOnly Cookie。
  - **旧凭证兼容修复**:从默认登录页切到匿名登录后,浏览器可能残留旧 CloudBase 本地凭证,导致前端 `getAccessToken()` 取到非匿名/失效 token,网关返回 `cloudbase_token_invalid`。`web-auth.js` 必须先用 `auth.loginScope()` 确认 `anonymous`,否则 `signOut()` 清理旧凭证再 `signInAnonymously()`。
  - **网关**:`gsyg_webGateway` 以 `WEB_CLOUDBASE_ENV_ID` 构造（可由 `WEB_CLOUDBASE_USERINFO_URL` 覆盖）CloudBase Gateway `/auth/v1/user/me` 地址(`https://<env>.api.tcloudbasegateway.com/auth/v1/user/me`),验证 Bearer token 后签发 `gsyg_web_session`；需独立强随机 `GSYG_WEB_SESSION_SECRET`。仅白名单转发 profile/session/selectFinal/interviewChat/interview 五类动作，CORS 只允许 `WEB_ALLOWED_ORIGIN` 精确来源。
  - **下游授权**:`gsyg_reportTeacher` / `gsyg_reportSession` / `gsyg_reportInterview` / `gsyg_selectFinal` 仅当 `__gsygGateway.token === GSYG_WEB_GATEWAY_TOKEN` 且 actor 匹配 `web:<UID>` 时接受网页调用，identityType=`web_anonymous`；其他调用继续沿用小程序 OPENID。session/interview 上报按该 actor owner 校验，不能按已知 sessionId 覆写他人记录。
  - **部署**:CloudBase 控制台需开启匿名登录；5 个函数均配同一 `GSYG_WEB_GATEWAY_TOKEN`，网关另配 session secret、CloudBase 环境 ID、HTTPS CORS/Cookie 参数；上传网关并绑定 `/gsyg-web`，重传四个下游函数；网页配置 `VITE_WEB_API_BASE_URL`、`VITE_CLOUDBASE_ENV_ID` 后重建。详细控制台设置在 `cloudfunctions/gsyg_webGateway/README.md`。正式跨端统一仍必须服务端绑定已验证手机号或统一帐号，不能按姓名合并；旧 `web_demo` 数据应清理。TCIM 语义层若启用，另需部署 `gsyg_semanticProbe`（自包含，非 sync_cf 源；部署见其 `README.md`）并在网关 `ACTIONS` 加 `semanticProbe` 白名单。
- **2026-07-30 网页端 AI 访谈 LLM profile**:`gsyg_interviewChat` 增加 `LLM_PROFILES` 白名单。小程序和网页端默认不传 `llmProfile` 继续走 `wxai`；网页网关调用默认走 `WEB_INTERVIEW_LLM_PROFILE || "wxai"`，也可由网页构建变量 `VITE_INTERVIEW_LLM_PROFILE` 传 `llmProfile` 切换。内置 profile: `wxai` / `deepseek` / `openai-compatible`。前端只能传 profile id，不能传 endpoint/key；endpoint/model 写在云函数配置代码里，API Key 只读云函数环境变量。`deepseek` 用 `DEEPSEEK_API_KEY/DEEPSEEK_MODEL`；通用第三方用 `OPENAI_COMPATIBLE_ENDPOINT/OPENAI_COMPATIBLE_API_KEY/OPENAI_COMPATIBLE_MODEL`。响应额外返回 `llmProfile` / `llmModel` 供调试审计，不返回 endpoint/key。部署需重传 `gsyg_interviewChat`；若改 `VITE_INTERVIEW_LLM_PROFILE` 还需重建网页。
- **2026-07-30 网页访谈对齐小程序最终 V7.4**:排查发现网页 `main` 是从访谈 v4.2 分叉，仍保留“最多 6 个可回答问题”和失败后固定脚本降级，未包含小程序后续 v4.3-v7.4 的访谈决策程序。现已把 `gsyg_interviewChat` 对齐小程序 `interview-v6-2-codex` 的最终 V7.4，同时保留网页 `LLM_PROFILES` 模型切换：正常访谈至少 8 问、不设硬上限，8 问后依据内容完整性与剩余时间收束；先形成情境理解图，再围绕教师最新回答推进一条主线；支持理解修复、张力/边界/整合追问和最后一分钟内容化收束。网页 `InterviewView` 删除六问截止与 `buildScriptQueue/fallbackNext` 静默降级，调用失败时保留对话并让教师选择“重新生成 / 结束本情境”，同时传入 `teacherName/stage/remainingMs/llmProfile` 并记录响应中的模型审计字段。新增 `tools/verify_interview_v7.js`、`tools/verify_interview_resilience.js` 和 `web/scripts/verify-interview-v7.mjs`；部署前需运行两份云函数验证及 `cd web && npm run verify && npm run build`。上线需重传 `gsyg_interviewChat` 并重新构建网页；该云函数仍为双端共用，部署后小程序与网页会共同使用 V7.4。
- **2026-08-21 TCIM 模块化访谈（第一阶段，Task 0/2/3/4/5 落地）**:据《专业谈话AI（TCIM）新的工程任务说明.docx》+《总体架构 及流程.zip》+《数据表 5个.zip》实施。
  - **架构（见 `docs/tcim/`）**:`tcim/` 为模块化内核（core: contracts/shared_state/module_registry/module_runner/orchestrator/turn_context）+ modules（ontology active；prdm/rag/utility/teacher_state/metacognition future disabled）。红线:Evidence State 只有 Ontology 可写；Orchestrator 拥有唯一 ProfessionalActionPlan + fingerprint；PRDM/Generator 无写 Evidence 权限；模块可 enabled/disabled/versioned/replayable；禁止 `question_id==X` 核心特例。
  - **5 表数据化（Task 2）**:`tools/build_tcim_data.py` 从 DOC/数据表 5个.zip 生成 `tcim/professional_data/game_support/`（common + questions/q01-q10 的 ontology/evidence_anchors/priority_rules/probe_rules/stop_rules/metadata）。跨表校验:10 题每题 6 slot、24 排列不重不漏、核心 slot 引用完整，errors=0。
  - **Evidence Engine（Task 3）**:`tcim/modules/ontology/`。前测仅作 prior（uncertainty/优先级），不直接填能力等级；锚点匹配用「规范化 bigram 覆盖率」(`evidence_updater.js` 的 `RATE_MIN=0.15/HITS_MIN=3`)，允许不升级（空话/长而无具体证据不得升级）、冲突保留 conflicting_spans 并降置信。测试 `tcim/tests/ontology.test.js`。
  - **Orchestrator（Task 4）**:`tcim/core/orchestrator.js` ReRank = professional_priority + evidence_gap + pretest_uncertainty + conflict_bonus - probe_cost；Stage A（knowledge_need）→ Stage B（锁定 plan + fingerprint）。FakeUtility 无侵入接入测试通过。
  - **网页接入（Task 5）**:`web/src/core/tcim/engine.js`（纯前端确定性引擎，ESM）+ `mode.js`（`VITE_TCIM_MODE=ont|legacy`）。InterviewView 在 TCIM 模式下用本地引擎生成问题（表4 probe 模板，非诱导单问），legacy LLM 路径完整保留。数据打包 `tools/build_tcim_web_data.mjs` → `web/src/generated/tcim-data.js`（sync-data.mjs 构建时保留）。smoke `node web/src/core/tcim/engine.test.mjs` 10/10 通过；`npm run verify` 240 排列对拍 + V7.4 检查通过。
  - **Task 1 审计（2026-08-21）**:`docs/tcim/CURRENT_FLOW.md`（网页+小程序完整调用链）+ `TCIM_INTEGRATION_MAP.md`（TCIM 接入点：前测资料进 TurnContext 待接、PRDM 接入点在 processTeacherTurn 的 Orchestrator 之后）。
  - **Replay（2026-08-21）**:`web/src/core/tcim/engine.js` 每轮记录 `TurnReceived/EvidenceUpdate/OrchestratorEvent/PRDMEvent/GenerationEvent/ConstraintEvent` + 版本 + 时间戳，持久化到 `session.interview[itemId].tcimReplay`。
  - **Generator + Constraint Checker（2026-08-21）**:`checkConstraints()` 拦截答案泄露（得分/标准答案/能力等级/R/P/G/slot/证据缺口）、多问、评价性语言、重复、超长；不通过则用安全通用问重写（不改专业行动）。
  - **PRDM V0.1（2026-08-21）**:`tcim/modules/prdm/prdm.js` + 网页 `prdmPlan()`。Interaction Read（repair/frustration/low_certainty/depth）→ Local Progress（ADVANCING/SLOW/STUCK）→ Stance/Move → Challenge(0-3)/Load/Dose。**PRDM ON/OFF 对同一回答的 Evidence Update 完全一致**（已验证）。Node 侧默认禁用可启停。
  - **Task 6 模拟回归（2026-08-21）**:`tcim/tests/stress_regression.test.js`。10 题 × 9 类教师（高/中/低/跑题/矛盾/低确信/极快）共 720 轮。断言：无答案泄露、10 题全覆盖、低能力教师绝不误升 Evidence。baseline：Evidence 升级 6 次/720 轮、冲突检出 0、过早 Stop 0、高能力教师 8 轮内达成充分的完成率 0/10（保守阈值，宁可慢不错升，可复现基线特征）。
  - **前测完整资料进 TurnContext（2026-08-21）**:`initTcisSession(itemId, ranking, tags, pretest)` 接收 `{mean,total,teachingYears,modificationCount,durationMs,firstSwing,lastSwing,oscillation}`；低分/新人教龄调 uncertainty（只作 prior，不填等级），Node 与网页两侧一致。
  - **PRDM 决策落到真实措辞（2026-08-21）**:`prdmWording()` 按 DialoguePlan 改问句：REPAIR→「我重新理解一下您的意思：…」、SLOW→「能不能举个例子，…」、GENTLE_CHALLENGE→「如果换个角度看，…」、LOW dose→截短。不改专业目标/证据判断。
  - **5 表专家复核预览（2026-08-21）**:`tools/build_tcim_review_preview.py` → `tcim_review_preview.html`（10 题 × 5 表可读校对页，含 slot/锚点/优先级/探查/停止，无 AI 改写）。
  - **RAG V0.1（2026-08-21）**:`tcim/modules/rag/rag.js` + 网页 `ragDecision()`。默认 R0 不调用；仅 `VITE_TCIM_RAG=1` 且核心槽缺口大时触发 R1/R2 关键词检索；权限门 DIAGNOSE_INTERNAL 不 teacher-facing；**RAG 不写 Evidence**（测试证明）。测试 `tcim/tests/rag.test.js`。
  - **当前状态**:第一阶段全部 6 Task + 前测接入 + PRDM 措辞 + 专家复核预览 + RAG V0.1 完成。网页默认 `VITE_TCIM_MODE=ont`（确定性访谈）；切 `legacy` 即恢复 LLM 提示词访谈。RAG 默认关（`VITE_TCIM_RAG=1` 开启）。待办：真实教师试用、专家正式复核 5 表、PRDM/RAG 消融对比。
- **2026-08-23 证据判断改 LLM · Step 1（据 `DOC/AI应用质疑及说明.zip`：《TCIM_AI调用与工程责任表》A01/A02 + 《TCIM中的AI作用》AI核心智能定性）**:研究团队把 TCIM 重新定义为「AI 驱动的专业谈话智能系统」，其中最有争议的一处是 Evidence 判断由谁主导。经评估当前权属红线已守住，缺的是「用 LLM 做语义层」而非「用 LLM 写状态」，属同向增量。
  - **Step 1 落地（LLM 语义预筛 + 确定性裁决）**:`tcim/modules/evidence_semantic/evidence_semantic.js`（新增，A01 纯函数：`setProvider/analyze/validateProposal/normalizeProposal`）。LLM **只出 Proposal**（candidate_spans/candidate_slots/conflict_candidates/no_change_reasons，span 必须回指原话、拦截能力/人格判定词 G05），**裁决权仍在确定性 `EvidenceUpdater`**（锚点命中 + span 回指 + G04/G05），语义信号只透传进 `diagnostics`/`replay`、**不改 evidence_state 的 level**。默认离线 provider=空 Proposal，行为与未接入逐字节一致。
  - **改动**：`game_support_ontology.js`（process 后接 analyze，version→v0.1.1）；`web/src/core/tcim/engine.js`（复刻 setSemanticProvider/analyzeSemantic，SemanticEvent 入 replay，processTeacherTurn 改 async）；`InterviewView.vue`（tcimFirstQuestion/tcimNext async+await）；`engine.test.mjs`（外层包 async run）。新增 `tcim/tests/evidence_semantic.test.js`。
  - **验证（全部通过）**:ontology/stress(升级=6/冲突=0/泄露=0/低教师=0，基线未变)/orchestration/contracts/rag + evidence_semantic + web smoke 10/10。
  - **Step 1b · 真实 LLM provider 握手（2026-08-23）**:`cloudfunctions/gsyg_semanticProbe/`（新增，A01 语义端点，严格 JSON Proposal + `LLM_PROFILES` wxai/openai-compatible + 服务端 G04/G05 拦截 + 失败/低置信→空 proposal）+ `cloudfunctions/gsyg_webGateway/index.js` ACTIONS 增 `semanticProbe` + `web/src/services/semanticLLM.js`（`makeSemanticProvider()` 经 `callGateway('semanticProbe',…)` 调云端、任一失败回退空 Proposal、`registerSemanticProvider()` 静态注入 `engine.setSemanticProvider`）+ `web/src/core/tcim/semantic.test.mjs`（离线无事件/合法入replay不改level/幻觉不入replay/抛错回退）。`InterviewView.vue` setup `if (tcimEnabled) registerSemanticProvider()`。
  - **Step 1b 验证（全部通过）**:web build OK(Vite)；web semantic.test；node 全量（升级=6/冲突=0/泄露=0/低教师=0，基线未变）；web smoke 10/10。
  - **Step 1b 边界（须知）**:逻辑+构建已验证，**未实调云端**——本开发环境无 LLM API Key、云函数需上传部署。生效需：配 `SEMANTIC_PROFILE`/`DEEPSEEK_API_KEY`/`WXAI_*` 视所选 provider、网关 `GSYG_WEB_GATEWAY_TOKEN`/`GSYG_WEB_SESSION_SECRET`；部署 `gsyg_semanticProbe`（云端装依赖）+ 重传 `gsyg_webGateway`（白名单）+ 重建网页。语义层默认 `SEC_CHECK` 关，如需可开。**红线不变**：语义 provider 永不写 evidence_state/永不判 level，level 只由 `updateEvidence` 锚点命中决定。
  - **评估与 3 步路线**:详见 `docs/tcim/EVIDENCE_LLM_ASSESSMENT.md`。Step2（bigram+LLM 合成评级，写权仍在 Ontology）/ Step3（A01/A02 语义主导+A09，会重定义「AI 不参与打分」红线，须先与团队对齐）。
  - **2026-08-24 关键修正/AI 介入定性（据研究团队补充说明 *2 + 代码核对）**:研究团队判定当前**AI 未真正介入 Evidence 判断**——系统存在两条互不相干的判断链：bigram 先写 Evidence，LLM 事后只进 diagnostics/replay 无决策力。这不是「AI 能力不足」，而是「AI 没进主路径」。且此为「两个事实来源」比没有 AI 更危险（Replay 显示 AI 识别了但 Evidence 未更新，会误导）。**结论（修正此前 Step 3=重定义红线判断）**：让 LLM 驱动 Evidence 不违反「计分/筛题是确定性程序」红线——Evidence State 是访谈内部工作记忆、非打分；分数仍查表、R/P/G 仍服务端确定性 advisor。**下一步方向**：把 A01 由「旁路建议」改为「主干判定」——LLM 在 `updateEvidence` 前出 Proposal，Ontology 只做 Validator(不重新用 bigram 裁决)，统一提交路径，Replay 记模型版/Prompt版/Proposal/验证结果/状态对比，新增 `TCIM_SEMANTIC_MODE=required|fallback_allowed|shadow|disabled`。设独立 Gate：Q8 多 Slot+隐含机制案例中真实 LLM Proposal 过验证后能更新 Evidence 并改变下一 ProfessionalAction，关 LLM 明显退化而打分/筛题不变。详见 `docs/tcim/AI_INTERVENTION_VERDICT.txt`(第六~九节)。
  - **2026-08-24 V0.2 迁移落地（据 `第一批.zip` 8 份 V0.2 docx，编码前冻结基线）**:决策中心从「五表主导、AI 分析和表达」改为「AI 基于教师完整资料形成情境理解并规划低风险行动；Ontology/五表提供专业参考和验证；Orchestrator 完成风险审查与正式提交」。**不推倒现有模块**，调整决策中心。
    - **新增能力/模块（Node+网页共享单一真源，ESM 命名空间导入 `tcim/modules` CJS）**:`contextual_belief_state`(owner=belief_manager, 与 Evidence 并列, 可表外/BELIEF_OPS)/`teacher_model.js`(A00 ContextInterpretationProposal + 派生只读快照)/`agent_planner.js`(A03 planDecision, 可插拔 chooseAction)/`decision_gate.js`(A04 validateDecision, APPROVE/CLARIFY/REJECT, 不重做选择)/`challenge_queue.js`(A12)。`contracts.js` 增 `TABLE_ALIGNMENT/POLICY_CLASS/RISK_LEVEL` 枚举；`evidence_state.js` 枚举冻结(UNKNOWN/null、NOT_DEMONSTRATED/0、PARTIAL/1、SUFFICIENT/2、HIGH_QUALITY/3, 不再 0/UNKNOWN)。
    - **双状态链(`game_support_ontology.js process()`)**:A01 语义→A02 Evidence(validator/committer)→A02B Belief→TeacherModel 快照→A03 Planner→A04 Gate→A12 Challenge,`buildReplay` 记 6 阶段。`firstQuestion`(网页 engine)走 A00→A03→A04 生成首问。
    - **云函数**:`gsyg_planner`(A03/A04, LLM_PROFILES wxai/deepseek/openai-compatible+Gate, `planner_core.js` 纯逻辑可测)+ `gsyg_semanticProbe`(A00/A01)+ 网关 `ACTIONS` 含 `semanticProbe`+`planner`。网页 provider `semanticLLM.js`/`plannerLLM.js`(网关可用走 cloud, 缺则回退本地确定性/空, 永不抛错)。`TCIM_SEMANTIC_MODE` 贯穿(Node env + web VITE).
    - **测试**:`tcim/tests/v2_{belief,teacher_model,planner_gate,double_state,challenge_policy}` + `cloudfunctions/{gsyg_semanticProbe/semantic_core,gsyg_planner/planner_core}.test.js` + web `engine.test.mjs(10/10)`/`semantic.test.mjs`。基线 `disabled` 6/720/0冲突/low=0 不变。
    - **部署/验收(未实调真实 LLM)**:架构与分层验收见 `docs/tcim/V0.2_MIGRATION_AND_DEPLOYMENT.md`；**操作者执行清单见 `docs/tcim/DEPLOYMENT_RUNBOOK.md`**(云函数上传/环境变量/网关/网页 `.env`(`VITE_TCIM_V2=1`+`VITE_TCIM_SEMANTIC_MODE=fallback_allowed`)/本地验证命令/云函数冒烟/网关检查/失败排查表)。真实语义/规划准确率需部署 + 配 key 后跑 Q8 人工核验。
    - **⚠️ 网页 V0.2 构建须处理 CJS 导入（2026-08-24，`module is not defined` 坑）**:网页 `engine.js` 以 ESM 命名空间导入仓库 `tcim/modules/*.js`(**CJS 源码**，belief_state/teacher_model/agent_planner/decision_gate/challenge_queue/prdm_v2/knowledge_need/evidence_updater)。这些模块会 require `tcim/core/*.js`(如 `contracts.js`)。Vite 默认**不转换 node_modules 之外的源码**→ `module.exports` 残留浏览器包 → 运行时崩溃。必须：① `web/vite.config.js` 含 `build.commonjsOptions.include: [/tcim\/[a-z]+\//, /node_modules/]`(**覆盖整个 `tcim/` 树 core+modules**，仅 modules 会漏 core/contracts.js)；② 导入回退用 `ns.default || ns`，**勿用 `ns['module.exports']`**(会被 minifier 改写成裸 `module`)。验证：`npm run build` 后 `dist/assets/index-*.js` 的 `module.exports` 出现次数=0。详见 `DEPLOYMENT_RUNBOOK.md` §4.1。
    - **2026-08-24 第二批 V0.2 追加 · PRDM/RAG 收紧（据 `第二批.zip` 5 份 docx，与第一批 V0.2 一致，仅接线修正）**:PRDM 拆成 **A06 observe**(TurnResolutionSnapshot 后、Planner 前，输出 InteractionSignalSnapshot，**禁止** next_target_slot/recommended_action_type/stop_decision/人格能力心理标签)+ **A07 plan**(已提交 Action 后，输出 DialoguePlan 只含互动参数，**不做文本生成**、不改 target/objective/probe_strategy、绑定 fingerprint、无有效 fingerprint 则返回 null 门禁)。`prdm_v2.js`(observe/plan/FORBIDDEN_OBS)；网页 `engine.js` 移除 `prdmWording`(A08 Generator 是唯一教师文本点)+ 删 V0.1 prdmPlan/ragDecision 死代码。RAG 改 **Planner 驱动的 KnowledgeNeedProposal**(`knowledge_need.js` decideKnowledgeNeed/validateProposal,need 需 gap/expected_use/route_ceiling/phase,默认克制 R0)；网页 `ragDecision`→`decideKnowledgeNeed`。新增测试 `v2_prdm.test.js`/`v2_rag.test.js`。基线 6/720 不变,红线(G05/泄露/PRDM 不写证据/改目标)全遵守。
    - **2026-08-25 S6 补齐数据迁移（据研究团队《S6补齐Excel替换_配置重载与兼容检查说明_V0.2.doc》+ 3 个 xlsx）**:补表2/表4/表5 的 **S6 悬空引用**(表1 早有 Qx-S6,但表2/4/5 缺 S6,导致无法评分/发问/剪枝)。**非架构重写**；S6 = 可选可执行分支(表1 标 `可选`,运行时 core:false → 不进整题最低停止门槛)。**数据源 = `DOC/tcim_5tables_v02_s6/`**(表1/3 旧 zip 原样 + 表2/4/5 S6 补齐 V0.2 混装)。**生成器修复**:新 xlsx 用 **sharedStrings(t='s') + 默认命名空间**,旧表是内联字面量 + `x:` 命名空间——`build_tcim_data.py` 的 `extract_sheets` 改为命名空间无关 + 解析 sharedStrings,才能读新文件。**已重生成** `tcim/professional_data`(10 题 S6 跨表闭环:表1 Qx-S6 能 Join 表2/4/5,每张恰好 1 条)+ `web/src/generated/tcim-data.js`。复现:`python tools/build_tcim_data.py DOC/tcim_5tables_v02_s6 tcim/professional_data/game_support` 后 `node tools/build_tcim_web_data.mjs`。**验证**:全 13 项 TCIM 测试 + web smoke 10/10 + build OK + **基线 6/720 / 0 冲突 / low=0 不变**(S6 可选不改变核心 S1-S5 链)。
- **2026-07-30 网页端 OpenAI 官方 GPT-5.6 Sol 接入预备（尚未启用生产）**:`gsyg_interviewChat` 新增 `openai-official` profile，endpoint 固定为 `https://api.openai.com/v1/responses`，默认模型 `gpt-5.6-sol`、`reasoning.effort=high`，并用严格 JSON Schema 约束单轮访谈决策输出；请求设 `store:false`。官方 Key 只读云函数环境变量 `OPENAI_API_KEY`，严禁进入前端、GitHub 或聊天记录；网页可通过 `WEB_INTERVIEW_LLM_PROFILE=openai-official` 启用，小程序仍不传 profile、继续走 `wxai`。部署前需额外运行 `node tools/verify_openai_official.js`。**当前 CloudBase 位于上海区，而中国大陆不在 OpenAI API 支持地区名单中，因此生产默认仍保留原 profile，不得在上海环境直接启用官方通道；必须先确认部署位置与实际服务对象均符合 OpenAI 地区政策。**
- **2026-07-31 / 2026-08-03 网页访谈生成超时与失败审计修复**:线上日志确认模型会在约 19–38 秒成功生成，但 `gsyg_webGateway` 内部调用在 15 秒先报 `request timeout`，导致网页误报“问题没有生成”。最初仅把 `timeout:65000` 放进 `cloud.callFunction` 参数对象仍未生效：`wx-server-sdk` 4.x 当前 provider 路径会丢弃该字段，底层继续采用初始化时的 15 秒默认值。最终修复为普通业务与访谈分别初始化 CloudBase SDK 实例（15 秒 / 65 秒），按函数名路由调用；网关函数自身超时须至少 70 秒。网页 `InterviewView` 另保留每次失败的时间、耗时、阶段、教师回答轮数和错误码到 `generationFailures[]`，即使教师随后主动结束也不清空历史。此次不改提示词、模型、轮数与访谈流程。正式构建必须保留已纳入版本管理的 `web/.env.production`（仅含公开的网关 URL、CloudBase 环境 ID 与区域，不含任何密钥），否则会显示“网页登录尚未配置”且无法调用访谈；部署前须校验构建产物中包含正式网关 URL 与环境 ID。
- **2026-07-31 网页模型对照试验改用 wxai**:对照7月18日后小程序访谈与网页最新 Q1 后，确认核心 V7 提示词未退化，但网页第三方 `openai-compatible`（模型标签 `gpt-5.5`）出现反复使用非教师原话“接住”、纠正后仍回写该概念、主线围绕操作细节打转，以及一次 `done=false` 却缺少 `next_question` 的协议失败。为控制变量，正式网页的 `web/.env.production` 现显式设置 `VITE_INTERVIEW_LLM_PROFILE=wxai`，与小程序使用同一 CloudBase 内置模型；未修改提示词、知识库、轮数、结束规则或小程序。后续用相同排序和回答复测 Q1/Q5，并比较理解修复、张力追问、重复率、可读性与响应时间；如效果不佳可仅改此构建变量恢复原 profile。
- **2026-08-01 导出增加访谈模型审计字段**:`gsyg_exportData` 的“测验访谈汇总 / 访谈逐字稿 / 访谈编码”增加模型配置与实际模型信息；同时兼容小程序的 `turns` 和网页的 `messages`，避免网页逐字稿在整理版 Excel 中为空。网页以后把每次 AI 回复的 `llmProfile` / `llmModel` 写入该条 message，若中途切换模型仍可逐条追溯；本地失败收束明确标为“未调用大模型”。历史数据没有模型字段时标注“历史数据未记录”，禁止按时间或平台猜测。
- **2026-08-01 Kimi K3 对照试验预备**:`gsyg_interviewChat` 新增独立 `kimi-k3` profile，固定使用 Kimi 官方 `https://api.moonshot.ai/v1/chat/completions` 与模型 `kimi-k3`，Key 只读 `MOONSHOT_API_KEY`。按官方 K3 参数限制不发送 temperature，默认 `reasoning_effort=high`、`max_completion_tokens=4000`，并用 strict JSON Schema 约束访谈决策输出。当前网页仍保持 `wxai`，未取得并安全配置 Key 前不得切换；切换时只改网页 `VITE_INTERVIEW_LLM_PROFILE=kimi-k3`，小程序不变。若真实响应偏慢，优先把 `KIMI_REASONING_EFFORT` 降为 `low`，不改访谈提示词。
- **2026-08-03 网页启用 Kimi K3 国内接口**:实测用户提供的 Kimi 国内平台 Key 在国际接口 `api.moonshot.ai` 返回 401，而在国内官方接口 `api.moonshot.cn` 验证成功且模型列表包含 `kimi-k3`；因此 `kimi-k3` profile 改为 `https://api.moonshot.cn/v1/chat/completions`。正式网页构建变量切换为 `VITE_INTERVIEW_LLM_PROFILE=kimi-k3`，小程序仍不传 profile、继续使用 `wxai`。Key 仅存云函数环境变量 `MOONSHOT_API_KEY`，不得写入仓库、前端或日志。
- **2026-08-03 恢复网页端不向教师显示测评分数**:内部确定性计分、`session.scores` 与后端上报保持不变，继续用于访谈情境遴选和研究数据；教师可见网页移除总分、能力等级、逐题分数、历史记录分数摘要和「看评分」入口。答题提交后的原评分路由只作为无分数的「测评已完成」确认页；作答回看不显示单题得分，访谈完成页不提供评分回看。后续切换模型或部署访谈版本时必须以此教师端基线构建，不得再次发布含评分展示的旧前端。
- **2026-08-03 网页上一版账号与 Nora 导出机制恢复，并与 Kimi 非破坏性合并**:云端历史构建 `index-C7O-JyYA.js` 证明上一版曾包含“我的”页登录设置、退出后本机记录归档/可选清除、退出状态页、Nora 管理员直接导出及网站研究数据 Excel/JSON 双导出；这些改动此前未进入 Git 提交，后续从分支重新构建时被覆盖。现已将其正式还原到源码，同时保留 Kimi K3、V7.4、生成失败重试、65 秒访谈上游等待和教师端不显示评分。`gsyg_webGateway` 白名单新增 `whoami/exportData`；`gsyg_whoami` 与 `gsyg_exportData` 支持经共享令牌验证的 `web:<UID>` actor；网页导出只含 `openid` 以 `web:` 开头的网站参与者，小程序管理员原导出范围不变。**管理员权限只读取数据库 `isAdmin=true`，不得再按可自行填写的姓名自动授权**；现有 Nora 网页账号已核对为管理员，因此其直接导出体验不变。以后不得用旧分支或整包覆盖上述账号/管理员机制；模型切换只改受控 profile 与服务端环境变量。
- **2026-08-12 网页端临时单题深度访谈（固定Q4）**:正式“10题→确定性筛3题→访谈”流程保持不变；网页首页新增独立“临时单题试访”入口，当前服务端白名单固定 `Q4 未参与小组建构`。会话写入 `studyMode='single_trial'`、`targetItemId='Q4'`，答题页仅加载Q4，提交后 `gsyg_selectFinal` 不运行R/P/G算法，而是依据数据库中已保存的Q4作答直接生成该题完整任务卡；客户端不能在select调用中临时指定其他题。访谈列表和完成页按实际情境数计算（本模式1/1），记录、作答回看、sessions/interviews导出原始字段均保留单题标记。以后换Q5/Q9时须同时修改前端入口白名单与 `gsyg_reportSession`、`gsyg_reportInterview`、`gsyg_selectFinal` 的服务端固定题号，并重新构建网页、重部署这三个云函数。
- **2026-08-19 临时单题模块下线**:网页首页移除“临时单题试访”入口，个人资料页不再通过 `next=single-trial` 创建单题会话，教师端历史记录列表不再展示 `studyMode='single_trial'` 的临时记录；恢复仅提供正式“10题→确定性筛3题→访谈”流程。既有单题 sessions/interviews 及导出数据全部保留，不删除数据库记录；后端单题兼容逻辑暂保留，仅用于历史数据可追溯，不再向教师提供新入口。
- **2026-08-20 网页访谈情境列表改显示题目原文**:教师端“AI 访谈情境”三张卡片不再展示服务端遴选结果中的 `interview_focus`（内部筛选/访谈关注点），统一按题号从 canonical 题库读取并展示完整 `stem` 情境原文；此次仅改变列表呈现，不修改确定性筛题结果、访谈任务卡、提示词或历史数据。
- **2026-08-20 10题赋分替换为0817新版**:以研究团队《000 10题赋分 新调整0817.xlsx》为唯一赋分来源，完整替换10题×24排列共240个确定性映射；较上一版共112处变化（Q1/Q5/Q6不变，Q2改2处，Q3/Q4/Q7-Q10改110处）。同步更新小程序/web canonical `scoreTable.js`、网页生成数据、Node筛题端口与Python参考程序；AI仍不参与评分。已有 `selection` 继续沿用历史缓存，避免已完成/进行中的访谈题目被追溯改写；无既有遴选结果的新会话按0817新版计分和筛题。过程常模仅由日志行为指标组成，不因赋分变化重建。
- **2026-08-20 网页端改为正式账号密码登录 + 自助注册**:网页不再用 CloudBase 匿名身份自动登录，改为正式账号；教师可用“用户名 + 邮箱验证码 + 密码”自行注册，之后支持用户名或邮箱配合密码登录。未登录首页默认展示登录表单，除顶部“登录/注册”切换外，登录按钮下方必须保留醒目的“首次使用？立即注册”入口。姓名只保留为个人资料字段，登录页不再解释姓名与凭证的关系；姓名绝不用于识别账号或授予管理员权限。`gsyg_webGateway` 会从 CloudBase `/auth/v1/user/me` 同时验证 UID 与非匿名账号证据，匿名 token 一律拒绝；会话版本升至 v2、`identityType='web_account'`，旧匿名 Cookie 自动失效。管理员仍只按新账号对应的 `web:<UID>` 在 `gsyg_teachers.isAdmin=true` 判定。浏览器本地 profile/sessions 按账号 UID 保存与恢复；首次切换时旧匿名活动数据只归档、不自动挂到新账号，防止共用浏览器串号。上线前必须在 CloudBase 开启用户名密码登录和邮箱验证码注册；Nora 完成正式账号注册后把其新 UID 的 teacher 记录设为管理员，不得按姓名迁移权限。历史匿名数据保留，不自动合并到新账号。
- **2026-08-28 合并 `web-interview-v7` 到 main（本地后已 push）**:把 v7 分支（注册/测试/选题/账号 → 002238a 版）与 main 的 TCIM V0.2 访谈合并。**注册/测试/选题**随合并自动落到 v7 版（main 从没改过这些文件）；**访谈**保留 main 的 TCIM 引擎（legacy LLM 兜底），只把 v7 的 `generationFailures` 生成失败审计嫁接进 `InterviewView.vue`（main 原版接口没有该字段，但 main 自带 `verify-interview-v7.mjs` 强校验它，故须嫁接才能过）。`CLAUDE.md` 合并了双边的延期笔记。验证：web verify（240 排列对拍 + V7.4）+ build + TCIM smoke 10/10 全过。
- **2026-08-28 修复访谈“复读同一句”死循环（`gsyg_interviewChat` 的 `buildGroundedRecoveryQuestion`）**:线上反馈 AI 反复问“您刚才说[X]，您为什么会特别看重这一点？”，连老师回“不要这样问了”仍继续。**根因**：该恢复函数只在模型调用失败/质量保护触发时才启用（catch 或用语问题），它取教师**最新一条**实质原话作引语锚点，每轮教师的新输入（哪怕是不满）都会改变锚点，使“精确去重”永远判定为新问题；而默认候选永远是“为什么特别看重”，于是循环复读。且 `isStrongFrustrationText`/`isExplicitStopText` 不认“不要这样问了/好奇怪/为什么只会问/重复”，不满被当成内容引用。**修复**：① 检测到对“提问方式”本身的不满（重复/复读/为什么只会问/好奇怪/不要这样问/换个问法）→ 立即吸收并安全收束，不再当锚点追问（注意别把幼儿游戏里正常“重复”术语误判，故不匹配裸“重复”）；② 默认候选不再以“为什么特别看重”开头，改为轮换“带来什么/什么情况不同/最想先帮助解决什么”；③ 新增 `coreQuestionMove` 剥离“您刚才说…、”承接壳，对近 3 轮 AI 问题做**落点级去重**，换锚点也不再复读。**还须排查的根因**：该循环暴露“模型每轮调用都失败”这一上游问题（恢复路径只是降级承接），需查 `gsyg_interviewChat` 的模型配置/超时/JSON 解析（`WXAI_MODEL`/`LLM_TIMEOUT_MS`/密钥），否则教师会一直拿到降级问题直到收束。验证：`verify_interview_resilience.js` 16/16（含 3 项新增）、`verify_interview_v7.js` 13/13、web `verify-interview-v7` 通过。**生产生效需重传 `gsyg_interviewChat` 云函数**。
- **2026-08-28 访谈连续降级的真正根因（wx-server-sdk 版本）**:线上访谈每轮都走恢复路径，云函数日志 `recoveryError:"wxai 缺失：cloud.ai / cloud.extend.AI 均不可用"` + `llmProfile:"wxai"`。**根因**：`cloudfunctions/gsyg_interviewChat/package.json` 把 `wx-server-sdk` 锁在 **`~2.6.3`**，而微信云开发 AI / CloudBase AI 的 `cloud.ai` 只在 **wx-server-sdk ≥ 4.x** 才有（当年已踩过并写明在 CLAUDE.md）。2.6.3 下 `callWxAI` 找不到 `cloud.ai`/`cloud.extend.AI` → 每次必抛 → 降级复读。**修复**：`wx-server-sdk` 升到 **`^4.0.2`**（package.json + package-lock.json 已更新，resilience/v7/web 三项验证仍全过）。**生产生效必须**：用「云端安装依赖」重传 `gsyg_interviewChat`（装 4.x）；函数运行时须 Node 18.15+（老函数升运行时只能删了重建）；并把环境变量 `WXAI_MODEL` 修正——当前日志显 `llmModel:"deepseek-v4-flash"` 与 wxai profile 不匹配，应设真实 wxai 模型（如 `hy3-preview`），或改走 deepseek profile 并让小程序传 `llmProfile=deepseek`（需另配 `DEEPSEEK_API_KEY`）。
- **2026-08-28 逐轮云端草稿机制（1.3）**:浏览器本地 `localStorage` 只作离线副本，研究数据唯一来源是服务端。新增**每轮**把访谈回答幂等 upsert 到云端，让服务端知道进行中的访谈（清缓存/换设备/账号切换/未走到结束条件也不丢）。实现：新建云函数 `cloudfunctions/gsyg_reportDraft/`（集合 `gsyg_interview_drafts`，按 `openid+sessionId+itemId` 幂等 upsert，`turnSeq` 乱序保护——旧一轮不覆盖新草稿，幂等返回）；`gsyg_webGateway` ACTIONS 增 `reportDraft`；web `InterviewView` 每次 persist 时 `syncDraft()`（按教师回答数 `turnSeq`，失败不阻断访谈仅 `console.warn`）；`gsyg_exportData` 增 `drafts` 集合导出（JSON `bundle.data.drafts` + `stats.drafts` 分 in_progress/done）。测试 `cloudfunctions/gsyg_reportDraft/test/draft.test.js`（新增/更新/乱序，通过）。**部署**：① 新建并部署 `gsyg_reportDraft`（云端装依赖）② 建集合 `gsyg_interview_drafts`（仅管理端）③ 重传 `gsyg_webGateway`（白名单）④ 重传 `gsyg_exportData` ⑤ 重建网页。跨设备恢复依赖持久账号（`web_account`），匿名 `web_anonymous` 按浏览器 UID 隔离。
- **2026-08-28 访谈上报载荷瘦身 + 结构化 413（1.4）**:访谈载荷随轮次/Replay 膨胀,曾触发网关 `express.json` 1MB 上限,前端拿到 HTML 413 还继续静默完成 → 丢数据。**修复**:① 前端上传去重——`api.js reportInterview` 用 `stripTranscriptForUpload` 剔除每条的 `tcimReplay`(与 `tcimSession.replay` 重复) 及 `tcimSession.history`(与 `messages` 重复),保留 `tcimSession.replay`(审计)+`messages`(逐字稿);`InterviewView.persist` 不再存 `tcimReplay`。② `reportInterview` 返回 meta `requestPayloadBytes`,前端写回 `session.reportPayloadBytes`,≥0.95MB 时 `console.warn` 提前告警。③ 网关 `gsyg_webGateway` 加 Express 错误中间件,把 `entity.too.large`/413 转成结构化 `{ok:false,error:'payload_too_large',httpStatus:413}`(不再是默认 HTML 或裸 `gateway_http_413`)。`smoke.test.js` 增 413 断言(`GSYG_WEB_MAX_BODY=2kb` 触发)全过。**部署**:重传 `gsyg_webGateway` + 重建网页。载荷若仍超限,前端会进入"待同步/重试"(1.2 已做),不再静默。
- **2026-08-28 倒计时归零自动收束（1.5）**:之前 web `InterviewView` 定时器只把 `remaining` 减到 0,不触发结束/保存/上报——老师见 00:00 离开,内容只留本机、没 `reportInterview`。**修复**:新增 `timeUpOnce()`——`remaining` **首次**到 0 且未 done/非回看时,只触发一次受控收束(`_timeUpClosed` 防重):写收束语「本情境的访谈时间已到…」进 messages、`done=true`、`persist(true)`(同步草稿+上报)、`clearInterval` 停走字;模板 `v-else-if="!done && !isReview"` 使输入区在 done 时被「本情境访谈已完成」替代(停止输入)。`onMounted` 恢复旧会话时若 `remaining<=0` 直接收束、不再生成新问。`verify_interview_resilience.js` 增 1.5 结构断言(17/17 通过)。纯前端改动,重建网页即可生效。
- **2026-08-28 访谈质量 P0 七项（据《访谈网站问题整理》）**:
  - **2.2 Planner 目标对齐**:`processTeacherTurn` 后续轮 `generateQuestion` 传入 `agentDecision.primary_target_slot`（此前仅首问传）；并修 `actionPlan.target_slot` 改为 `gen.target_slot`（此前取 `ranked[0]` 纯缺口排序,与教师可见问题不一致——Gate 批准目标必须与 Generator 目标一致）。
  - **2.1 Generator 承接教师回答**:`generateQuestion` 增 `teacherTurn`;槽选择用 `anchorHitsInTurn`（教师原话命中该槽锚点关键词数）在多个被命中槽间择优,优先承接教师刚说的点(而非跳到别的缺口);GenerationEvent 增加 `source_turn_id/anchor_span/followup_reason`。`teacherAnchorSpan` 取 ≤14 字命中引用供审计。
  - **2.3 语义锚点传递**:`analyzeSemantic` 传入 `anchorBySlot`（此前未传,云端 `semanticProbe` 收到空 anchors）。
  - **2.4 语义提示词矛盾**:`semantic_core.js` 【硬性禁止】改为区分「内部 JSON 字段名(proposed_level/confidence/slot_id 允许)」与「教师可见文本(不得出现 level/confidence/分数/标准答案/专家排序/R/P/G)」;校验器本身按字段校验已兼容。
  - **2.5 弱测试改造**:`engine.test.mjs` 增反事实依赖(不同回答→不同槽:Q1-S2 风险 vs Q1-S5 规则)与承接锚点(source_turn_id/anchor_span/followup_reason)断言,smoke 13/13。
  - **2.6 兜底库去重**:`safeBank` 选句前按全历史逐字去重(都用尽才按轮次轮换)。
  - **2.7 本地出题不掩盖失联**:`semanticLLM.js` 导出响应式 `cloudHealth`(每次 semanticProbe 成功/失败/禁用都记 ok/lastError/updatedAt);`InterviewView` 顶部加常驻同步状态条(云端连接正常 / 云端服务暂不可用+错误码),不再用「下一问生成成功」推断云端正常。
  - **验证**:engine smoke 13/13、web build、web verify(240+V7.4)、semantic.test、resilience 17/17、node v7 13/13、semantic_core.test 全过。**部署**:语义层改动需重传 `gsyg_semanticProbe`;其余 web 引擎/前端改动重建网页即可。
- **2026-08-28 报告页（确定性能力画像报告，v1）**:设计文档 §9 P12–P15 的报告页此前"本期未做"，本次补齐。**定位**：纯前端确定性整理（AI 不参与评分/判断），只做「分数定位 + 过程解释 + 访谈证据回填」；每条可回溯到题目/过程标签/访谈原话；不暴露标准排序/专家答案/评分规则；非评判（用「优势点/发展点」）。
  - **`web/src/core/report.js`**（纯函数 `buildReport(session)`）：三级指标（A1/A2/A3/B1/B2/C1/C2）水平按 `INDICATOR_MAP` 主(1.0)/次(0.5)加权聚合→0-4；二级 A/B/C 取所属三级平均；过程解释（用时/改动/摇摆，非评判）；访谈证据回填（每已访谈情境→主指标+ability_focus+教师原话引用）；学习建议（对得分<1.5 的三级指标给可观察/可行动方向，对齐 observation_points）。
  - **`web/src/views/ReportView.vue`**：测验概览、7 轴 SVG 雷达（纯 SVG 无依赖）、二级解读（A/B/C + 优势/发展点）、三级指标展开、访谈证据回填、学习建议。强调"内容为分数/维度/证据，不暴露评分规则"。
  - **路由/入口**：`main.js` 加 `/report/:sid`；`ScoreView` 加「查看能力画像报告」按钮。
  - **测试**：`web/src/core/report.test.mjs`（7 指标/二级 0-4/过程/证据含原话/建议非评判），通过。验证：report + engine smoke 13/13 + resilience 17/17 + node v7 13/13 + web build + web verify(240+V7.4) 全过。
  - **简版（须知）**：§9 的完整「三源融合 + 常模定位 + P-IVI」是研究侧算法，不在本模块；此 v1 用确定性数据量化 + 访谈证据回填，后续可接常模/LLM 叙述增强。
- **2026-08-28 数据安全可靠性硬化（乱序保护 + 回执门卫 + 幂等测试）**:据《访谈网站问题整理》总体建议。**乱序保护**：`gsyg_reportInterview` 增加 `revision`（客户端每次上报自增 `session.reportRevision`，api.js 随 payload 下发）；云函数对比 `stored.reportRevision`，`incoming < stored` 即 `{ok:true, staleRejected:true}` 返回既有回执、**不覆盖**（防旧报告晚到覆盖新报告）。`InterviewView.reportCompletion`/`FeedbackView.submit`/`DoneView.retry` 上报前均自增 revision。**回执门卫**：`DoneView.receiptOk()` 需 `serverRecordId + serverUpdatedAt + payloadHash` 三字段全在才显示「云端已保存」，否则「待同步」+ 可重试（此前已实现,现与 revision 保护衔接）。**测试**：新增 `cloudfunctions/gsyg_reportInterview/test/reportInterview.test.js`（add/update/stale-reject/forbidden/idempotent 不重复建档,5 项通过）。**部署**：重传 `gsyg_reportInterview`（改过）；前端重建网页。
- **2026-08-28 报告页收尾：历史报告入口（P15 简版）**:报告此前只在提交结果页 `ScoreView` 可达,老师之后从记录列表(HomeView)回来无法再看报告,报告族不闭环。**补**：① `HomeView` 每条已完成记录卡加「看报告」按钮(`/report/:sid`);② `ReportView` 底部加「历史报告」区,用 `listSessions()` 列出该教师其他已完成报告(均分/情境数)并可点击跳转,支持顺着记录看成长轨迹。**验证**：report.test、engine 13/13、resilience 17/17、node v7 13/13、draft/reportInterview 云函数测试、web build、web verify(240+V7.4) 全过。纯前端,重建网页生效。后续可再做「跨次成长对比(两次报告三级指标差异)」与「报告导出 PDF/DOC(服务端)」——v1 数据报告已闭环,这两项为增量。
- **2026-08-28 报告族增强：跨次成长对比 + 报告导出**（报告页增量）:① `report.js` 增 `compareReports(a,b)`——对两份报告的三级指标算逐项差异 + 提升/变化摘要（确定性、非评判"提升/关注点"呈现）；`ReportView` 若当前会话之前存在已完成报告,显示「与上次对比」卡片（△/▲/稳定）。② `report.js` 增 `buildReportText(report)`——生成 Markdown 报告文本；`ReportView` 头部加「导出」按钮（客户端 Blob 下载 `.md`,无服务端、非 AI）。**验证**：report.test 10/10（增跨次对比、导出两断言）、web build、web verify(240+V7.4) 通过。纯前端,重建网页生效。**后续**：报告导出的 PDF/DOC（服务端）、以及 §9 完整「三源融合+常模定位」仍为研究侧算法（不在本模块）。
- **2026-08-28 测试硬化：问句闭环 + 结束一致性**（《问题整理》总体建议）:① **问句闭环**——engine.test.mjs 断言"内容意义不同的教师回答 → 最终问句文本与目标槽都不同"（不只换模板序号）；② **结束一致性**——断言 done 时收束语同时进入 `session.history`、作为返回 question、并写入恢复 `GenerationEvent(action_type:'CLOSE')`，三者一致。engine smoke 13/13→15/15。**确认已闭环的"待办"**：Excel→JSON 导入脚本（`tools/build_*.js` 生成器 + `tools/validate_data.js` 全程一致性校验：题号四处一致 Q1-Q10/24×10 值域/knowledge 引用完整）、AI 访谈系统提示词模板（`gsyg_interviewChat` V7.4 决策程序）。**仍未做(研究侧/外部,非本模块)**：§9 完整「三源融合+常模定位」、赋分表 24 行排列口径（需研究团队确认）。
- **2026-08-28 修复能力（TCCIM 网页引擎）**:《问题整理》总体建议——教师输入"不是，我的意思是…/没听懂/你没理解"等纠正/澄清/听懂信号时，下一轮应先接住并重述，而不是照常进入下一模板。**实现**：`engine.js` 加 `isRepairTurn`（`REPAIR_RE` 匹配"不是我的意思/我说的是/没听懂/你理解吗/重说/换个说法/意思是这样"等；"是不是"这类正常表述不误判）+ `repairQuestion`（生成"我可能没理解准确，您是想说…吗？"，引用≤14 字且过滤泄露词/标点）+ 在 `processTeacherTurn` 生成 `gen` 后检测到修复信号则覆盖为修复问句（probe_strategy='澄清修复'，followup_reason='teacher_repair'），仍走 `checkConstraints` 兜底。**测试**：engine.test.mjs 增"修复信号→teacher_repair 问句"+"正常回答不误判"，engine smoke 15/15→17/17。纯前端,重建网页生效。
- **2026-08-28 报告"三源融合(简版)"来源标签**:每个三级指标标注「测评 + 访谈」或「测评定位为主」——凡有访谈证据(该指标为某已访谈情境主指标且有教师原话引用)即标"测评+访谈",否则"测评为主";向 §9「三源融合:一致增强、不一致解释」的呈现靠拢(仍是确定性,非研究侧常模算法)。`report.js` tertiary 加 `source`;`ReportView` 每条三级指标加来源标签;`report.test.mjs` 增来源断言。
- **2026-08-28 小程序 AI 访谈对齐 web（全量 TCIM 移植）**:此前小程序访谈用旧 13 表规则脚本队列 + 云 LLM 兜底，与 web（TCIM 确定性引擎）两套内核。已把小程序对齐到 web 的 TCIM 确定性访谈：`miniprogram/utils/tcim/engine.js` 是 web 引擎经 esbuild 打包的**自包含 CJS**（内联 engine + tcim/core + tcim/modules + tcim-data；语义层在 wx 下自动降级为 bigram 证据；`import.meta` 已被 esbuild 换成安全 `var import_meta={}`）；`miniprogram/utils/tcimInterview.js` 包装 `init/first/next`（镜像 web InterviewView 的 tcimFirstQuestion/tcimNext）；`pages/interview/interview.js` 的 `startLive`（QCIM init + 前测 prior）+ `askNext`（首问/后续走引擎，去云 LLM/规则队列）+ `finalize`（TCIM 不再叠旧 stopScript/codeLevel）+ `persist`（存 `tcimSession` 供研究/回看）。**构建**：`tools/build_miniprogram_tcim.mjs`（esbuild）从 web 引擎单点生成，不fork共享源码。**一致性校验**：`tools/verify_tcim_parity.mjs` 断言 web(ESM)/小程序(CJS) 同输入 4 轮逐问一致（Q1-S3→S2→S3→S5），通过。引擎 smoke 17/17、resilience 17/17、v7 13/13、report、web build/verify 全过；小程序页面 `node --check` 通过。**仍须知**：小程序真机/开发者工具需实测（本环境无法跑 wx）；引擎产物 `miniprogram/utils/tcim/engine.js` 由 esbuild 生成，改 `web/src/core/tcim/engine.js` 或 `tcim/` 后须重跑 `node tools/build_miniprogram_tcim.mjs`。
- **2026-08-28 小程序访谈展示层对齐 web**:whitelab 核对 `pages/interview/{js,wxml,wxss}` 与 web `InterviewView.vue` 展示差异并补齐：①消息气泡加时间戳（`pushMsg` 带 `ts`+`timeText`，bub 内 `.mt` 小字）；②教师头像 `师`→`我`（与 web 一致）；③“正在思考追问…”→“正在整理下一问…”，输入占位“说说你的想法…”→“请输入您的回答…”；④完成页 `done-title`“本情境访谈已完成”+ 按钮“返回情境列表”（对齐 web chat-complete）。**未对齐(有意)**：web 的 cloud-health 同步横幅（面向 A01 语义层；小程序 TCIM 为本地引擎、无语义调用，显示会误导故不加）；web 的案例可折叠 `<details>` 与“本人排序：A＞B＞C＞D”摘要行（小程序用有序选项卡呈现排序，等效）。JS `node --check` 过、parity 过、engine 17/17。纯前端,重建小程序即可。
- **2026-08-28 小程序接入 V0.2 + 语义层（对齐 web `VITE_TCIM_V2=1` + `SEMANTIC_MODE=fallback_allowed`）**:此前小程序只对齐到 V0.1 纯确定性；现已补上 V0.2 双状态链 + A01 语义（LLM）。**实现**：① `web/src/core/tcim/engine.js` 增 `setV2Enabled(v)`（`V2_ENABLED` const→let，加法改动，web 仍由 env 驱动，不调用即不影响）；② 新增 `miniprogram/utils/tcimSemantic.js` —— A01 语义 provider，直接 `wx.cloud.callFunction('gsyg_semanticProbe', {itemId,teacherTurn,turnId,anchors,evidenceSummary,questionTitle})`（semanticProbe 云函数不校验身份、天然支持小程序 OPENID；**不经网关**；不入 pendingReports——是瞬时调用；含 G04 span 回指 + G05 能力词过滤 + 失败回退空 Proposal）；③ `tcimInterview.js init()` 调 `setV2Enabled(true)`+`setSemanticMode('fallback_allowed')`+`setSemanticProvider(tcimSemanticProvider)`；④ 重跑 `tools/build_miniprogram_tcim.mjs`（esbuild CJS，改用 esbuild 的 JS API，修 windows `.bin/esbuild` ENOENT）。**验证**：mock wx.cloud 端到端——教师回答→A01 语义识别 Q1-S2→证据 level 2（SUFFICIENT），`isV2Enabled()=true`；`tcimSemantic.test.js` 5/5（成功/G05/空/失败/无wx）；parity 4 轮一致；engine 17/17、resilience 17/17、v7 13/13、report、web build/verify、semantic_core 全过。**部署/配置（补齐）**：① 部署 `gsyg_semanticProbe`（云端装依赖）+ 配环境变量（`SEMANTIC_PROFILE`/`DEEPSEEK_API_KEY` 或 `WXAI_*`；`SEC_CHECK` 视需）；② 小程序需在**同一云环境**（`wx.cloud` 已初始化，与其它 gsyg_ 云函数环境一致）调用该函数——即先确保 `gsyg_semanticProbe` 已部署到小程序对应的云环境；③ web 网关 `ACTIONS` 已含 `semanticProbe`（web 路径不受影响）。**须知**：小程序真机需实测语义调用成功（本环境无法跑 wx.cloud + 真实密钥）；若 `gsyg_semanticProbe` 未配置 key，`fallback_allowed` 会让 A01 降级 bigram（对话仍可用、只是无语义增强）。
- **2026-08-29 修复 AI 提出的两项数据完整性问题**:
  - **① Q 题被误标 multi-question（属实,数据源）**:真因是研究团队表4 部分**区分性双问法**本身带 2 个问号——`Q2-S3`“…分别意味着什么？您会怎么区分？”、`Q6-S2`、`Q8-S3`、`Q9-S1`（Q1-S3 其实只 1 问号,已复核）。`checkConstraints` 的 `countQuestionMarks>1 → multi_question` 把它们误判。**修复**：`checkConstraints(question, actionPlan, askedHistory, allowedPreset)` 新增第 4 参数——传本题表4 全部模板(typical+followup)构成白名单,命中则不判 multi_question;普通生成/兜底双问仍拦。`processTeacherTurn` 调用处构建 `allowedPreset` Set。engine 测试 +2(表4双问放行/普通双问仍拦)→19/19。**注意**:这是"数据源模板放行",非放宽 LLM 输出。
  - **② 成对重复写入（属实,缺事件级唯一 id)**:全链路仅 `sessionId`(一次答题)做幂等键、无事件级唯一 id;同一事件被重复上报(flushPending 重试+再次 persist)时,云函数 `where({sessionId})` 首查未落地→二次 add→成对重复。**修复**：上报统一带事件级 `event_uuid`(`<sessionId>:<type>:<occurrence>`,确定性、可重试不变),云函数 `gsyg_reportSession`/`gsyg_reportInterview` **add 前优先按 `event_uuid` 查重**(命中→更新既有、不新增;无 event_uuid 老端回退按 sessionId upsert);`gsyg_reportTeacher` 存 `event_uuid` 审计。web `api.js` 的 reportExam/reportInterview/reportProfile 均带 `event_uuid`。**验证**：新增 `cloudfunctions/gsyg_reportSession/test/event-idempotent.test.js`(同 event_uuid 重复不新增/老端 sessionId upsert)。全量:engine 19/19、reportInterview 5/5、session-event-idem、draft、parity、resilience 17/17、v7 13/13、report、web build/verify、mp-semantic 全过。**部署**：重传 `gsyg_reportSession`/`gsyg_reportInterview`/`gsyg_reportTeacher`(改过)+重建网页。**小程序侧 event_uuid** 上报(api.js)未加——小程序上报走 `miniprogram/utils/api.js`,本轮只改 web + 云函数;如需小程序也带需另改。
- **2026-08-29 小程序上报补 event_uuid**:补上小程序端 `miniprogram/utils/api.js` 的事件级唯一 id（对齐 web + 云函数）。`eventUuid(sessionId,type,occurrence)` 生成 `<sessionId>:<type>:<occurrence>`：reportExam=`<sid>:exam:<submitStatus|submitted>`、reportInterview=`<sid>:interview:<revision||0>`、reportProfile=`<profileSid>:profile:<updatedAt||0>`。云函数 `gsyg_reportSession`/`gsyg_reportInterview` 已支持按 event_uuid 优先查重（命中→更新不新增），故小程序端无 revision 机制时 reportInterview 用默认 revision=0 也复用同一 event_uuid 去重。**验证**：mock wx 拦截 callFunction 确认三个上报 event_uuid 正确（`S1:exam:submitted`/`S1:interview:0`/`S1:profile:123`）；reportInterview 5/5、session-event-idem 2/2、draft、engine 19/19、parity、resilience 17/17、mp-semantic、web verify 全过。纯前端，重建小程序即可。
- **2026-08-29 本机比较版真实模型选择 + 多轮复问修复**:
  - **问题定性**:用户看到的重复提问来自 `mock-dialogue-v1` 固定后续响应，不是 Kimi/OpenAI 的真实输出；旧页面只有“进入演示”，没有页面内真实模型选择。mock 只可验证界面/保存链，`simulationOnly` 记录不得进入正式统计、报告或用于评价提问质量。
  - **页面内选择**:`InterviewView` 在正式首问前明确提供 Kimi K3/OpenAI 选择和密码输入；页面只读取 configured 布尔值，密钥只经 localhost 回环接口保存到被 Git 忽略的 `local-dialogue-server/.env`，不回传、不进浏览器存储、运行数据或日志。选择热切换无需重启；正式选择写入 `session.dialogueModelSelection`，scope=`assessment_session`，同次测评三道正式访谈锁定同一 provider/model，且每轮携带 `expected_provider/expected_model`；另一标签页切换导致不一致时返回 409 并要求恢复，不得静默混用模型。
  - **安全配置接口**:`GET/POST /v1/model-config` 只允许回环来源与 localhost CORS；浏览器在 fetch 前再次硬拒绝非 localhost/127.0.0.0/8/[::1] 配置地址。POST provider 白名单仅 `kimi|openai|mock`，可选 key 为 1–512 字符且禁止空白、换行/NUL；`.env` 原子写入，Windows DACL 限定当前用户/SYSTEM/Administrators，旧 `.env` 启动时也收紧；响应永不含 key。单轮请求启动时快照 provider，热切换只影响下一轮。
  - **多轮工作记忆**:Dialogue Session schema 升 v3，新增 `DialogueProgressState v1`（questionLedger/openThreads/coveredCues/phase/stagnation），区分“已经谈过”与 canonical Evidence；它帮助模型识别已问落点、开放线索和停滞，但不替 Dialogue Agent 选择路线，也不写 Evidence。浏览器每轮紧凑转发，服务端提示词实际消费。
  - **复问防线**:编译卡恢复四个选项的字母+完整语义；后续轮 `understanding.teacher_quote` 必须是本轮教师原话非空逐字子串；模型输出经过中文实质落点近似 Gate（承接壳/常见同义归一 + 具体锚点），命中后自动纠偏重生成最多一次，仍重复则暂停而不展示。mock 改为按 item+轮次四阶段变化，第五轮陈述性 CLOSE，不再无限重复。
  - **恢复边界**:旧 `Dialogue Session v2` 有实际消息/证据时不得静默新建 v3 后续接，页面保留旧内容但要求开始新测评；旧正式记录若只有 provider 而缺少具体 `llmModel`，同样不得继续形成可比较数据。
  - **并发边界**:页面用 Web Locks 对 `sessionId+itemId` 建立独占执行锁，同一情境误开第二标签页时第二页只读且不得持久化；模型配置另以 assessment session 独占锁串行创建，并在保存当前题前合并本机最新的模型锁和其他题记录。
  - **验证**:`local-dialogue-server` 30/30，web Dialogue Agent 26/26，web 全套 verify（含240排列对拍/新五表/报告）与 comparison build 通过；真实 Kimi/OpenAI 的访谈质量仍必须在配置有效密钥后用连续多轮 Fixture 单独验证。
- **2026-08-30 本机生产发布与交付文档**:
  - **生产发布链**:新增 `publish-local-comparison.ps1`、`发布本机版.cmd` 和 `local-web-server.js`。发布脚本先运行网页完整 `verify` 与 `build:comparison`，再把 `web/dist` 作为仅监听 `127.0.0.1:5173` 的生产静态网页提供；不再用 Vite 开发服务器冒充发布版。`.local-release/release.json` 记录构建时间、Git提交、新五表 dataset/schema/configFingerprint 与本机 URL。
  - **启动/停止兼容**:`start-local-comparison.ps1` 优先启动生产静态服务，缺少 `dist` 时自动构建；进程记录增加 `releaseMode=production-static` 和 `webServerScript`。`stop-local-comparison.ps1` 同时兼容新静态服务与旧 Vite 记录，且继续只终止路径校验后的项目进程。
  - **运行状态**:本机网页 `http://127.0.0.1:5173` 与 Dialogue Agent `http://127.0.0.1:8787` 均已启动并通过健康检查；Kimi K3 当前 configured/ready。验证结果更新为 local service 32/32、web Dialogue Agent 28/28、240 个题目×排列评分对拍、新五表负向夹具、报告与生产构建全部通过。
  - **说明材料**:`交付文档/TCIM当前程序整体架构_实现机制与本机发布分析报告_V0.1.docx` 说明权力结构、逐轮实现、接口、Evidence→画像、延时/收尾、发布和限制；`交付文档/TCIM新五表三类数据警告_人工治理操作手册_V0.1.docx` 逐条列出 59 个父引用、21 条路由错配和 55 条无路径记录，并给出人工复核、重新编译、兼容检查和完成定义。两份文档已用 LibreOffice 逐页渲染检查。
  - **五表治理边界**:当前三类 warning 仍不阻断 SIMULATION_ACTIVE 研究比较版；不得由编译器自动猜专业关系。建议先修 21 条 type/runtimeUse，再核对 59 条 parentCapabilityIds，最后处理 50 条 EvidenceAnchor pathRefs；5 条 RO0—RO4 来源政策应显式 `NOT_APPLICABLE`，不应强绑专业路径。
- **2026-08-30 自然轮替与两分钟整体理解问题**:
  - **自然承接**:前台提示词取消每轮固定“复述/核实—再提问”。`teacher_quote` 与内部理解只作后台审计；普通轮次直接提出接得上的自然追问，只有教师明确纠正、关键歧义或误解会改变方向时才短暂修复。问句质量 trace 增加机械复述开头诊断，但不把它设为新的硬模板门控。
  - **整体问题窗口**:`interview-timing.js` 在剩余 150s 至前台生成保护线 105s 之间、且每题尚未触发时发送 `question_mode=INTEGRATIVE_SYNTHESIS`。程序只调度时机；Dialogue Agent 综合整段历史、情境目标与教师原话，自主生成一个贴近情境、非诱导、非多问合一的最后新问题。状态和原问句写入 `integrativeQuestion` 与审计日志；教师回答后用 `INTEGRATIVE_QUESTION_ANSWERED` 保存最后一轮并结束，后台 Evidence 分析继续完成。失败重试通过 `runtimeDirectives` 保留该模式，不会降回普通问句。
  - **验证**:local service 36/36、web Dialogue Agent 29/29、240 排列对拍、新五表运行时/负向夹具和报告检查通过。
- **2026-08-30 新五表V0.2两轮数据治理**:
  - **唯一活动源**:`config/new-five-tables/source/`只保留五个V0.2.1工作簿；V0.1/V0.2工作簿与runtime仅供历史复现，运行端只导入`web/src/generated/tcim-new-five-tables.runtime.v0.2.1.json`。
  - **第一轮**:归一59个父级能力引用；对齐21条`policy_type/runtime_use`；表3新增`path_relation_mode/path_match_rule/path_relation_reason`，50条能力证据采用`ALTERNATIVE_PATHS + ANY_OF`，5条RO0—RO4来源政策采用`NOT_APPLICABLE + NONE`。
  - **共同原则**:同一能力A/B/C（或A/B）为可替代实现；教师满足任一路径的证据锚点即可，不要求全部路径，未出现某一路径不得直接判能力不足。该语义进入Excel字典/枚举、运行时、紧凑提示和确定性验证器。
  - **第二轮**:扩大到487条记录的版本/来源/唯一ID、Ontology图、证据—能力—路径三方语义、对话/综合引用、源哈希/指纹与十题完整性。发现Q06五条路径组按编号机械错配，已按命题和能力重映射；T3-Q10-004补全C07/C08环境配置引用。最终9组检查0错误0警告，指纹`35f1c6ddaa4780b72fdf5ff5b989befbefe9361681b3478ed415757c0774a606`。
  - **工程门禁**:`tools/compile-new-five-runtime-v021.mjs`重新编译，`tools/audit-new-five-v021.mjs`执行跨表审计；`verify-new-five-runtime.mjs`阻断旧版混入、认识状态错路由、多重画像归因、Q08题面污染及其他契约错误。
- **2026-08-30 真实对话回放驱动的自然追问二次优化（r3）**:
  - **证据**:`tools/analyze-local-dialogue-experience.mjs`只输出聚合指标、不输出教师原话。现有8份本机transcript中4份有实质追问；旧r1的Q9七个后续问句均出现模式化复述，且未触发整体问题。日志证明该访谈发生在r2发布前，用户感受成立。
  - **自然承接双保险**:提示版本升为`tcim-dialogue-v3-low-latency-2026-08-30-r3-natural-direct-integrative`；新增模式化复述检测。若“复述句。完整问题？”可安全拆分，服务端直接删除冗余复述句且不增加模型调用；否则作为可纠正质量错误最多重生成一次。教师明确纠正时仍允许短理解修复。trace记录`visible_style_adjusted/style_adjustments`。
  - **整体问题稳健触发**:窗口上沿由150秒前移至165秒，下沿仍为105秒，收尾仍保留90秒；修复真实Q9从153秒直接跨过窄窗口的问题。整体模式最多读取14轮历史，只提出一个情境化的整体判断、条件权衡、边界或调整依据问题；回答后直接收尾。
  - **真实Kimi回放**:普通追问一次生成约5.0秒，直接问“之后通过哪些表现判断真正理解”；整体问题一次生成约5.7秒，形成“何时先教规则、何时放手协商玩法”的情境权衡问句；均通过单问、非诱导、非复问和自然开头检查。
  - **发布一致性**:`publish-local-comparison.ps1`完成构建后强制重启网页与Dialogue Agent，并从`/health`把实际`prompt_version`写入release manifest，防止静态页面与常驻后台版本错配。
- **2026-08-30 微关系回应与中断恢复（r4）**:
  - **真实中断证据**:最新Q1在第4次教师回答后，Kimi两次应用级请求均返回`invalid_provider_output`（约7.2s/6.8s），发生时仅用时约4分29秒，排除倒计时。旧日志只留总错误码，无法再还原具体校验分支，故补充安全的失败详情留痕。
  - **微关系回应**:提示版本升为`tcim-dialogue-v3-low-latency-2026-08-30-r4.1-relational-microcue-resilient`。`frontstage_response_style`在`NONE/ACKNOWLEDGE_PERSPECTIVE/VALIDATE_COMPLEXITY/REPAIR`间给出软建议；每次最多一句4—20字，最近两轮已有关系承接则冷却。只承认思考、观察、取舍和专业关切被听见，不空泛赞美、不判能力、不虚构情绪、不按性别套话；关系句已点出取舍时，问句不得再次换词重复。trace记录requested move、实际微关系回应和前缀。
  - **低延时稳健修复**:`teacher_quote`空缺或近义改写时，从本轮教师原话确定性选择逐字片段，只修审计字段、不动问句/证据；模式化复述仍可无调用删除。其余校验失败最多用两个恢复候选（总计3个），最后机会允许在无安全新问题时温和CLOSE，仍失败才PAUSED。
  - **可诊断性**:领域层保留错误码和经脱敏、限长的`errorDetails`，`DialoguePaused`审计及`generationFailures`均可定位具体校验原因；教师界面仍只显示非技术性的“回答已保存、可重试”。聚合分析增加关系回应率与失败次数，不输出教师原话。
  - **验证**:local service 41/41、web Dialogue Agent 30/30、240排列对拍、新五表14类负向夹具和报告检查通过。
- **2026-08-30 自然温度、开放支架与证据来源门控（r5）**:
  - **目标原则**:自然、有温度但不讨好；开放但不失去专业方向；促进教师表达，同时不得把AI先提供的内容回写成教师原有能力。
  - **关系温度门控**:提示版本升为`tcim-dialogue-v3-low-latency-2026-08-30-r5-natural-warm-open-evidence-safe`。关系承接不再因每条长回答自动出现；最近三轮已有前置承接时进入冷却。服务端拒绝“很难得/很细致/很有分辨/很生动/很实际/很成熟/很到位/好的起点”等评价式表扬，也拒绝在本轮关系预算为NONE时继续添加关系套话；中性地承认取舍和复杂性仍允许。
  - **开放优先、分层支架**:固定顺序为开放问题→必要的措辞澄清→教师明确表示不理解、连续短答或进展状态明确停滞后，才允许少量示例/选项。普通轮次若AI先列“比如……”或“A还是B”等答案类别，质量闸门退回重生成；不以减少教师表达自由换取表面顺畅。
  - **来源不能由模型自报**:后台Evidence分析新增`elicitation_origin_guard`。上一问若确定性检测到AI给了选项，教师随后采用的内容至少标RO3；若AI先解释再让教师回应，至少标RO4。模型报出更独立的RO0/RO1/RO2会被程序改低，RO3/RO4继续排除在“原有能力”画像之外，审计trace保留来源门控原因。
  - **整体问题变为双门禁**:时机窗口前移到剩余210秒，普通追问105秒门槛以下仍为整体问题保留至95秒的独立生成区；内容必须同时包含整体范围和决策依据/取舍/改变/边界等信号，局部反事实会被退回重生成。教师回答后仍直接收尾并保留后台Evidence分析。
  - **验证**:local service 48/48、web Dialogue Agent 32/32、计时门禁3/3、240排列对拍、新五表21类负向夹具与报告检查通过；真实Kimi整体问题一次生成约4.3秒，形成“允许例外与运动底线之间如何把握”的情境权衡问句并通过全部质量门禁。
- **2026-08-30 两次具体肯定与问题强度节律（r6）**:
  - **真实回看依据**:同一份最新记录跨越r4/r5发布时点：12:45—13:03的旧轮次每题出现约4—5次“很难得/很有分辨/很细致/很生动”等肯定，温暖但过密；13:37后的r5题只出现1次中性肯定，但后半段连续推进“如果仍求助—具体观察—如果其实会搭—何时重新介入”，单问均合理，排列后形成明显压力。结论是调节出现次数与顺序，而不是取消温度或专业挑战。
  - **两次温暖预算**:提示版本升为`tcim-dialogue-v3-low-latency-2026-08-30-r6-two-warmth-pressure-rhythm`。每个情境目标2次、最多2次具体肯定：首次在前段实质回答后，第二次在至少4个已问问题后的实质回答出现；只肯定本轮表达、观察或区分，可用“很细致/很有分辨/很难得”，始终禁止“很专业/非常好/好的起点/能力很强”等宽泛评分。程序以全程questionLedger计数；模型遗漏预约肯定时确定性补一条短前缀且不增加API调用，宽泛表扬前缀可安全分离时先删除再补受控肯定。短答、修复轮或没有实质内容时不为凑数强行肯定。
  - **张弛门禁**:程序把反事实、连续失败、例外/底线、要求改变立场等识别为CHALLENGE。每题建议上限2次；上一问为CHALLENGE或已达上限时，下一问硬性转为RELAX，优先邀请真实经验、观察细节、当时过程或自由补充；连续挑战会被退回重写。两次肯定轮也自动降低问题负担。整体问题仍可提炼专业判断，但须用非对抗方式表达。
  - **测量边界**:三次情境访谈只形成高质量理解样本，不要求穷尽教师全部能力；未触及方面保持UNKNOWN，不能为了五表覆盖而连续加压。Evidence来源隔离、开放优先和Dialogue Agent主导权保持不变。
  - **验证**:local service 53/53；真实Kimi预约肯定轮一次生成约5.4秒，输出“这个区分很有分辨”；挑战后的第二次肯定+舒缓轮一次生成约5.35秒，确定性移除模型宽泛“很稳”前缀后形成“您对这些细节看得很细致。您一般看多久、看到什么，心里就会有个大概的判断？”，无额外模型调用并通过压力门禁。
- **2026-08-30 发布版本治理与反馈回传（TCIM Web R6.1）**:
  - **升级权**:后续提示词、五表、访谈逻辑和功能升级统一在研究负责人持有的主版本完成；程序员只部署冻结版本、修复明确部署问题并回传反馈，不得在云端静默改核心逻辑。紧急修复也要新分支、新发布号和可回滚版本。
  - **四层版本**:网页发布号`TCIM-WEB-2026.08.30-R6.1`、新五表版本/指纹、Dialogue Agent提示版本、实际provider/model独立记录；另保留Git提交、构建时间和schema版本。首页显示短标签`TCIM Web R6.1 · 五表 V0.2.1`。
  - **会话冻结**:`web/src/core/release.js`是构建时发布描述；`createSession`写入`releaseSnapshot`，旧会话不随网页升级改写。`reportSession`、`reportInterview`及三项教师反馈均携带快照；实际每轮trace继续保存真实provider/model/promptVersion。
  - **反馈闭环**:实际反馈、人工评价、失败与延时须以`sessionId + itemId + releaseSnapshot + 实际模型trace`关联并按版本分组，不混合不同发布条件。`publish-local-comparison.ps1`在构建前注入Git提交和构建时间，包内manifest/校验值为最终交付依据。
- **2026-08-31 R6.1 腾讯云生产外壳适配（分支 `release/tcim-web-r6.1-cloud`，基线 `7eddcf1`）**:
  - **边界**:只替换本机通信/密钥/存储外壳，不修改 Dialogue Agent 提示词与质量门禁、新五表 V0.2.1、Evidence State、两次具体肯定、挑战节律、整体问题、计时、评分或 R/P/G 筛题。原线上分支与原本机基线不被覆盖。
  - **受保护云函数**:新增 `gsyg_dialogueAgent`，其 `src/` 由 `tools/sync_dialogue_cf.js` 从冻结的 `local-dialogue-server/src/` 四个核心文件物理同步；正式请求只接受现有 `gsyg_webGateway` 注入的 `web_account` actor 和共享令牌，按 `gsyg_sessions` 校验 owner，并把 provider/model/promptVersion 锁定到整次测评。生产拒绝 mock、缺 model lock、跨模型续接和超过 1MB 的载荷。
  - **内容安全与密钥**:`SEC_CHECK=1` 是 ready 门禁；教师输入和 AI 可见输出都过 `msgSecCheck`，未配置时失败关闭。Kimi/OpenAI 密钥只读云函数环境变量；生产网页不再导入模型配置模块，不显示模型选择或密钥输入，也不配置单独 Dialogue Agent 公网地址。
  - **网关**:`ACTIONS.dialogueAgent → gsyg_dialogueAgent`，与旧访谈一样走 65 秒 CloudBase SDK 实例；默认账号限流由 36/10min 调为 180/10min（R6.1 每轮含前台问句+后台 Evidence）。`/health`聚合受保护 Dialogue Agent 的 ready/provider/model/promptVersion，业务 `/call` 仍必须登录。
  - **云端追溯**:`gsyg_reportSession`首次冻结 `releaseSnapshot`；`gsyg_reportDraft`逐轮保存 revision/payloadHash、消息、Evidence State、DialogueProgressState、五表指纹、releaseSnapshot 和实际模型 trace，并拒绝旧轮覆盖；`gsyg_reportInterview`实际持久化 releaseSnapshot/payloadHash，旧 revision 返回存量回执。
  - **构建身份**:`vite.config.js`在每次生产构建注入实际 Git HEAD 和 UTC 时间，`.env.production`固定 R6.1 架构/发布号且 `VITE_LOCAL_RESEARCH_MODE=0`。`verify_production_dist.mjs`拒绝回环请求地址、本机模型配置入口、密钥变量和CommonJS残留；CloudBase官方登录SDK的URL标准化器保留1个不带协议的`localhost`常量（非请求地址），必须单独说明并用浏览器网络验收确认本机请求为0。
  - **当前状态**:本地机制、网关和网页自动测试已通过；尚未上传腾讯云、配置真实密钥或完成三题人工验收。实际发布后再填写 `04_发布验收与回滚记录模板.md`，不得提前标记可发布。
  - **上游依赖风险**:`gsyg_dialogueAgent`锁定发布时微信官方最新稳定版`wx-server-sdk 4.0.2`，并声明`security.msgSecCheck`权限。npm审计仍报告该官方SDK间接依赖的5个high/1个moderate公告；当前适配层不接受动态数据库字段路径或SDK目标URL，降低了这些公告在本调用面的可利用性，但正式验收须记为已知上游依赖风险并跟踪微信/CloudBase SDK修复版本。
- **2026-09-01 中性同行对话与等待上限（TCIM Web R6.2，分支 `release/tcim-web-r6.2-neutral-dialogue`）**:
  - **真实试访依据**:R6.1 本机 Kimi Q1 完整试访中，11个可见问题平均等待约11.2秒，最慢约32.9秒；出现“愿意坦白这是假设情境，这很真实”“愿意先保留判断，很难得”“这个办法很灵活”等表达。问题来自r6的两次肯定配额及最多3次顺序生成共同放大，不应归因于教师回答。
  - **中性同行口吻**:提示版本升为`tcim-dialogue-v3-low-latency-2026-09-01-r7-neutral-peer-fast`。取消每情境两次肯定及确定性补赞；禁止评价教师的表达、诚实、人格、能力或做法质量。教师提到题目是假设/没有相同经历时不按关键词固定回应，而判断其对话作用：边界后已有实质回答走`FOLLOW_SUBSTANCE`并直接承接；只说明经验边界才走`CALIBRATE_PREMISE`；质疑前提走`EXAMINE_PREMISE`并允许改写情境；不愿或无法想象走`OFFER_REFRAME_OR_CLOSE`，不得强迫编造；真正纠正AI对原话的理解才走`REPAIR_IF_NEEDED`。所有路线均不立即道歉、自责或把说明描述为“坦白、诚实或勇气”。
  - **无需二次调用的清理**:若“很难得/很真实/很灵活/很细致/很有分辨/愿意坦白”等评价前缀后已有一个完整有效问题，程序确定性删除前缀并直接展示问题；不能安全分离时才由质量门禁退回。该处理不改专业方向、Evidence或教师原话。
  - **等待时间上限**:普通历史由8轮压到4轮，整体问题由14轮压到8轮；DialogueProgressState只发送选择下一问需要的问句、开放线索、线索摘要和停滞字段，移除答案摘录、详细理解、假设、理由和审计ID的重复传输。单轮上游生成硬上限由3次降为2次，第二次仍失败即暂停并允许教师重试或结束，不再出现第三段模型等待；后台Evidence调用继续异步，不阻塞下一问显示。真实复测显示把结构化输出上限从500降到400会增加Kimi无效JSON风险，故保持500，不以牺牲成功率换表面限额。
  - **真实Kimi复测**:Q4连续可见轮次为8.7s、8.0s、18.5s、21.7s、12.3s；假设情境纠正后AI直接说“是我假设过头了”，未再出现坦白、真实、难得、灵活等评价。21.7s轮实际只调用Kimi一次，证明剩余长尾主要来自Kimi K3上游波动而非程序重试；该轮输入约6.0k tokens，明显低于R6.1最慢轮三次共26.7k tokens。最终4/8轮压缩与500-token可靠上限生效后，新情境首问重试为8.0s成功。故R6.2消除了三次等待的程序放大，但不能承诺每轮≤7s；云端验收仍应统计P50/P95并对候选Kimi模型做同一脚本A/B。
  - **发布边界**:这是核心对话逻辑变更，因此使用新发布号`TCIM-WEB-2026.09.01-R6.2`和新分支；只完成本机修改、自动测试、真实Kimi复测及可交付提交，不合并`main`、不部署腾讯云、不改变当前正式网站。
- **2026-09-01 R6.2 整体本机试访后的稳定性收口**:
  - **完整路径**:新建并提交10题测评，完成系统遴选的Q1/Q4/Q6三场Kimi访谈，逐一检查异常重试、主动结束、倒计时结束、三场完成计数、反馈提交与云端保存回执；测试数据仅留在本机研究存储，未合并main、未部署腾讯云。
  - **连续追问故障**:旧压力分类把所有“如果”和“什么情况下”都误判为CHALLENGE，导致正常条件追问后的下一问连续两次被拒绝。现仅在拒绝、失败、持续无效、改变立场、例外/底线等真正高负担语义出现时判为挑战；普通“如果判断为探索，接下来如何支持”保持NEUTRAL。
  - **收束可用性**:整体问题模式连续两次只生成局部问题时，不再暂停整场；程序使用一个中性、非诱导、只问整体判断依据的安全收束问句，并保留trace标记。该兜底只处理`integrative_question_lacks_global_judgment`这一软质量错误，其他安全/契约错误仍失败关闭。
  - **整体口吻门禁**:补抓“刚才您说…”及破折号连接的机械复述；普通开放轮拒绝AI先给“魔法或鞋子”等示例选项；一个问号内仍含“怎样判断……还是看哪些迹象”的双意图问题会重写。新增“很关键/很完整/说得很完整”为评价式表达；模型CLOSE若评价教师则确定性替换为中性结束语，主动结束、倒计时和最终回答保存的本地收束语也不再复述或评价教师。
  - **验证**:local Dialogue Agent 33/33；web完整verify通过（同步冻结副本、240排列、新五表运行时/21类负向夹具、计时、release、Dialogue Agent 32/32、报告）；三场访谈、反馈与保存UI链路均完成。真实Kimi可见轮次仍有5.4—10.1秒波动，不能承诺≤7秒，后续云端验收须继续统计P50/P95。
- **2026-09-01 人工Q10回放修正（提示r8）**:
  - **真实问题**:会话`cf2c6aad-dd6f-4705-a83b-26f54b4a7543`在首答后和第7答后各暂停一次；两次均为Kimi连续返回多问号，触发`output.visible_text must contain exactly one question mark`。教师指出“AI在假设/对孩子的预设有偏差”时，旧检测未识别为前提质疑，AI直接换到经验问题；整体问题首次失败后人工重试虽成功，却未登记`integrativeQuestion`，造成后面再次询问整体问题；最终回答保存后使用技术性收束语，显得突然。
  - **r8修正**:提示版本升为`tcim-dialogue-v3-low-latency-2026-09-01-r8-premise-aware-natural-close`。模型一次生成多个问句时，程序先选择其中最长且可独立回答的一问，再走原有非诱导/非复问/单意图等全部门禁，不为纯格式问题增加第二次等待。扩充“你在假设/对孩子有预设偏差”识别，并在转向真实经验前确定性显示“先不沿用这个预设”，不得无回应地换方向。
  - **整体问题与重试**:整体性只保留在问题内容，不再向教师宣布“回头看整个游戏/整体来看/综合来看”；人工重试若恢复的是`INTEGRATIVE_SYNTHESIS`，立即登记为已问，教师下一次回答后直接收束，不再重复第二个整体问题；重试成功后同时补做该教师回答的后台Evidence分析。
  - **自然收束**:最后整体回答仍保存并进入后台Evidence，不再显示“本轮回答已保存”这类系统提示，而用中性承接说明该回答补充了当前情境的判断依据，再感谢并结束；不评价回答质量，也不再追加新问题。
- **2026-09-01 R6.2.1 临时免注册测试入口**:
  - **范围**:仅为导师和研究团队短期试用取消邮箱注册/验证码界面，不改测评赋分、R/P/G筛题、Dialogue Agent、新五表、Evidence State、访谈节律或内容安全。发布号升为`TCIM-WEB-2026.09.01-R6.2.1`，会话`releaseSnapshot.accessMode='temporary_test_entry'`可追溯。
  - **身份与隔离**:网页`VITE_TEMPORARY_TEST_ENTRY=1`时先恢复网关Cookie，没有会话才调用`POST /auth/test-session`；网关仅在`WEB_TEST_ENTRY_ENABLED=1`时生成高熵`web:test_*` actor并签发HMAC+HttpOnly+Secure Cookie，默认七天。客户端不能提交或选择uid，不是多人共用账号；资料、测评、访谈仍按随机actor隔离。下游继续使用既有受保护网关授权契约，并以`sessionType=web_test`和actor前缀审计来源。
  - **恢复**:正式账号登录、邮箱注册和找回密码代码保留但在测试构建中隐藏。投入正式使用前同时关闭前端`VITE_TEMPORARY_TEST_ENTRY`与网关`WEB_TEST_ENTRY_ENABLED`、重新构建部署，即恢复账号入口；不得仅关闭一侧造成前后端状态不一致。
- **2026-09-01 R6.2.2 网页开场稳定性与零输入完成门禁**:
  - **云端证据**:19:34—19:48的最近测试共有17次开场失败，其中16次是`msgSecCheck` 云调用`-501001`，1次是`invalid_provider_output`；最近4个测试会话共12个情境记录均在教师回答为0轮时被标为完成。
  - **网页内容安全**:普通网页不再调用需要小程序身份的`msgSecCheck`；`gsyg_dialogueAgent`默认改用腾讯云文本内容安全 TMS（`TCIM_DIALOGUE_CONTENT_SAFETY_MODE=tencent_tms`），教师输入和AI可见输出都审核；审核服务未开通、凭证缺失或暂时不可用时失败关闭，不得把服务异常误报为“内容违规”。`provider`仅供临时诊断且须额外显式开关，不得作为正式发布配置。
  - **开场重试**:仅对网络、限流、内容安全服务暂时不可用或模型输出格式失败自动重试一次；沿用同一领域会话，不重复创建轮次，两次失败都保留审计记录。
  - **零输入门禁**:“完成”必须至少有1条非空教师回答。开场失败后退出、AI在首答前错误收束、或倒计时在教师零输入时归零，一律保存为技术中断/`in_progress`，不计完成数、不上报完成回执；情境列表显示“技术中断·未完成”并允许重新开始。
  - **连接提示**:健康检查通过只显示“云端AI配置已就绪”；至少成功返回一轮后才显示“云端AI对话正常”。
  - **发布边界**:代码、自动测试和生产构建在本机完成；正式部署前必须先在腾讯云开通 TMS并配置最小权限凭证，完成真实 TMS + Kimi 开场验收后才能发布。本条记录不代表已部署。
  - **上游依赖审计**:加入腾讯云官方 TMS SDK 后`npm audit --omit=dev`报告5个high/3个moderate；5个high仍来自已知`wx-server-sdk`/CloudBase间接依赖，新增2个moderate来自 TMS SDK common/uuid。不执行会回退官方云开发SDK版本的自动`audit fix`；发布验收继续记为已知上游依赖风险并跟踪官方修复。
- **2026-09-01 R6.2.2 腾讯云内部测试发布**:
  - **发布范围**:经研究负责人明确授权，将分支`release/tcim-web-r6.2.2-opening-stability`部署到环境`cloud1-2gefzeri3cb333f2`和正式测试域名`https://gsyg.age08.cn/`；未合并`main`。后台仅更新`gsyg_dialogueAgent`，其他云函数和数据库未改。
  - **临时安全模式**:由于本轮未开通TMS，云函数显式配置`TCIM_DIALOGUE_CONTENT_SAFETY_MODE=provider`和`TCIM_DIALOGUE_ALLOW_PROVIDER_SAFETY_ONLY=1`，仅用于导师/研究团队内部测试；现有Kimi和网关密钥原样保留。正式收集研究数据前仍须切回TMS并完成内容安全验收。
  - **发布结果**:`gsyg_dialogueAgent`于23:00:50显示`Deployment completed`；网关健康检查返回Kimi`kimi-k3`、`ready=true`、`content_safety_mode=provider`。网页安全发布上传并校验13个文件，入口资源为`assets/index-B8iPqLng.js`与`assets/index-D0qhYQZF.css`；腾讯云发布前备份位于`.cloudbase-backup/1788275226538/`。
  - **正式环境验收**:使用明确标记的`R622自动验收`测试身份完成10题并进入Q1。开场成功生成，状态从“云端AI配置已就绪”切换为“云端AI对话正常”；零教师输入离开后仍为“待访谈、0/3”，未误标完成；23:00后错误日志计数为0。测试会话ID为`3f6b69c1-8599-44e0-8454-3f4d5c25ca91`。
  - **回滚**:网页可从上述CloudBase备份恢复；旧`gsyg_dialogueAgent`代码已在发布前下载备份，必要时按同一函数配置重新部署。首次把云端路径显式写成`/`的安全发布因根路径校验失败自动回滚，随后省略云端路径后发布和一致性校验成功。
