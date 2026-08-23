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
