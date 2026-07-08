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
